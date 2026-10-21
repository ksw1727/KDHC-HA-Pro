import { useEffect, useMemo, useRef, useState } from 'react';
import { LAYOUT_LABELS, orgLabel, validateSchema, type FormSchema } from '@contract/schema';
import { layoutSheet } from '@contract/layout';
import { validateForExport } from '@gen/state/validateForExport';
import { exportForm } from '@gen/export/exportZip';
import { downloadBlob, exportFormJson } from '@gen/export/exportJson';
import { noticeText } from '@gen/export/noticeText';
import { PreviewGrid } from '@gen/preview/PreviewGrid';
import { Button, Chip, TextArea, cx } from '@gen/ui/ui';

type Engine = 'claude' | 'codex';
type AiEvent =
  | { type: 'chat'; chatId: string } | { type: 'status'; text: string } | { type: 'text'; text: string }
  | { type: 'form'; schema: unknown } | { type: 'error'; text: string } | { type: 'done' };

interface Msg {
  role: 'user' | 'ai';
  text: string;
  status?: string;         // AI가 지금 하는 일 (끝나면 지움)
  error?: string;
  form?: FormSchema;
  problems?: string[];     // 양식 규칙 위반 (있으면 내보내기 전에 고쳐야 함)
  badForm?: string;        // 양식 정의가 아예 틀렸을 때
}

const ENGINES: [Engine, string][] = [['claude', 'Claude'], ['codex', 'Codex']];
const EXAMPLES = [
  '지사별 교육 참가자 명단을 받고 싶어요. 이름·직급·참가 희망일, 지사 전체',
  '위에 담당자·연락처를 받고, 아래에 안전보호구 지급 내역(품목·수량·단가)을 받는 부서별 양식',
  '협력기관 10곳에서 분기별(1~4분기) 에너지 절감량을 항목별 숫자 표로 받고 싶어요',
  '2027 사업예산 요구표. 사업별로 지사마다 자기 열에 요구액을 적게 해 주세요',
];
const ENGINE_KEY = 'hanan-moa:ai-engine';

/** AI가 준 양식 정의 → 화면용 (계약 검사 → 내보내기 전 검사) */
function checkForm(x: unknown): Pick<Msg, 'form' | 'problems' | 'badForm'> {
  const v = validateSchema(x);
  if (!v.ok) return { badForm: v.errors.slice(0, 3).join(' / ') };
  return { form: v.schema, problems: validateForExport(v.schema).map((p) => p.message) };
}

/** AI로 만들기: 하고 싶은 말을 하면 AI(claude -p / codex exec)가 이 프로그램 규칙대로 양식을 만든다 (tools/ai/bridge.ts) */
export function AiPage() {
  const [health, setHealth] = useState<'checking' | 'off' | { claude: boolean; codex: boolean }>('checking');
  const [engine, setEngine] = useState<Engine>(() => { try { return (localStorage.getItem(ENGINE_KEY) as Engine) || 'claude'; } catch { return 'claude'; } });
  const [chatId, setChatId] = useState<string | null>(null);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const abort = useRef<AbortController | null>(null);
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch('/api/ai/health').then((r) => (r.ok ? r.json() : Promise.reject())).then((j) => setHealth(j.engines)).catch(() => setHealth('off'));
  }, []);
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }); }, [msgs]);
  useEffect(() => { try { localStorage.setItem(ENGINE_KEY, engine); } catch { /* 저장 못 해도 됨 */ } }, [engine]);

  const lastForm = [...msgs].reverse().find((m) => m.form)?.form;
  const patchLast = (f: (m: Msg) => Msg) => setMsgs((xs) => xs.map((m, i) => (i === xs.length - 1 ? f(m) : m)));

  const send = async (text = input) => {
    const message = text.trim();
    if (!message || busy) return;
    setInput('');
    setBusy(true);
    setMsgs((xs) => [...xs, { role: 'user', text: message }, { role: 'ai', text: '', status: '보내는 중' }]);
    const ctl = new AbortController();
    abort.current = ctl;
    try {
      const res = await fetch('/api/ai/chat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ chatId: chatId ?? undefined, engine, message }), signal: ctl.signal });
      if (!res.body) throw new Error('연결 서버가 답하지 않아요');
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let i;
        while ((i = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, i); buf = buf.slice(i + 1);
          if (!line.trim()) continue;
          const e = JSON.parse(line) as AiEvent;
          if (e.type === 'chat') setChatId(e.chatId);
          else if (e.type === 'status') patchLast((m) => ({ ...m, status: e.text }));
          else if (e.type === 'text') patchLast((m) => ({ ...m, text: m.text ? `${m.text}\n\n${e.text}` : e.text }));
          else if (e.type === 'form') patchLast((m) => ({ ...m, ...checkForm(e.schema) }));
          else if (e.type === 'error') patchLast((m) => ({ ...m, error: e.text }));
        }
      }
    } catch (err) {
      if ((err as Error).name !== 'AbortError') patchLast((m) => ({ ...m, error: `연결이 끊겼어요: ${(err as Error).message}` }));
      else patchLast((m) => ({ ...m, error: '멈췄어요' }));
    } finally {
      patchLast((m) => ({ ...m, status: undefined, text: m.text || (m.form || m.error ? m.text : '(답이 없어요)') }));
      setBusy(false);
      abort.current = null;
    }
  };

  const reset = () => { abort.current?.abort(); setChatId(null); setMsgs([]); setInput(''); };

  if (health === 'off') {
    return (
      <div className="mx-auto flex max-w-[640px] flex-col gap-3 p-6">
        <h1 className="m-0 text-xl font-bold">AI로 만들기</h1>
        <div className="rounded-card border border-line bg-panel p-4 text-sub">
          <p className="m-0 mb-2 font-semibold text-ink">AI 연결 서버가 꺼져 있어요</p>
          <p className="m-0">AI로 만들기는 이 컴퓨터의 <b>claude</b>·<b>codex</b> 명령어로 돌아가요. 프로그램 폴더에서 <code>npm run dev</code>로 켠 화면(예: localhost:5173)에서 써 주세요. 위쪽 [양식 만들기]·[취합하기]는 지금도 그대로 쓸 수 있어요.</p>
        </div>
      </div>
    );
  }

  const ok = (e: Engine) => health !== 'checking' && health[e];
  return (
    <div className="mx-auto flex h-full max-w-[920px] flex-col gap-3 px-4 py-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="m-0 text-xl font-bold">무엇을 받고 싶으세요?</h1>
        <span className="flex-1" />
        <span className="text-xs text-sub">AI</span>
        <div className="flex gap-0.5 rounded-box bg-chip p-[3px]" role="radiogroup" aria-label="AI 엔진">
          {ENGINES.map(([id, label]) => (
            <button key={id} type="button" role="radio" aria-checked={engine === id} disabled={!ok(id) || busy} onClick={() => setEngine(id)}
              className={cx('rounded-[6px] px-3 py-1 text-[13px]', engine === id ? 'bg-white font-semibold shadow-sm' : 'text-sub', !ok(id) && 'opacity-40')}>
              {label}{health !== 'checking' && !health[id] && ' (없음)'}
            </button>
          ))}
        </div>
        {msgs.length > 0 && <Button size="sm" variant="ghost" onClick={reset}>새 대화</Button>}
      </div>

      <div className="min-h-0 flex-1 overflow-auto rounded-card border border-line bg-white p-3" aria-live="polite">
        {msgs.length === 0 ? (
          <div className="flex flex-col gap-3 text-sub">
            <p className="m-0">받고 싶은 내용을 말로 적어 주세요. AI가 이 프로그램 규칙대로 양식을 만들고, 미리보기를 보여 드려요. 마음에 들면 엑셀로 내보내거나 빌더에서 직접 고칠 수 있어요.</p>
            <p className="m-0 text-xs">쓰던 엑셀이 있으면 머리글과 칸 내용을 복사해 붙여 넣어도 돼요.</p>
            <div className="flex flex-wrap gap-1.5">
              {EXAMPLES.map((x) => <button key={x} type="button" onClick={() => setInput(x)} className="rounded-full border border-line bg-panel px-3 py-1 text-left text-[13px] text-ink hover:border-pri">{x}</button>)}
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {msgs.map((m, i) => (m.role === 'user'
              ? <div key={i} className="ml-auto max-w-[80%] whitespace-pre-wrap rounded-card bg-pri-bg px-3 py-2">{m.text}</div>
              : <AiBubble key={i} m={m} />))}
            <div ref={end} />
          </div>
        )}
      </div>

      <div className="flex items-end gap-2">
        <TextArea aria-label="AI에게 보낼 말" className="min-h-[64px] flex-1" value={input} disabled={health === 'checking'}
          placeholder={lastForm ? '고칠 내용을 말해 주세요 (예: 교육비는 빼 주세요, 제출처를 부서로 바꿔 주세요)' : '예: 지사별 동절기 안전교육 이수자 명단. 담당자 연락처도 받고, 교육비는 원 단위로'}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send(); } }} />
        {busy ? <Button onClick={() => abort.current?.abort()}>멈추기</Button>
          : <Button variant="pri" disabled={!input.trim() || !ok(engine)} onClick={() => void send()}>보내기</Button>}
      </div>
      <p className="m-0 text-xs text-muted">Enter로 보내고 Shift+Enter로 줄을 바꿔요. 보낸 말은 고른 AI({engine === 'claude' ? 'Claude' : 'Codex'})로 전달돼요. 회신 파일 내용은 보내지 않아요.</p>
    </div>
  );
}

function AiBubble({ m }: { m: Msg }) {
  return (
    <div className="flex max-w-full flex-col gap-2">
      {m.text && <div className="whitespace-pre-wrap rounded-card bg-panel px-3 py-2">{m.text}</div>}
      {m.status && <div className="flex items-center gap-2 text-xs text-sub"><span className="inline-block h-2 w-2 animate-pulse rounded-full bg-pri" />{m.status}…</div>}
      {m.badForm && <div className="rounded-card border border-[#f3c2bd] bg-[#fffafa] px-3 py-2 text-sm text-err-ink">AI가 만든 양식이 규칙에 맞지 않아요: {m.badForm}. "규칙에 맞게 다시 고쳐 줘"라고 말해 보세요.</div>}
      {m.form && <FormCard schema={m.form} problems={m.problems ?? []} />}
      {m.error && <div className="text-sm text-err-ink">{m.error}</div>}
    </div>
  );
}

function FormCard({ schema, problems }: { schema: FormSchema; problems: string[] }) {
  const org = schema.org.mode === 'preset' ? schema.org.orgs?.[0] : undefined;
  const model = useMemo(() => layoutSheet(schema, { mode: 'template', orgName: org }, { today: new Date() }), [schema, org]);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState('');
  const who = schema.org.mode === 'preset' ? `${orgLabel(schema)} ${schema.org.orgs?.length ?? 0}곳에 파일이 하나씩 나가요` : schema.org.mode === 'input' ? `작성자가 ${orgLabel(schema)}명을 직접 적어요` : '누가 냈는지 구분하지 않아요';
  const toExcel = async () => {
    setBusy(true);
    try {
      const r = await exportForm(schema, new Date());
      downloadBlob(r.download.blob, r.download.name);
      setDone(noticeText(schema));
    } finally { setBusy(false); }
  };
  return (
    <div className="overflow-hidden rounded-card border border-line">
      <div className="flex flex-wrap items-center gap-2 border-b border-line bg-panel px-3 py-2">
        <b>{schema.title || '(제목 없음)'}</b>
        <Chip tone="pri">{LAYOUT_LABELS[schema.layout]}</Chip>
        <span className="text-xs text-sub">{who}</span>
        <span className="flex-1" />
        {problems.length === 0 ? <Chip tone="auto">검사 통과</Chip> : <Chip tone="err">고칠 곳 {problems.length}</Chip>}
      </div>
      <div className="max-h-[360px] overflow-auto bg-[#f7f8fa] p-2">
        <PreviewGrid model={model} schema={schema} />
      </div>
      {problems.length > 0 && <ul className="m-0 border-t border-line px-6 py-2 text-sm text-err-ink">{problems.map((p, i) => <li key={i}>{p}</li>)}</ul>}
      <div className="flex flex-wrap items-center gap-2 border-t border-line px-3 py-2">
        <Button variant="pri" size="sm" onClick={() => window.dispatchEvent(new CustomEvent('hanan-moa:open-form', { detail: { schema } }))}>빌더에서 열어 고치기</Button>
        <Button size="sm" disabled={problems.length > 0 || busy} onClick={() => void toExcel()}>{busy ? '만드는 중…' : '엑셀 내보내기'}</Button>
        <Button size="sm" variant="ghost" onClick={() => exportFormJson(schema)}>양식 파일 저장</Button>
        {problems.length > 0 && <span className="text-xs text-sub">고칠 곳을 AI에게 "고쳐 줘"라고 하거나 빌더에서 고쳐 주세요.</span>}
      </div>
      {done && <div className="border-t border-line bg-[#f3faf5] px-3 py-2 text-sm"><b className="text-[#2f7a3b]">내려받았어요.</b> 지사에 보낼 안내문: <span className="text-sub">{done}</span></div>}
    </div>
  );
}
