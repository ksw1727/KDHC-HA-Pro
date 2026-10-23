import { useEffect, useMemo, useRef, useState } from 'react';
import { cloudEnabled, cloudFetch, scopedStorageKey } from '../cloud';
import { loadDraft, useCloudDraft, type Draft } from './useCloudDraft';
import { buildCloudChatBody, prepareCloudSources, type CloudSource } from './cloudAttachments';
import { readNdjson, requireOk, ServerMessageError } from './http';
import { LAYOUT_LABELS, orgLabel, validateSchema, type FormSchema } from '@contract/schema';
import { layoutSheet } from '@contract/layout';
import { validateForExport } from '@gen/state/validateForExport';
import { exportFormJson } from '@gen/export/exportJson';
import { PreviewGrid } from '@gen/preview/PreviewGrid';
import { loadForm } from '@gen/storage/localForms';
import { isRemoved } from '@gen/storage/removedForms';
import { describeChanges } from './formDiff';
import { sameForm } from '@gen/state/versioning';
import { randomFormId } from '@gen/state/newSchema';
import { Button, Chip, TextArea, cx } from '@gen/ui/ui';

const aiFetch: typeof fetch = (url, init) => cloudEnabled ? cloudFetch(String(url), init) : fetch(url, init);
type AiEvent =
  | { type: 'chat'; chatId: string } | { type: 'status'; text: string } | { type: 'text'; text: string }
  | { type: 'form'; schema: unknown } | { type: 'error'; text: string } | { type: 'done' };

interface Msg {
  role: 'user' | 'ai';
  text: string;
  files?: string[];        // 사용자가 올린 엑셀 파일 이름
  status?: string;         // AI가 지금 하는 일 (끝나면 지움)
  error?: string;
  form?: FormSchema;
  problems?: string[];     // 양식 규칙 위반 (있으면 내보내기 전에 고쳐야 함)
  badForm?: string;        // 양식 정의가 아예 틀렸을 때
  edited?: boolean;        // 설정 패널(빌더)에서 고친 양식으로 바뀜
  base?: FormSchema;       // 패널에서 고치기 전, AI가 만든 양식 (바뀐 점 보여 주기용)
  opened?: boolean;        // AI가 아니라 패널에서 연 양식 (양식 파일·빈 양식)
}

/** 양식 비교용 (빌더가 저장할 때마다 바뀌는 updatedAt은 빼고) */
const sig = (s: FormSchema) => JSON.stringify({ ...s, updatedAt: '' });

const EXAMPLES = [
  '지사별 교육 참가자 명단을 받고 싶어요. 이름·직급·참가 희망일, 지사 전체',
  '위에 담당자·연락처를 받고, 아래에 안전보호구 지급 내역(품목·수량·단가)을 받는 부서별 양식',
  '협력기관 10곳에서 분기별(1~4분기) 에너지 절감량을 항목별 숫자 표로 받고 싶어요',
  '2027 사업예산 요구표. 사업별로 지사마다 자기 열에 요구액을 적게 해 주세요',
];
const MODEL_KEY = 'hanan-moa:ai-openai-model';
const MAX_FILE = 10 * 1024 * 1024;   // 올릴 수 있는 엑셀 크기
const isExcel = (f: File) => /\.(xlsx|xlsm|xls)$/i.test(f.name);

async function toBase64(f: File): Promise<string> {
  const bytes = new Uint8Array(await f.arrayBuffer());
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
const SOURCES_KEY = 'hanan-moa:ai-sources';
function loadSources(): CloudSource[] {
  try { const xs = JSON.parse(sessionStorage.getItem(scopedStorageKey(SOURCES_KEY)) ?? '[]'); return Array.isArray(xs) ? xs : []; } catch { return []; }
}
function loadChat(): { chatId: string | null; msgs: Msg[]; aiVersion: string | null } {
  const draft = loadDraft();
  return { ...draft, msgs: draft.msgs as Msg[] };
}

/** AI가 준 양식 정의 → 화면용 (계약 검사 → 내보내기 전 검사) */
function checkForm(x: unknown): Pick<Msg, 'form' | 'problems' | 'badForm'> {
  const v = validateSchema(x);
  if (!v.ok) return { badForm: v.errors.slice(0, 3).join(' / ') };
  return { form: v.schema, problems: validateForExport(v.schema).map((p) => p.message) };
}
/** 패널(빌더)에서 온 양식: 고치는 중이라 계약에 덜 맞아도(예: 빈 지사 목록) 미리보기는 보이고 고칠 곳으로 알린다 */
const checkLocal = (s: FormSchema): Pick<Msg, 'form' | 'problems' | 'badForm'> => ({ form: s, badForm: undefined, problems: validateForExport(s).map((p) => p.message) });

/** 오른쪽 설정 패널로 이 양식을 보낸다. auto: AI가 새로 만들었을 때(패널을 억지로 열지 않음) */
const toPanel = (schema: FormSchema, o: { auto?: boolean; preferStored?: boolean } = {}) =>
  window.dispatchEvent(new CustomEvent('hanan-moa:open-form', { detail: { schema, ...o } }));

/** AI로 만들기: 하고 싶은 말을 하면 AI(OpenAI SDK)가 이 프로그램 규칙대로 양식을 만든다 (tools/ai/bridge.ts).
 *  panelOpen: 오른쪽 설정 패널이 켜져 있으면 마지막 양식 카드가 패널과 연결돼, 고칠 때마다 미리보기가 바로 바뀐다 */
export function AiPage({ panelOpen = false }: { panelOpen?: boolean } = {}) {
  const [healthError, setHealthError] = useState('');
  // 로컬: tools/ai/bridge.ts(OpenAI SDK, 모델 선택). 온라인: server/ai.ts(관리자 공용 OpenAI)
  const [health, setHealth] = useState<'checking' | 'off' | 'nokey' | 'ok'>('checking');
  const [models, setModels] = useState<string[]>([]);
  const [model, setModel] = useState<string>(() => { try { return localStorage.getItem(scopedStorageKey(MODEL_KEY)) ?? ''; } catch { return ''; } });
  const [saved] = useState(loadChat);
  const [chatId, setChatId] = useState<string | null>(saved.chatId);
  const [msgs, setMsgs] = useState<Msg[]>(saved.msgs);
  // AI 작업 폴더에 있는 양식(마지막으로 AI가 만들었거나 AI에게 넘긴 것). 화면 양식과 다르면 다음 말에 함께 넘긴다
  const [aiVersion, setAiVersion] = useState<string | null>(saved.aiVersion);
  const [input, setInput] = useState('');
  const [attached, setAttached] = useState<File[]>([]);   // 쓰던 엑셀 올리기
  const [fileNote, setFileNote] = useState('');
  const [consent, setConsent] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const addFiles = (list: FileList | File[]) => {
    if (busy) return;
    const fs = [...list];
    setConsent(false);
    const bad = fs.filter((f) => !isExcel(f) || f.size > MAX_FILE);
    setFileNote(cloudEnabled && fs.some((f) => /\.xls$/i.test(f.name)) ? '.xls는 분석할 수 없어요. .xlsx로 다시 저장해 주세요.' : bad.length ? `엑셀 파일(.xlsx·.xlsm, 10MB 이하)만 올릴 수 있어요: ${bad.map((f) => f.name).join(', ')}` : '');
    setAttached((xs) => [...xs, ...fs.filter((f) => isExcel(f) && f.size <= MAX_FILE && (!cloudEnabled || !/\.xls$/i.test(f.name)))].slice(0, 5));
  };
  const [busy, setBusy] = useState(false);
  const abort = useRef<AbortController | null>(null);
  // 온라인: 이 대화에서 올린 엑셀 요약. 서버는 대화 글만 기억하므로 다음 말("네" 등)에도 함께 보낸다 (이 탭에서만 보관)
  const sources = useRef<CloudSource[]>(loadSources());
  const keepSources = (xs: CloudSource[]) => { sources.current = xs; try { sessionStorage.setItem(scopedStorageKey(SOURCES_KEY), JSON.stringify(xs)); } catch { /* 보관 못 해도 됨 */ } };
  const end = useRef<HTMLDivElement>(null);

  const draftSync = useCloudDraft({ chatId, msgs, aiVersion }, busy, (draft: Draft) => {
    setChatId(draft.chatId); setMsgs(draft.msgs as Msg[]); setAiVersion(draft.aiVersion);
    if (!draft.msgs.length) keepSources([]);
  });
  useEffect(() => {
    aiFetch('/api/ai/health').then(requireOk).then((r) => r.json()).then((j) => {
      if (cloudEnabled) setHealth(j.engines?.codex === true ? 'ok' : 'nokey');
      else { setHealth(j.openai ? 'ok' : 'nokey'); setModels(Array.isArray(j.openaiModels) ? j.openaiModels : []); }
    }).catch((error: Error) => { setHealthError(error.message); setHealth('off'); });
  }, []);
  useEffect(() => { try { if (model) localStorage.setItem(scopedStorageKey(MODEL_KEY), model); } catch { /* 저장 못 해도 됨 */ } }, [model]);
  const openaiModel = models.includes(model) ? model : models[0];
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }); }, [msgs]);


  const lastForm = [...msgs].reverse().find((m) => m.form)?.form;
  const lastFormAt = msgs.map((m) => !!m.form).lastIndexOf(true);
  const [selKey, setSelKey] = useState<string | null>(null);   // 패널에서 고른 항목 (카드 미리보기에 표시)

  // 빌더에서 이 대화의 양식을 고치면 마지막 양식 카드를 바로 그 양식으로 바꾼다
  useEffect(() => {
    const apply = (s: FormSchema) => setMsgs((xs) => {
      const i = xs.map((m) => !!m.form).lastIndexOf(true);
      if (i < 0 || xs[i].form!.formId !== s.formId || sig(xs[i].form!) === sig(s)) return xs;
      return xs.map((m, k) => (k === i ? { ...m, ...checkLocal(s), edited: true, base: m.base ?? m.form } : m));
    });
    const on = (e: Event) => apply((e as CustomEvent<FormSchema>).detail);
    window.addEventListener('hanan-moa:form-saved', on);
    window.addEventListener('hanan-moa:form-edit', on);
    // 패널에서 양식 파일을 열거나 빈 양식을 만들면 대화에 카드를 붙여 같이 고친다
    const opened = (e: Event) => {
      const { schema, how } = (e as CustomEvent<{ schema: FormSchema; how: 'new' | 'file' }>).detail;
      setMsgs((xs) => [...xs, { role: 'ai', opened: true, ...checkLocal(schema),
        text: how === 'new' ? '빈 양식을 만들었어요. 오른쪽 패널에서 고치거나, 여기서 말로 고쳐 달라고 해 주세요.' : '양식 파일을 열었어요. 오른쪽 패널에서 고치거나, 여기서 말로 고쳐 달라고 해 주세요.' }]);
      setAiVersion('');   // AI 작업 폴더에 아직 없는 양식이라 다음 말에 함께 넘긴다
    };
    window.addEventListener('hanan-moa:form-opened', opened);
    const picked = (e: Event) => setSelKey((e as CustomEvent<{ key: string | null }>).detail.key);
    window.addEventListener('hanan-moa:field-selected', picked);
    const off = () => {
      window.removeEventListener('hanan-moa:form-saved', on); window.removeEventListener('hanan-moa:form-edit', on);
      window.removeEventListener('hanan-moa:form-opened', opened); window.removeEventListener('hanan-moa:field-selected', picked);
    };
    if (cloudEnabled && !draftSync.ready) return off;
    const current = cloudEnabled ? { msgs, chatId } : saved;
    // 새로고침 전에 고친 것도 맞춘다
    const last = [...current.msgs].reverse().find((m) => m.form)?.form;
    const found = last ? loadForm(last.formId)?.schema : undefined;
    const stored = found && last && sameForm(last, found) ? found : undefined;
    if (stored) apply(stored);
    // 새로고침해도 패널이 대화의 마지막 양식을 연다 (내 업무공간에서 지운 양식은 다시 열지 않는다)
    if (last && !isRemoved(last.formId)) toPanel(stored ?? last, { auto: true, preferStored: true });
    // 이전 화면에서 바뀐 카드라 원래 양식을 모르면 AI 작업 폴더의 양식을 가져온다
    const i = current.msgs.map((m) => !!m.form).lastIndexOf(true);
    if (i >= 0 && current.msgs[i].edited && !current.msgs[i].base && current.chatId) {
      aiFetch(`/api/ai/form?chatId=${encodeURIComponent(current.chatId)}`).then(requireOk).then((r) => r.json()).then((ai) => {
        const v = ai && validateSchema(ai);
        if (!v || !v.ok) return;
        setAiVersion(sig(v.schema));
        setMsgs((xs) => xs.map((m, k) => (k === i && !m.base ? { ...m, base: v.schema } : m)));
      }).catch(() => { /* 연결 서버가 없으면 그냥 둔다 */ });
    }
    return off;
  }, [saved, draftSync.ready]);
  const patchLast = (f: (m: Msg) => Msg) => setMsgs((xs) => xs.map((m, i) => (i === xs.length - 1 ? f(m) : m)));

  const send = async (text = input) => {
    const files = attached;
    const message = text.trim() || (files.length ? '올린 엑셀 양식으로 같은 양식을 만들어 주세요.' : '');
    if (!message || busy || !draftSync.ready || health !== 'ok') return;
    if (cloudEnabled && files.length && !consent) { setFileNote('요약 내용이 외부 AI로 전달되는 것에 동의해 주세요.'); return; }
    if (cloudEnabled && message.length > 6000) { setFileNote('메시지는 6,000자 이하로 줄여 주세요.'); return; }
    setInput('');
    setFileNote('');
    setBusy(true);
    setMsgs((xs) => [...xs, { role: 'user', text: message, ...(files.length ? { files: files.map((f) => f.name) } : {}) }, { role: 'ai', text: '', status: files.length ? '엑셀 올리는 중' : '보내는 중' }]);
    const ctl = new AbortController();
    abort.current = ctl;
    try {
      // 빌더에서 고친 양식이 있으면 그 양식에서 이어 고친다
      const lastMsg = [...msgs].reverse().find((m) => m.form);
      const edited = lastMsg?.edited;
      const changes = lastMsg?.base && lastMsg.form ? describeChanges(lastMsg.base, lastMsg.form) : [];
      const form = lastForm && (aiVersion !== null ? sig(lastForm) !== aiVersion : edited || lastMsg?.opened) ? lastForm : undefined;
      if (form) patchLast((m) => ({ ...m, status: lastMsg?.opened && !edited ? '패널에서 연 양식을 AI에게 넘기는 중' : '패널에서 고친 양식을 AI에게 넘기는 중' }));
      if (form) setAiVersion(sig(form));
      const text = form ? `(${lastMsg?.opened && !edited ? '사용자가 양식을 직접 열었어요' : '사용자가 빌더에서 form.json을 직접 고쳤어요'}. 지금 form.json에서 이어서 해 주세요.${changes.length ? ` 고친 내용: ${changes.join(' / ')}` : ''})\n${message}` : message;
      // 온라인 서버는 engine(codex = OpenAI)·요약(sources)만 받고, 로컬 연결 서버는 model·원본 파일을 받는다
      const body = cloudEnabled
        ? buildCloudChatBody({ chatId: chatId ?? undefined, engine: 'codex', message: text, form, sources: files.length ? await prepareCloudSources(files, consent).then((xs) => { keepSources(xs); return xs; }) : sources.current })
        : JSON.stringify({ chatId: chatId ?? undefined, model: openaiModel, message: text, form, files: await Promise.all(files.map(async (f) => ({ name: f.name, base64: await toBase64(f) }))) });
      if (ctl.signal.aborted) throw new DOMException('취소됨', 'AbortError');
      setAttached([]); setConsent(false);
      const res = await aiFetch('/api/ai/chat', { method: 'POST', headers: { 'content-type': 'application/json' }, body, signal: ctl.signal });
      await readNdjson(res, (event) => {
        const e = event as AiEvent;
        if (e.type === 'chat') setChatId(e.chatId);
        else if (e.type === 'status') patchLast((m) => ({ ...m, status: e.text }));
        else if (e.type === 'text') patchLast((m) => ({ ...m, text: m.text ? `${m.text}\n\n${e.text}` : e.text }));
        else if (e.type === 'form') {
          const c = checkForm(e.schema);
          const fromAi = c.form;
          // 같은 대화에서 전혀 다른 양식을 새로 만들면 AI는 이전 양식 번호를 그대로 쓴다 → 새 번호를 줘서
          // 이전 양식의 내보내기 기록과 섞여 버전이 오르지 않게 한다 (다음 말에 새 번호 양식을 AI에게 넘긴다)
          if (c.form && lastForm && c.form.formId === lastForm.formId && !sameForm(lastForm, c.form)) {
            c.form = { ...c.form, formId: randomFormId(), createdAt: new Date().toISOString(), formVersion: 1 };
          }
          patchLast((m) => ({ ...m, ...c }));
          if (c.form && fromAi) { setAiVersion(sig(fromAi)); toPanel(c.form, { auto: true }); }
        }
        else if (e.type === 'error') patchLast((m) => ({ ...m, error: e.text }));
      });
    } catch (err) {
      if ((err as Error).name !== 'AbortError') patchLast((m) => ({ ...m, error: err instanceof ServerMessageError ? err.message : `연결이 끊겼어요: ${(err as Error).message}` }));
      else patchLast((m) => ({ ...m, error: '멈췄어요' }));
    } finally {
      patchLast((m) => ({ ...m, status: undefined, ...(m.text || m.form || m.error ? {} : { error: 'AI 답을 받지 못했어요. 같은 말을 한 번 더 보내 주세요.' }) }));
      setBusy(false);
      abort.current = null;
    }
  };

  const reset = () => {
    if (msgs.length && !window.confirm(cloudEnabled ? '화면 대화를 새로 시작할까요? 서버 대화 기록은 삭제되지 않고, 현재 저장 초안만 비워요. 만든 양식은 빌더·양식 파일에 남아요.' : '지금 대화를 지우고 새로 시작할까요? (만든 양식은 빌더·양식 파일에 남아요)')) return;
    if (busy || (cloudEnabled && !draftSync.ready)) return;
    draftSync.markCleared();
    abort.current?.abort(); setChatId(null); setMsgs([]); setInput(''); setAiVersion(null); setAttached([]); keepSources([]);
  };

  if (health === 'off' || health === 'nokey') {
    return (
      <div className="mx-auto flex max-w-[640px] flex-col gap-3 p-6">
        <h1 className="m-0 text-xl font-bold">AI로 만들기</h1>
        <div className="rounded-card border border-line bg-panel p-4 text-sub">
          <p className="m-0 mb-2 font-semibold text-ink">{cloudEnabled ? (health === 'nokey' ? '관리자 AI 설정이 아직 없어요' : healthError || '클라우드 AI 연결을 확인하지 못했어요') : health === 'off' ? 'AI 연결 서버가 꺼져 있어요' : 'OpenAI API 키가 없어요'}</p>
          <p className="m-0">{cloudEnabled ? <>{health === 'nokey' ? 'AI 키 또는 모델이 설정되지 않아 비용이 발생하는 AI 기능은 사용할 수 없어요. ' : '로그인 상태를 확인하고 다시 접속해 주세요. 계속되면 관리자에게 문의해 주세요. '}양식 설정 패널·취합하기는 그대로 사용할 수 있어요.</> : <>AI로 만들기는 OpenAI API(<code>.env.local</code>의 <code>OPENAI_API_KEY</code>)로 돌아가요. 프로그램 폴더에서 <code>npm run dev</code>로 켠 화면(예: localhost:5173)에서 써 주세요. 오른쪽 위 [양식 설정 패널] 스위치와 [취합하기]는 지금도 그대로 쓸 수 있어요.</>}</p>
        </div>
      </div>
    );
  }

  const ok = health === 'ok';
  return (
    <div className="mx-auto flex h-full max-w-[1080px] flex-col gap-3 px-4 py-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="m-0 text-xl font-bold">무엇을 받고 싶으세요?</h1>
        <span className="flex-1" />
        {!cloudEnabled && models.length > 0 && (
          <select aria-label="OpenAI 모델" className="rounded-box border border-line bg-white px-2 py-1 text-[13px]" value={openaiModel} disabled={busy}
            onChange={(e) => setModel(e.target.value)}>
            {models.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        )}
        {msgs.length > 0 && <Button size="sm" variant="ghost" disabled={busy || !draftSync.ready} onClick={reset}>새 대화</Button>}
      </div>

      {cloudEnabled && (!draftSync.ready || draftSync.notice) && <div role="status" className="rounded-box border border-line p-3 text-sm">
        {draftSync.notice || '서버 대화를 불러오는 중이에요. 완료되면 AI에게 보낼 수 있어요.'}
        {draftSync.conflict ? <div className="mt-2 flex gap-2"><Button onClick={draftSync.chooseServer}>서버 대화 불러오기</Button><Button onClick={draftSync.chooseLocal}>이 기기 대화 저장</Button></div>
          : draftSync.notice && <Button onClick={draftSync.reload}>다시 불러오기</Button>}
      </div>}
      <div className="min-h-0 flex-1 overflow-auto rounded-card border border-line bg-white p-3" aria-live="polite"
        onDragOver={(e) => { if (e.dataTransfer.types.includes('Files')) e.preventDefault(); }}
        onDrop={(e) => { if (e.dataTransfer.files.length) { e.preventDefault(); addFiles(e.dataTransfer.files); } }}>
        {msgs.length === 0 ? (
          <div className="flex flex-col gap-3 text-sub">
            <p className="m-0">받고 싶은 내용을 말로 적어 주세요. AI가 이 프로그램 규칙대로 양식을 만들고, 미리보기를 보여 드려요. 마음에 들면 엑셀로 내보내거나 빌더에서 직접 고칠 수 있어요.</p>
            <p className="m-0 text-xs"><b>쓰던 엑셀 양식</b>이 있으면 아래 [엑셀 올리기]를 누르거나 여기에 끌어다 놓으세요. 같은 모양으로 만들고, 그대로 옮길 수 없는 부분은 어떻게 바꿨는지 알려 드려요.</p>
            <div className="flex flex-wrap gap-1.5">
              {EXAMPLES.map((x) => <button key={x} type="button" onClick={() => setInput(x)} className="rounded-full border border-line bg-panel px-3 py-1 text-left text-[13px] text-ink hover:border-pri">{x}</button>)}
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {msgs.map((m, i) => (m.role === 'user'
              ? <div key={i} className="ml-auto flex max-w-[80%] flex-col items-end gap-1">
                  {m.files?.length ? <div className="flex flex-wrap justify-end gap-1">{m.files.map((n) => <FileChip key={n} name={n} />)}</div> : null}
                  <div className="whitespace-pre-wrap rounded-card bg-pri-bg px-3 py-2">{m.text}</div>
                </div>
              : <AiBubble key={i} m={m} last={i === lastFormAt} linked={i === lastFormAt && panelOpen} selKey={i === lastFormAt ? selKey : null} />))}
            <div ref={end} />
          </div>
        )}
      </div>

      {(attached.length > 0 || fileNote) && (
        <div className="flex flex-wrap items-center gap-1.5">
          {attached.map((f, i) => <FileChip key={`${f.name}-${i}`} name={f.name} onRemove={() => setAttached((xs) => xs.filter((_, k) => k !== i))} />)}
          {fileNote && <span className="text-xs text-err-ink">{fileNote}</span>}
        </div>
      )}
      {cloudEnabled && attached.length > 0 && <label className="text-sm"><input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} disabled={busy} /> 원본은 브라우저에서만 분석하고 서버에 저장하지 않아요. 민감한 셀 값이 포함될 수 있는 요약 내용이 외부 AI로 전달되는 것에 동의해요.</label>}
      <div className="flex items-end gap-2">
        <input ref={fileRef} type="file" accept=".xlsx,.xlsm,.xls" multiple hidden aria-label="엑셀 파일 고르기"
          onChange={(e) => { if (e.target.files) addFiles(e.target.files); e.target.value = ''; }} />
        <Button disabled={busy || health === 'checking'} onClick={() => fileRef.current?.click()} title="쓰던 엑셀 양식 올리기">엑셀 올리기</Button>
        <TextArea aria-label="AI에게 보낼 말" className="min-h-[64px] flex-1" value={input} disabled={health === 'checking'}
          placeholder={lastForm ? '고칠 내용을 말해 주세요 (예: 교육비는 빼 주세요, 제출처를 부서로 바꿔 주세요)' : '예: 지사별 동절기 안전교육 이수자 명단. 담당자 연락처도 받고, 교육비는 원 단위로'}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send(); } }} />
        {busy ? <Button onClick={() => abort.current?.abort()}>멈추기</Button>
          : <Button variant="pri" disabled={(!input.trim() && !attached.length) || !ok || !draftSync.ready || (cloudEnabled && attached.length > 0 && !consent)} onClick={() => void send()}>보내기</Button>}
      </div>
      <p className="m-0 text-xs text-muted">Enter로 보내고 Shift+Enter로 줄을 바꿔요. 보낸 말은 OpenAI{!cloudEnabled && openaiModel ? ` ${openaiModel}` : ''}로 전달돼요. {cloudEnabled ? '첨부 원본은 보내거나 저장하지 않으며, 동의한 엑셀 요약은 외부 AI에 전달돼요.' : '회신 파일 내용은 보내지 않아요.'}</p>
    </div>
  );
}

function FileChip({ name, onRemove }: { name: string; onRemove?: () => void }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-btn border border-line-strong bg-white px-2 py-0.5 text-xs">
      <span className="rounded-[3px] bg-[#1e7b45] px-1 font-mono text-[10px] text-white">XLSX</span>{name}
      {onRemove && <button type="button" aria-label={`${name} 빼기`} onClick={onRemove} className="text-muted hover:text-ink">×</button>}
    </span>
  );
}

/** AI 답의 **굵게**만 살린다 (나머지 마크다운은 글자 그대로) */
function bold(text: string) {
  return text.split(/\*\*(.+?)\*\*/g).map((s, i) => (i % 2 ? <b key={i}>{s}</b> : s));
}

/** 패널(빌더)에서 고친 내용 (AI가 쓴 설명은 그때 양식 기준이라, 바뀐 점은 여기서 따로 알린다) */
function Changes({ lines }: { lines: string[] }) {
  if (!lines.length) return null;
  return (
    <div className="rounded-card border border-[#f1d2ac] bg-[#fffcf7] px-3 py-2 text-sm">
      <b className="text-warn-ink">패널에서 고친 내용</b> <span className="text-xs text-sub">(위 AI 설명보다 이 내용이 최신이에요. 다음에 말하면 AI에게도 전해요)</span>
      <ul className="m-0 mt-1 pl-5">{lines.map((l, i) => <li key={i}>{l}</li>)}</ul>
    </div>
  );
}

function AiBubble({ m, last, linked, selKey }: { m: Msg; last: boolean; linked: boolean; selKey: string | null }) {
  return (
    <div className="flex max-w-full flex-col gap-2">
      {m.text && <div className={cx('whitespace-pre-wrap rounded-card px-3 py-2', /다시 만들 수 없어요/.test(m.text) ? 'border border-[#f3c2bd] bg-[#fffafa]' : 'bg-panel')}>{bold(m.text)}</div>}
      {m.status && <div className="flex items-center gap-2 text-xs text-sub"><span className="inline-block h-2 w-2 animate-pulse rounded-full bg-pri" />{m.status}…</div>}
      {m.badForm && <div className="rounded-card border border-[#f3c2bd] bg-[#fffafa] px-3 py-2 text-sm text-err-ink">AI가 만든 양식이 규칙에 맞지 않아요: {m.badForm}. "규칙에 맞게 다시 고쳐 줘"라고 말해 보세요.</div>}
      {m.form && <FormCard schema={m.form} problems={m.problems ?? []} edited={m.edited} last={last} linked={linked} selKey={selKey} />}
      {m.form && m.base && <Changes lines={describeChanges(m.base, m.form)} />}
      {m.error && <div className="text-sm text-err-ink">{m.error}</div>}
    </div>
  );
}

/** linked: 오른쪽 설정 패널과 연결된 카드 (고칠 때마다 미리보기가 바뀌고, 머리글을 누르면 패널에서 그 항목이 열린다) */
function FormCard({ schema, problems, edited, last, linked, selKey }: { schema: FormSchema; problems: string[]; edited?: boolean; last: boolean; linked: boolean; selKey: string | null }) {
  const org = schema.org.mode === 'preset' ? schema.org.orgs?.[0] : undefined;
  const model = useMemo(() => layoutSheet(schema, { mode: 'template', orgName: org }, { today: new Date() }), [schema, org]);
  const who = schema.org.mode === 'preset' ? `${orgLabel(schema)} ${schema.org.orgs?.length ?? 0}곳에 파일이 하나씩 나가요` : schema.org.mode === 'input' ? `작성자가 ${orgLabel(schema)}명을 직접 적어요` : '누가 냈는지 구분하지 않아요';
  // 엑셀은 오른쪽 패널의 내보내기 창으로 만든다: 제출 기한을 묻고(① 일정 정보) 내보낸 기록을 남겨 내 업무공간 취합 일정에 뜬다
  const toExcel = () => window.dispatchEvent(new CustomEvent('hanan-moa:export-form', { detail: { schema } }));
  return (
    <div className={cx('overflow-hidden rounded-card border', linked ? 'border-pri-line shadow-[0_0_0_3px_var(--color-pri-bg)]' : 'border-line')}>
      <div className="flex flex-wrap items-center gap-2 border-b border-line bg-panel px-3 py-2">
        <b>{schema.title || '(제목 없음)'}</b>
        <Chip tone="pri">{LAYOUT_LABELS[schema.layout]}</Chip>
        <span className="text-xs text-sub">{who}</span>
        {linked && <Chip tone="pri">● 설정 패널과 연결됨 · 고치면 바로 반영</Chip>}
        {edited && <Chip tone="warn">패널에서 고침 · 다음에 말하면 AI가 이 양식에서 이어 가요</Chip>}
        <span className="flex-1" />
        {problems.length === 0 ? <Chip tone="auto">검사 통과</Chip> : <Chip tone="err">고칠 곳 {problems.length}</Chip>}
      </div>
      <div className="max-h-[360px] overflow-auto bg-[#f7f8fa] p-2">
        <PreviewGrid model={model} schema={schema} flash={linked} selectedKey={linked ? selKey : undefined}
          onSelect={last ? (key) => window.dispatchEvent(new CustomEvent('hanan-moa:select-field', { detail: { key } })) : undefined} />
      </div>
      {problems.length > 0 && <ul className="m-0 border-t border-line px-6 py-2 text-sm text-err-ink">{problems.map((p, i) => <li key={i}>{p}</li>)}</ul>}
      <div className="flex flex-wrap items-center gap-2 border-t border-line px-3 py-2">
        {!linked && <Button variant="pri" size="sm" onClick={() => toPanel(schema, { preferStored: true })}>패널에서 고치기</Button>}
        {/* 예전 카드는 같은 양식의 옛 모습이라, 거기서 내보내면 버전·내보낸 기록이 꼬인다 → 마지막 카드에서만 */}
        {last && <Button size="sm" disabled={problems.length > 0} onClick={toExcel}>엑셀 내보내기</Button>}
        <Button size="sm" variant="ghost" onClick={() => exportFormJson(schema)}>양식 파일 저장</Button>
        {problems.length > 0 && <span className="text-xs text-sub">고칠 곳을 AI에게 "고쳐 줘"라고 하거나 오른쪽 패널에서 고쳐 주세요.</span>}
      </div>
    </div>
  );
}
