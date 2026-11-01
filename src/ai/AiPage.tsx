import { useEffect, useMemo, useRef, useState } from 'react';
import { cloudEnabled, cloudFetch, scopedStorageKey } from '../cloud';
import { loadDraft, useCloudDraft, type Draft } from './useCloudDraft';
import { deleteThread, findThreadForForm, listThreads, loadThread, newThreadId, recoverFromServerChat, saveThread, type ThreadSummary } from './threads';
import { AttachmentError, bytesForLocal, buildCloudChatBody, isCutSource, LockedFileError, MAX_CLOUD_FILE, prepareCloudSources, readSheetList, WrongPasswordError, type CloudSource } from './cloudAttachments';
import { defaultPick, isPartial, pickedSheets, SheetPicker, type SheetPick } from './SheetPicker';
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
import { Button, Chip, cx } from '@gen/ui/ui';

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

/** 빈 화면 예시: 제목·한 줄 설명·구조를 보여 주고, 누르면 text가 입력창에 들어간다 */
const EXAMPLES = [
  { title: '지사별 교육 참가자 명단', desc: '이름·직급·참가 희망일 · 지사 전체', layout: '목록형', text: '지사별 교육 참가자 명단을 받고 싶어요. 이름·직급·참가 희망일, 지사 전체' },
  { title: '부서별 안전보호구 지급 내역', desc: '위에 담당자·연락처, 아래에 품목·수량·단가', layout: '혼합형', text: '위에 담당자·연락처를 받고, 아래에 안전보호구 지급 내역(품목·수량·단가)을 받는 부서별 양식' },
  { title: '협력기관 분기별 에너지 절감량', desc: '10곳 · 1~4분기 · 항목별 숫자 표', layout: '표형', text: '협력기관 10곳에서 분기별(1~4분기) 에너지 절감량을 항목별 숫자 표로 받고 싶어요' },
  { title: '2027 사업예산 요구표', desc: '사업별로 지사마다 자기 열에 요구액', layout: '표형', text: '2027 사업예산 요구표. 사업별로 지사마다 자기 열에 요구액을 적게 해 주세요' },
];
const MODEL_KEY = 'hanan-moa:ai-openai-model';
// 올릴 수 있는 엑셀 크기: 온라인은 브라우저에서 요약만 보내므로 크게, 로컬 연결은 원본을 보내므로 10MB
const MAX_FILE = cloudEnabled ? MAX_CLOUD_FILE : 10 * 1024 * 1024;
const MAX_FILE_LABEL = `${MAX_FILE / 1024 / 1024}MB`;
const isExcel = (f: File) => /\.(xlsx|xlsm|xls)$/i.test(f.name);

async function toBase64(f: File): Promise<string> {
  const bytes = await bytesForLocal(f);   // 열기 암호를 푼 파일은 푼 내용
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
const SOURCES_KEY = 'hanan-moa:ai-sources';
function loadSources(): CloudSource[] {
  try { const xs = JSON.parse(sessionStorage.getItem(scopedStorageKey(SOURCES_KEY)) ?? '[]'); return Array.isArray(xs) ? xs : []; } catch { return []; }
}
function loadChat(): { chatId: string | null; msgs: Msg[]; aiVersion: string | null; threadId?: string } {
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
  // 대화 보관함 번호 (src/ai/threads.ts). 말이 오가기 시작하면 붙인다
  const [threadId, setThreadId] = useState<string | null>(saved.threadId ?? null);
  const [input, setInput] = useState('');
  const [attached, setAttached] = useState<File[]>([]);   // 쓰던 엑셀 올리기
  const [fileNote, setFileNote] = useState('');
  const [consent, setConsent] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  // 첨부 엑셀마다 AI에게 보낼 시트 (브라우저 안에서 시트 목록만 읽는다. .xls는 바꿔 읽고, 열기 암호는 여기서 푼다)
  const [sheetPicks, setSheetPicks] = useState<Map<File, SheetPick>>(new Map());
  const setPick = (f: File, p: SheetPick) => setSheetPicks((m) => new Map(m).set(f, p));
  const loadSheets = (f: File, password?: string) => {
    setPick(f, { status: 'loading' });
    readSheetList(f, password).then((sheets) => setPick(f, { status: 'ok', sheets, picked: defaultPick(sheets) }))
      .catch((e: Error) => setPick(f, e instanceof LockedFileError || e instanceof WrongPasswordError
        ? { status: 'locked', message: e instanceof WrongPasswordError ? e.message : '열기 암호가 걸린 파일이에요.', wrong: e instanceof WrongPasswordError }
        : { status: 'error', message: e.message }));
  };
  const pickBlocked = attached.some((f) => { const p = sheetPicks.get(f); return p?.status === 'loading' || p?.status === 'locked' || pickedSheets(p)?.length === 0; });
  // 빈 화면에서 고르는 시작 방법: 말로 만들기 / 쓰던 엑셀로 만들기
  const [mode, setMode] = useState<'say' | 'excel'>('say');
  const addFiles = (list: FileList | File[]) => {
    if (busy) return;
    const fs = [...list];
    setConsent(false);
    const bad = fs.filter((f) => !isExcel(f) || f.size > MAX_FILE);
    setFileNote(bad.length ? `엑셀 파일(.xlsx·.xlsm·.xls, ${MAX_FILE_LABEL} 이하)만 올릴 수 있어요: ${bad.map((f) => f.name).join(', ')}` : '');
    const good = fs.filter((f) => isExcel(f) && f.size <= MAX_FILE);
    setAttached((xs) => [...xs, ...good].slice(0, 5));
    for (const f of good) loadSheets(f);
    setMode('excel');   // 빈 화면이면 "쓰던 엑셀로 만들기"로 바꿔 올린 파일을 보여 준다
  };
  const [busy, setBusy] = useState(false);
  const abort = useRef<AbortController | null>(null);
  // 온라인: 이 대화에서 올린 엑셀 요약. 서버는 대화 글만 기억하므로 다음 말("네" 등)에도 함께 보낸다 (이 탭에서만 보관)
  const sources = useRef<CloudSource[]>(loadSources());
  const keepSources = (xs: CloudSource[]) => { sources.current = xs; try { sessionStorage.setItem(scopedStorageKey(SOURCES_KEY), JSON.stringify(xs)); } catch { /* 보관 못 해도 됨 */ } };
  const end = useRef<HTMLDivElement>(null);

  const draftSync = useCloudDraft({ chatId, msgs, aiVersion, ...(threadId ? { threadId } : {}) }, busy, (draft: Draft) => {
    setChatId(draft.chatId); setMsgs(draft.msgs as Msg[]); setAiVersion(draft.aiVersion); setThreadId(draft.threadId ?? null);
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

  // ── 대화 보관함: 지금 대화를 남기고, 내 업무공간에서 연 양식의 대화로 바꾼다 ──
  useEffect(() => { if (msgs.length && !threadId) setThreadId(newThreadId()); }, [msgs.length, threadId]);
  const [archiveNote, setArchiveNote] = useState('');
  const now = useRef({ threadId, chatId, msgs, aiVersion, busy }); now.current = { threadId, chatId, msgs, aiVersion, busy };
  const canSwitch = !cloudEnabled || draftSync.ready;
  useEffect(() => {
    if (!threadId || !msgs.length || busy || !canSwitch) return;
    const t = setTimeout(() => { void saveThread({ threadId, chatId, msgs, aiVersion }).then((e) => setArchiveNote(e ? '이 대화를 서버 대화 목록에 남기지 못했어요 (이 기기에는 남아 있어요).' : '')); }, 800);
    return () => clearTimeout(t);
  }, [threadId, chatId, msgs, aiVersion, busy, canSwitch]);
  const [opening, setOpening] = useState('');   // 대화를 찾는 중 안내
  /** 다른 대화로 바꾼다. form: 그 대화에서 열 양식 → 마지막 카드가 그 양식이 되게 (아니면 카드를 붙인다) */
  const switchTo = async (next: { threadId: string; chatId: string | null; msgs: Msg[]; aiVersion: string | null }, form?: FormSchema, note = '내 업무공간에서 연 양식이에요. 오른쪽 패널에서 고치거나, 여기서 말로 고쳐 달라고 해 주세요.') => {
    const cur = now.current;
    if (cur.threadId && cur.msgs.length && cur.threadId !== next.threadId) await saveThread(cur);
    let xs = next.msgs;
    if (form) {
      const found = loadForm(form.formId)?.schema;
      const s = found && sameForm(found, form) ? found : form;
      const i = xs.map((m) => !!m.form).lastIndexOf(true);
      if (i >= 0 && xs[i].form!.formId === s.formId) {
        if (sig(xs[i].form!) !== sig(s)) xs = xs.map((m, k) => (k === i ? { ...m, ...checkLocal(s), edited: true, base: m.base ?? m.form } : m));
      } else xs = [...xs, { role: 'ai', opened: true, text: note, ...checkLocal(s) }];
    }
    setThreadId(next.threadId); setChatId(next.chatId); setAiVersion(next.aiVersion); setMsgs(xs);
    setInput(''); setAttached([]); setSheetPicks(new Map()); setFileNote(''); keepSources([]);
  };
  /** 내 업무공간(일정·양식 카드)에서 양식을 열었다 → 그 양식을 만든 대화와 미리보기를 보여 준다 */
  const openFor = async (form: FormSchema) => {
    const cur = now.current;
    if (cur.busy) { setOpening('AI가 답하는 중이라 대화를 바꾸지 않았어요. 답이 끝난 뒤 다시 열어 주세요.'); return; }
    if (cur.msgs.some((m) => m.form?.formId === form.formId)) { await switchTo({ ...cur, threadId: cur.threadId ?? newThreadId() }, form); return; }
    setOpening('이 양식을 만든 대화를 찾고 있어요…');
    try {
      const t = await findThreadForForm(form.formId);
      if (t) { await switchTo({ threadId: t.threadId, chatId: t.chatId, msgs: t.msgs as Msg[], aiVersion: t.aiVersion }, form); setOpening(''); return; }
      const rec = await recoverFromServerChat(form.formId).catch(() => null);
      if (rec && rec.msgs.length) {
        await switchTo({ threadId: newThreadId(), chatId: rec.chatId, msgs: rec.msgs, aiVersion: rec.form ? sig(rec.form) : '' }, form,
          '예전 대화는 글만 남아 있어 다시 불러왔어요. 이 양식의 미리보기예요. 여기서 이어서 말하면 같은 대화로 이어져요.');
      } else {
        await switchTo({ threadId: newThreadId(), chatId: null, msgs: [], aiVersion: '' }, form,
          '이 양식을 만든 대화 기록이 남아 있지 않아 양식만 불러왔어요. 오른쪽 패널에서 고치거나, 여기서 말로 고쳐 달라고 해 주세요.');
      }
      setOpening('');
    } catch (e) { setOpening(`대화를 불러오지 못했어요: ${(e as Error).message}`); }
  };
  const openForRef = useRef(openFor); openForRef.current = openFor;
  const pendingOpen = useRef<FormSchema | null>(null);
  useEffect(() => {
    const on = (e: Event) => {
      const d = (e as CustomEvent<{ schema: FormSchema; from?: string }>).detail;
      if (d.from !== 'workspace') return;
      if (canSwitchRef.current) void openForRef.current(d.schema); else pendingOpen.current = d.schema;
    };
    window.addEventListener('hanan-moa:open-form', on);
    return () => window.removeEventListener('hanan-moa:open-form', on);
  }, []);
  const canSwitchRef = useRef(canSwitch); canSwitchRef.current = canSwitch;
  useEffect(() => { if (canSwitch && pendingOpen.current) { const f = pendingOpen.current; pendingOpen.current = null; void openFor(f); } });
  const [threadList, setThreadList] = useState<{ list: ThreadSummary[]; error?: string; loading?: boolean } | null>(null);
  // [대화 목록] 옆 숫자: 남아 있는 대화 수 (지금 대화가 바뀌거나 목록을 열 때 다시 센다)
  const [threadCount, setThreadCount] = useState(0);
  const hasMsgs = msgs.length > 0;
  useEffect(() => { let alive = true; void listThreads().then((r) => { if (alive) setThreadCount(r.list.length); }).catch(() => {}); return () => { alive = false; }; }, [threadId, hasMsgs]);
  const showThreads = async () => {
    const cur = now.current;
    if (cur.threadId && cur.msgs.length) await saveThread(cur);
    setThreadList({ list: [], loading: true }); const r = await listThreads(); setThreadList(r); setThreadCount(r.list.length);
  };
  /** [대화 목록]에서 지우기. 지금 대화를 지우면 빈 대화로 시작한다(보관함에 다시 남기지 않게 먼저 비운다) */
  const removeThread = async (id: string) => {
    const cur = now.current;
    if (cur.busy) return;
    if (id === cur.threadId) {
      draftSync.markCleared();
      setChatId(null); setMsgs([]); setInput(''); setAiVersion(null); setAttached([]); setSheetPicks(new Map()); keepSources([]); setThreadId(null); setMode('say');
      now.current = { ...cur, threadId: null, msgs: [] };
    }
    const err = await deleteThread(id);
    const r = await listThreads();
    setThreadList((x) => (x ? r : x)); setThreadCount(r.list.length);
    setOpening(err ?? '');
  };
  const pickThread = async (id: string) => {
    setThreadList(null);
    if (id === now.current.threadId || now.current.busy) return;
    const t = await loadThread(id);
    if (!t) { setOpening('그 대화를 불러오지 못했어요.'); return; }
    setOpening('');
    await switchTo({ threadId: t.threadId, chatId: t.chatId, msgs: t.msgs as Msg[], aiVersion: t.aiVersion });
    const last = [...(t.msgs as Msg[])].reverse().find((m) => m.form)?.form;
    if (last && !isRemoved(last.formId)) toPanel(loadForm(last.formId)?.schema ?? last, { auto: true, preferStored: true });
  };


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
    if (files.length && pickBlocked) { setFileNote('첨부 엑셀을 여는 중이거나, 암호 입력·시트 고르기가 남아 있어요.'); return; }
    const picks = files.map((f) => pickedSheets(sheetPicks.get(f)));
    const fileLabels = files.map((f, i) => (isPartial(sheetPicks.get(f)) ? `${f.name} · ${picks[i]!.join(', ')}` : f.name));
    setInput('');
    setFileNote('');
    setBusy(true);
    setMsgs((xs) => [...xs, { role: 'user', text: message, ...(files.length ? { files: fileLabels } : {}) }, { role: 'ai', text: '', status: files.length ? '엑셀 올리는 중' : '보내는 중' }]);
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
      // 로컬 연결 서버는 원본 파일을 읽으므로, 일부 시트만 골랐으면 말로 알린다
      const sheetNote = !cloudEnabled && files.some((f) => isPartial(sheetPicks.get(f)))
        ? `\n(첨부 엑셀에서 이 시트만 보고 만들어 주세요: ${files.flatMap((f, i) => (isPartial(sheetPicks.get(f)) ? [`${f.name} → ${picks[i]!.join(', ')}`] : [])).join(' / ')})` : '';
      const text = (form ? `(${lastMsg?.opened && !edited ? '사용자가 양식을 직접 열었어요' : '사용자가 빌더에서 form.json을 직접 고쳤어요'}. 지금 form.json에서 이어서 해 주세요.${changes.length ? ` 고친 내용: ${changes.join(' / ')}` : ''})\n${message}` : message) + sheetNote;
      // 온라인 서버는 engine(codex = OpenAI)·요약(sources)만 받고, 로컬 연결 서버는 model·원본 파일을 받는다
      const body = cloudEnabled
        ? buildCloudChatBody({ chatId: chatId ?? undefined, engine: 'codex', message: text, form, sources: files.length ? await prepareCloudSources(files, consent, picks).then((xs) => {
          keepSources(xs);
          // 한도 때문에 뒤쪽 행을 못 담았으면 보낸 말의 파일 칩에 알린다 (AI도 요약에 적힌 안내를 보고 말해 준다)
          if (xs.some(isCutSource)) setMsgs((ms) => ms.map((m, k) => (k === ms.length - 2 && m.files ? { ...m, files: m.files.map((n, j) => (xs[j] && isCutSource(xs[j]) ? `${n} · 일부 행만 담음` : n)) } : m)));
          return xs;
        }) : sources.current })
        : JSON.stringify({ chatId: chatId ?? undefined, model: openaiModel, message: text, form, files: await Promise.all(files.map(async (f) => ({ name: f.name, base64: await toBase64(f) }))) });
      if (ctl.signal.aborted) throw new DOMException('취소됨', 'AbortError');
      setAttached([]); setConsent(false); setSheetPicks(new Map());
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
      if ((err as Error).name !== 'AbortError') patchLast((m) => ({ ...m, error: err instanceof ServerMessageError || err instanceof AttachmentError ? err.message : `연결이 끊겼어요: ${(err as Error).message}` }));
      else patchLast((m) => ({ ...m, error: '멈췄어요' }));
    } finally {
      patchLast((m) => ({ ...m, status: undefined, ...(m.text || m.form || m.error ? {} : { error: 'AI 답을 받지 못했어요. 같은 말을 한 번 더 보내 주세요.' }) }));
      setBusy(false);
      abort.current = null;
    }
  };

  const reset = () => {
    if (busy || (cloudEnabled && !draftSync.ready)) return;
    // 지금 대화는 [대화 목록]에 남긴다
    if (threadId && msgs.length) void saveThread({ threadId, chatId, msgs, aiVersion });
    draftSync.markCleared();
    abort.current?.abort(); setChatId(null); setMsgs([]); setInput(''); setAiVersion(null); setAttached([]); setSheetPicks(new Map()); keepSources([]); setThreadId(null); setOpening('');
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
  const empty = msgs.length === 0;
  const canSend = (input.trim() || attached.length) && ok && draftSync.ready && !(cloudEnabled && attached.length > 0 && !consent) && !(attached.length > 0 && pickBlocked);
  const pickFile = () => fileRef.current?.click();
  // 첨부 파일 칩 줄 + (온라인) 요약 전달 동의. 입력창 상자 안 맨 위에 둔다
  const attachBlock = (
    <>
      {(attached.length > 0 || fileNote) && (
        <div className="flex flex-wrap items-center gap-1.5">
          {attached.map((f, i) => <FileChip key={`${f.name}-${i}`} name={f.name} onRemove={() => setAttached((xs) => xs.filter((_, k) => k !== i))} />)}
          {fileNote && <span className="text-xs text-err-ink">{fileNote}</span>}
        </div>
      )}
      <SheetPicker files={attached} picks={sheetPicks} disabled={busy}
        onChange={(f, picked) => { const p = sheetPicks.get(f); if (p?.status === 'ok') setPick(f, { ...p, picked }); }}
        onUnlock={(f, password) => loadSheets(f, password)} />
      {cloudEnabled && attached.length > 0 && <label className="text-sm"><input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} disabled={busy} /> 원본은 브라우저에서만 분석하고 서버에 저장하지 않아요. 민감한 셀 값이 포함될 수 있는 요약 내용이 외부 AI로 전달되는 것에 동의해요.</label>}
    </>
  );
  /** 입력창: 글 입력칸 + [엑셀 올리기] + 둥근 보내기 버튼을 한 상자에 */
  const composer = (placeholder: string, opts: { attach?: boolean; rows?: number } = {}) => (
    <div className="flex flex-col gap-2 rounded-[16px] border border-line-strong bg-white px-3.5 pb-2.5 pt-3 text-left shadow-[0_2px_10px_rgba(20,30,20,.06)] focus-within:border-pri-line focus-within:shadow-[0_0_0_4px_var(--color-pri-bg)]">
      {attachBlock}
      <textarea aria-label="AI에게 보낼 말" rows={opts.rows ?? 2} value={input} disabled={health === 'checking'} placeholder={placeholder}
        className="w-full resize-none border-0 bg-transparent p-0 text-[14.5px] leading-relaxed text-ink outline-none placeholder:text-muted"
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send(); } }} />
      <div className="flex items-center gap-2">
        {opts.attach !== false && <Button size="sm" disabled={busy || health === 'checking'} onClick={pickFile} title="쓰던 엑셀 양식 올리기" className="inline-flex items-center gap-1"><Icon name="clip" />엑셀 올리기</Button>}
        <span className="flex-1" />
        <span className="text-xs text-muted max-sm:hidden"><kbd className="mr-1 rounded border border-b-2 border-line-strong bg-white px-1 font-sans text-[10.5px] font-semibold text-sub">Enter</kbd>보내기</span>
        {busy
          ? <button type="button" aria-label="멈추기" onClick={() => abort.current?.abort()} className="grid size-9 place-items-center rounded-full border border-line-strong bg-white text-ink hover:bg-panel"><span className="size-3 rounded-[2px] bg-ink" /></button>
          : <button type="button" aria-label="보내기" disabled={!canSend} onClick={() => void send()}
              className="grid size-9 place-items-center rounded-full bg-pri text-white shadow-[0_2px_6px_rgba(55,145,63,.3)] hover:bg-pri-ink disabled:bg-line-strong disabled:shadow-none"><Icon name="up" size={18} /></button>}
      </div>
    </div>
  );
  const foot = <p className="m-0 text-center text-xs text-muted">보낸 말은 OpenAI{!cloudEnabled && openaiModel ? ` ${openaiModel}` : ''}로 전달돼요 · {cloudEnabled ? '엑셀은 원본 대신 동의한 요약만 보내요' : '회신 파일 내용은 보내지 않아요'}</p>;

  return (
    <div className="mx-auto flex h-full max-w-[1080px] flex-col gap-2 px-4 pb-3 pt-3"
      onDragOver={(e) => { if (e.dataTransfer.types.includes('Files')) e.preventDefault(); }}
      onDrop={(e) => { if (e.dataTransfer.files.length) { e.preventDefault(); addFiles(e.dataTransfer.files); } }}>
      <input ref={fileRef} type="file" accept=".xlsx,.xlsm,.xls" multiple hidden aria-label="엑셀 파일 고르기"
        onChange={(e) => { if (e.target.files) addFiles(e.target.files); e.target.value = ''; }} />
      {/* 머리줄: [대화 목록]은 흰 테두리 + 대화 수, [새 대화]는 초록 채움 */}
      <div className="flex flex-wrap items-center justify-end gap-2">
        {!cloudEnabled && models.length > 0 && (
          <select aria-label="OpenAI 모델" className="mr-auto rounded-box border border-line bg-white px-2 py-1 text-[13px]" value={openaiModel} disabled={busy}
            onChange={(e) => setModel(e.target.value)}>
            {models.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        )}
        <div className="relative">
          <button type="button" aria-label="대화 목록" aria-expanded={!!threadList} disabled={busy || !canSwitch} onClick={() => (threadList ? setThreadList(null) : void showThreads())}
            className="inline-flex h-[34px] items-center gap-1.5 rounded-[9px] border border-line-strong bg-white px-3 text-[13.5px] font-semibold text-ink shadow-[0_1px_0_rgba(0,0,0,.03)] hover:bg-panel disabled:opacity-50">
            <Icon name="clock" />대화 목록{threadCount ? <span className="grid h-[19px] min-w-[19px] place-items-center rounded-full bg-chip px-1.5 text-[11px] font-bold text-sub">{threadCount}</span> : null}
          </button>
          {threadList && <ThreadMenu data={threadList} current={threadId} onPick={(id) => void pickThread(id)} onDelete={(id) => removeThread(id)} onClose={() => setThreadList(null)} />}
        </div>
        <button type="button" disabled={busy || !draftSync.ready} onClick={() => { reset(); setMode('say'); }}
          className="inline-flex h-[34px] items-center gap-1.5 rounded-[9px] bg-pri px-3.5 text-[13.5px] font-semibold text-white shadow-[0_2px_6px_rgba(55,145,63,.25)] hover:bg-pri-ink disabled:opacity-50 disabled:shadow-none">
          <Icon name="plus" />새 대화
        </button>
      </div>
      {(opening || archiveNote) && <div role="status" className="rounded-box border border-line bg-panel px-3 py-2 text-[13px] text-sub">{opening || archiveNote}</div>}

      {cloudEnabled && (!draftSync.ready || draftSync.notice) && <div role="status" className="rounded-box border border-line p-3 text-sm">
        {draftSync.notice || '서버 대화를 불러오는 중이에요. 완료되면 AI에게 보낼 수 있어요.'}
        {draftSync.conflict ? <div className="mt-2 flex gap-2"><Button onClick={draftSync.chooseServer}>서버 대화 불러오기</Button><Button onClick={draftSync.chooseLocal}>이 기기 대화 저장</Button></div>
          : draftSync.notice && <Button onClick={draftSync.reload}>다시 불러오기</Button>}
      </div>}

      {empty ? (
        <div className="min-h-0 flex-1 overflow-auto">
          <div className="mx-auto flex min-h-full max-w-[720px] flex-col items-center pt-6">
            <div className="mb-3 grid size-11 place-items-center rounded-[14px] bg-[linear-gradient(135deg,var(--color-pri-bg),var(--color-acc-bg))] text-pri-ink"><Icon name="spark" size={22} /></div>
            <h1 className="m-0 text-[26px] font-bold tracking-tight">무엇을 받고 싶으세요?</h1>
            {/* 시작 방법 고르기 */}
            <div role="tablist" aria-label="시작 방법" className="mt-5 inline-flex gap-1.5 rounded-[14px] border border-line bg-white p-[5px] shadow-[0_1px_3px_rgba(20,30,20,.05)]">
              {([['say', '말로 만들기', '받고 싶은 내용을 적어요', 'chat'], ['excel', '쓰던 엑셀로 만들기', '같은 모양으로 만들어요', 'clip']] as const).map(([id, t, d, ic]) => {
                const on = mode === id, pink = id === 'excel';
                return (
                  <button key={id} type="button" role="tab" aria-selected={on} onClick={() => setMode(id)}
                    className={cx('flex items-center gap-2.5 rounded-[10px] border py-2 pl-2.5 pr-4 text-left',
                      on ? (pink ? 'border-[#efc3bf] bg-acc-bg' : 'border-pri-line bg-pri-bg') : 'border-transparent hover:bg-panel')}>
                    <span className={cx('grid size-7 place-items-center rounded-[9px]', pink ? 'bg-acc-bg text-acc-ink' : 'bg-pri-bg text-pri-ink')}><Icon name={ic} /></span>
                    <span><b className={cx('block text-[14px]', on && (pink ? 'text-acc-ink' : 'text-pri-ink'))}>{t}</b><span className="block text-[11.5px] text-muted">{d}</span></span>
                  </button>
                );
              })}
            </div>
            <div className="mt-[18px] w-full">
              {mode === 'say' ? (
                <>
                  {composer('예: 지사별 동절기 안전교육 이수자 명단. 담당자 연락처도 받고, 교육비는 원 단위로', { attach: false })}
                  <div className="mb-2.5 mt-5 text-xs font-semibold text-muted">이렇게 말해 보세요</div>
                  <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                    {EXAMPLES.map((x) => (
                      <button key={x.title} type="button" onClick={() => setInput(x.text)}
                        className="flex flex-col gap-0.5 rounded-[12px] border border-line bg-white px-3.5 py-2.5 text-left hover:border-pri-line hover:bg-pri-bg/40">
                        <span className="flex items-center gap-1.5 text-[13.5px] font-bold text-ink">{x.title}<span className="rounded-full bg-chip px-2 text-[11.5px] font-semibold leading-[21px] text-sub">{x.layout}</span></span>
                        <span className="text-[12.5px] text-muted">{x.desc}</span>
                      </button>
                    ))}
                  </div>
                </>
              ) : attached.length === 0 ? (
                <>
                  <button type="button" onClick={pickFile} disabled={busy || health === 'checking'}
                    className="flex h-[236px] w-full flex-col items-center justify-center gap-2 rounded-[14px] border-2 border-dashed border-[#e7b9b5] bg-[linear-gradient(180deg,#fffafa,#fff)] text-center hover:border-acc">
                    <span className="grid h-[46px] w-10 place-items-center rounded-[7px] bg-[#1e7b45] text-[11px] font-extrabold text-white shadow-[0_3px_8px_rgba(30,123,69,.25)]">XLSX</span>
                    <b className="text-[14px] text-ink">쓰던 엑셀을 여기에 끌어다 놓기</b>
                    <span className="text-xs text-muted">또는 <u className="text-acc-ink underline-offset-[3px]">파일 고르기</u> · .xlsx·.xls {MAX_FILE_LABEL}까지, 5개까지</span>
                  </button>
                  {fileNote && <p className="m-0 mt-2 text-xs text-err-ink">{fileNote}</p>}
                  <div className="mt-3.5 flex items-center gap-2.5 rounded-[12px] border border-line bg-white px-3 py-2.5 text-[12.5px] text-sub">
                    <span className="grid size-7 flex-none place-items-center rounded-[9px] bg-pri-bg text-pri-ink"><Icon name="chat" /></span>
                    파일을 넣으면 입력창이 열려요. "열 이름은 그대로, 교육비만 빼 주세요"처럼 덧붙여 보낼 수 있어요.
                  </div>
                </>
              ) : (
                composer('덧붙일 말이 있으면 적어 주세요 (예: 열 이름은 그대로, 교육비만 빼 주세요). 비워 두고 보내도 돼요')
              )}
            </div>
            <div className="mt-auto pt-6">{foot}</div>
          </div>
        </div>
      ) : (
        <>
          <div className="min-h-0 flex-1 overflow-auto" aria-live="polite">
            <div className="mx-auto flex max-w-[820px] flex-col gap-3.5 py-2">
              {msgs.map((m, i) => (m.role === 'user'
                ? <div key={i} className="ml-auto flex max-w-[80%] flex-col items-end gap-1">
                    {m.files?.length ? <div className="flex flex-wrap justify-end gap-1">{m.files.map((n) => <FileChip key={n} name={n} />)}</div> : null}
                    <div className="whitespace-pre-wrap rounded-[14px] rounded-br-[4px] bg-pri-bg px-3.5 py-2 text-[13.5px]">{m.text}</div>
                  </div>
                : <AiBubble key={i} m={m} last={i === lastFormAt} linked={i === lastFormAt && panelOpen} selKey={i === lastFormAt ? selKey : null} />))}
              <div ref={end} />
            </div>
          </div>
          <div className="mx-auto flex w-full max-w-[820px] flex-col gap-1.5">
            {composer(lastForm ? '고칠 내용을 말해 주세요 (예: 교육비는 빼 주세요, 제출처를 부서로 바꿔 주세요)' : '예: 지사별 동절기 안전교육 이수자 명단. 담당자 연락처도 받고, 교육비는 원 단위로', { rows: 1 })}
            {foot}
          </div>
        </>
      )}
    </div>
  );
}

/** 대화창 아이콘 (선 아이콘, 글자색을 따름) */
const ICONS = {
  plus: <path d="M12 5v14M5 12h14" />,
  clock: <><circle cx="12" cy="12" r="8.5" /><path d="M12 7v5l3 2" /></>,
  clip: <path d="M20.5 11.5 12.4 19.6a5 5 0 0 1-7.1-7.1l8.3-8.3a3.4 3.4 0 0 1 4.8 4.8l-8.3 8.3a1.7 1.7 0 0 1-2.4-2.4l7.6-7.6" />,
  up: <path d="M12 19V5M5.5 11.5 12 5l6.5 6.5" />,
  chat: <path d="M5 6.5A2.5 2.5 0 0 1 7.5 4h9A2.5 2.5 0 0 1 19 6.5v6a2.5 2.5 0 0 1-2.5 2.5H11l-4 4v-4A2 2 0 0 1 5 13z" />,
  trash: <><path d="M4.5 7h15M9.5 7V4.8h5V7M6.5 7l.8 12.2h9.4L17.5 7" /><path d="M10.2 10.5v5.5M13.8 10.5v5.5" /></>,
  spark: <><path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" /><path d="M19 15.5l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z" /></>,
};
function Icon({ name, size = 16 }: { name: keyof typeof ICONS; size?: number }) {
  return <svg aria-hidden width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={size > 16 ? 2.2 : 1.9} strokeLinecap="round" strokeLinejoin="round" className="flex-none">{ICONS[name]}</svg>;
}

/** [대화 목록]: 예전 대화로 돌아간다 (최근 순). 줄마다 [지우기] → 그 자리에서 한 번 더 확인 */
function ThreadMenu({ data, current, onPick, onDelete, onClose }: { data: { list: ThreadSummary[]; error?: string; loading?: boolean }; current: string | null; onPick: (id: string) => void; onDelete: (id: string) => Promise<void>; onClose: () => void }) {
  const when = (iso: string) => { const d = new Date(iso); return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
  const [ask, setAsk] = useState<string | null>(null);   // 지울지 묻는 대화
  const [busyId, setBusyId] = useState<string | null>(null);
  return (
    <>
      <div className="fixed inset-0 z-20" aria-hidden onClick={onClose} />
      <div role="menu" aria-label="대화 목록" className="absolute right-0 top-full z-30 mt-1 flex max-h-[60vh] w-[360px] flex-col overflow-auto rounded-card border border-line bg-white p-1 shadow-lg">
        {data.error && <p className="m-0 px-2 py-1.5 text-xs text-warn-ink">서버 대화 목록을 읽지 못해 이 기기 대화만 보여요.</p>}
        {data.list.length === 0 && <p className="m-0 px-2 py-3 text-center text-sub">{data.loading ? '불러오는 중…' : '남아 있는 대화가 없어요.'}</p>}
        {data.list.map((t) => ask === t.threadId ? (
          <div key={t.threadId} role="group" aria-label={`${t.title} 대화 지우기 확인`} className="flex flex-col gap-1.5 rounded-box border border-[#f3c2bd] bg-[#fffafa] px-2.5 py-2">
            <span className="text-[13px]"><b className="font-semibold">{t.title}</b> 대화를 지울까요?</span>
            <span className="text-xs text-sub">대화 목록과 서버의 AI 대화 기록에서 지워요. 만든 양식은 내 양식에 그대로 남아요.{t.threadId === current ? ' 지금 대화라 빈 대화로 시작해요.' : ''}</span>
            <span className="flex justify-end gap-1.5">
              <Button size="sm" disabled={!!busyId} onClick={() => setAsk(null)}>취소</Button>
              <Button size="sm" variant="danger" disabled={!!busyId} onClick={() => { setBusyId(t.threadId); void onDelete(t.threadId).finally(() => { setBusyId(null); setAsk(null); }); }}>{busyId === t.threadId ? '지우는 중…' : '지우기'}</Button>
            </span>
          </div>
        ) : (
          <div key={t.threadId} className={cx('group flex items-center rounded-box hover:bg-pri-bg', t.threadId === current && 'bg-panel')}>
            <button type="button" role="menuitem" onClick={() => onPick(t.threadId)} className="flex min-w-0 flex-1 flex-col items-start gap-0.5 px-2.5 py-2 text-left">
              <span className="w-full truncate text-[13.5px] font-semibold">{t.title}</span>
              <span className="text-xs text-muted">{when(t.updatedAt)}{t.formIds.length ? ` · 양식 ${t.formIds.length}개` : ''}{t.threadId === current ? ' · 지금 대화' : ''}</span>
            </button>
            <button type="button" aria-label={`${t.title} 대화 지우기`} title="대화 지우기" onClick={() => setAsk(t.threadId)}
              className="mr-1.5 grid size-7 flex-none place-items-center rounded-btn text-muted opacity-60 hover:bg-err hover:text-err-ink hover:opacity-100 group-hover:opacity-100">
              <Icon name="trash" />
            </button>
          </div>
        ))}
      </div>
    </>
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
    <div className="flex max-w-full gap-2.5">
    <span aria-hidden className="grid size-7 flex-none place-items-center rounded-[9px] bg-[linear-gradient(135deg,var(--color-pri),#7cbf6d)] text-[11px] font-extrabold text-white">AI</span>
    <div className="flex min-w-0 flex-1 flex-col gap-2 text-[13.5px]">
      {m.text && <div className={cx('whitespace-pre-wrap', /다시 만들 수 없어요/.test(m.text) ? 'rounded-card border border-[#f3c2bd] bg-[#fffafa] px-3 py-2' : 'pt-1')}>{bold(m.text)}</div>}
      {m.status && <div className="flex items-center gap-2 text-xs text-sub"><span className="inline-block h-2 w-2 animate-pulse rounded-full bg-pri" />{m.status}…</div>}
      {m.badForm && <div className="rounded-card border border-[#f3c2bd] bg-[#fffafa] px-3 py-2 text-sm text-err-ink">AI가 만든 양식이 규칙에 맞지 않아요: {m.badForm}. "규칙에 맞게 다시 고쳐 줘"라고 말해 보세요.</div>}
      {m.form && <FormCard schema={m.form} problems={m.problems ?? []} edited={m.edited} last={last} linked={linked} selKey={selKey} />}
      {m.form && m.base && <Changes lines={describeChanges(m.base, m.form)} />}
      {m.error && <div className="text-sm text-err-ink">{m.error}</div>}
    </div>
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
