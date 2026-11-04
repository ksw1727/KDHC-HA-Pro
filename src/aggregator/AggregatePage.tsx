import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AGGREGATION_LABELS, availableAggregations, requiredAggregations, type AggregationId } from '@contract/aggregationIds';
import { blockFields, LAYOUT_LABELS, orgLabel, unitLabel, type Field, type FormSchema } from '@contract/schema';
import { analyze, loadInputs, patchCopies, type Analysis, type InputFile } from './pipeline/run';
import { resolve, STATUS_LABEL, type FileState, type Resolved } from './pipeline/resolve';
import { preview, writeResult } from './pipeline/write';
import { fmtTime, spreadName, spreadTable } from './pipeline/aggregate';
import { normalize } from './pipeline/normalize';
import { slotId as slotIdOf } from './pipeline/parse';
import { emptyDecisions, type Decisions, type Issue, type Question } from './pipeline/types';
import { ResultPreview, TablePreview } from './ResultPreview';
import { scopedStorageKey } from '../cloud/runtime';
import { recordAggregation } from '../workspace/history';

/** 취합하기 화면 (03-aggregator.md 2절, 모형 docs/mockups/aggregate-review.html) */

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');

function Btn({ pri, sm, className, ...p }: React.ButtonHTMLAttributes<HTMLButtonElement> & { pri?: boolean; sm?: boolean }) {
  return <button type="button" {...p} className={cx('inline-flex items-center gap-1 whitespace-nowrap rounded-btn border font-medium disabled:opacity-50', sm ? 'px-2 py-0.5 text-xs' : 'px-3 py-1.5', pri ? 'border-pri bg-pri font-bold text-white hover:bg-pri-ink' : 'border-line-strong bg-white hover:bg-panel', className)} />;
}
type Tone = 'gray' | 'ok' | 'req' | 'warn' | 'err' | 'pri';
const TONE: Record<Tone, string> = {
  gray: 'border-line bg-chip text-sub', ok: 'border-[#bfe3d6] bg-auto text-auto-ink', req: 'border-req-line bg-req text-req-ink',
  warn: 'border-[#f3cfa5] bg-warn text-warn-ink', err: 'border-[#f5c2bd] bg-err text-err-ink', pri: 'border-pri-line bg-pri-bg text-pri-ink',
};
const Chip = ({ tone = 'gray', children }: { tone?: Tone; children: ReactNode }) => <span className={cx('inline-block whitespace-nowrap rounded-[5px] border px-1.5 text-[11.5px] leading-[18px]', TONE[tone])}>{children}</span>;
const Card = ({ title, right, children }: { title: ReactNode; right?: ReactNode; children: ReactNode }) => (
  <section className="mb-3.5 rounded-card border border-line bg-white p-4">
    <h2 className="m-0 mb-2.5 flex flex-wrap items-center gap-2 text-[15px] font-bold">{title}<span className="flex-1" />{right}</h2>
    {children}
  </section>
);
const Banner = ({ tone, children }: { tone: Tone; children: ReactNode }) => <div className={cx('mb-3 flex flex-wrap items-center gap-2 rounded-box border px-3.5 py-2.5', TONE[tone])}>{children}</div>;
const Val = ({ kind, children }: { kind: 'in' | 'fix'; children: ReactNode }) => (
  <span className={cx('inline-block rounded-[4px] border px-1.5 font-mono text-[12.5px]', kind === 'in' ? 'border-req-line bg-req text-req-ink' : 'border-pri-line bg-pri-bg text-pri-ink')}>{children}</span>
);
const show = (v: unknown) => (v === null || v === undefined || v === '' ? '(빈칸)' : v instanceof Date ? v.toISOString().slice(0, 10) : typeof v === 'object' ? JSON.stringify(v) : String(v));

/** 결과 파일 하나 (완료 화면에서 다시 받을 수 있게 내용을 들고 있는다) */
type OutFile = { name: string; bytes: Uint8Array; type: string; note?: string };

function download(f: OutFile) {
  const url = URL.createObjectURL(new Blob([f.bytes as BlobPart], { type: f.type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = f.name;
  a.style.display = 'none';
  document.body.appendChild(a);   // 문서에 붙여야 받기가 되는 브라우저가 있다
  a.click();
  a.remove();
  // 브라우저가 '여러 파일 다운로드' 허용을 묻는 동안 주소가 사라지면 받기가 실패한다 → 넉넉히 둔다
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** 양식 만들기에서 넘어온 양식 (브라우저에 저장된 것). 실패하면 없음 */
function storedForm(formId?: string): FormSchema | null {
  if (!formId) return null;
  try {
    const raw = localStorage.getItem(scopedStorageKey(`hanan-moa:forms:${formId}`));   // 온라인 모드는 계정별 키
    const v = raw ? (JSON.parse(raw) as { schema: FormSchema; lastExported?: FormSchema }) : null;
    return v ? v.lastExported ?? v.schema : null;
  } catch { return null; }
}

async function toInputs(list: FileList | File[]): Promise<InputFile[]> {
  return Promise.all([...list].map(async (f) => ({ name: f.name, bytes: new Uint8Array(await f.arrayBuffer()), lastModified: f.lastModified })));
}

type Stage = 'upload' | 'reading' | 'review' | 'done';
/** 검토 화면 위 카드 (누르면 미리보기 줄을 모으고 오른쪽 사이드바에 그 내용) */
type CardId = 'submit' | 'check' | 'auto' | 'memo' | 'other' | 'drop' | 'miss' | 'verify';

export function AggregatePage({ formId }: { formId?: string }) {
  const [hint, setHint] = useState<FormSchema | null>(() => storedForm(formId));
  const [stage, setStage] = useState<Stage>('upload');
  const [bag, setBag] = useState<InputFile[]>([]);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [loaded, setLoaded] = useState<Awaited<ReturnType<typeof loadInputs>> | null>(null);
  const [d, setD] = useState<Decisions>(emptyDecisions);
  const [methods, setMethods] = useState<AggregationId[]>([]);
  const [withProposals, setWithProposals] = useState(true);
  const [wantCopies, setWantCopies] = useState(true);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ files: OutFile[]; notes: string[]; message: string } | null>(null);
  const [error, setError] = useState('');
  const [card, setCard] = useState<CardId | null>(null);
  const [org, setOrg] = useState<string | null>(null);     // 제출 카드에서 고른 파일 (그 파일 줄만 모으기)
  const [only, setOnly] = useState(false);                 // 해당 줄만 (아니면 위로 모으고 나머지는 흐리게)
  const [sel, setSel] = useState<string | null>(null);     // 사이드바에서 짚은 항목
  const [flash, setFlash] = useState<{ row: number; n: number } | null>(null);
  // 표에서 줄을 누르면 사이드바의 그 항목이 보이게
  useEffect(() => { if (sel) document.querySelector(`[data-side="${CSS.escape(sel)}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }, [sel, card]);

  const start = async (inputs: InputFile[]) => {
    setStage('reading');
    setError('');
    try {
      const l = await loadInputs(inputs);
      const a = await analyze(l.files, l.schemas, hint, new Date());
      setLoaded(l);
      setAnalysis(a);
      setD(emptyDecisions());
      setMethods(a.base?.schema.aggregations ?? []);
      setStage('review');
    } catch (e) {
      setError(`파일을 읽다가 문제가 생겼어요: ${(e as Error).message}`);
      setStage('upload');
    }
  };
  const addMore = async (list: FileList | null) => {
    if (!list?.length) return;
    const more = await toInputs(list);
    const next = [...bag, ...more.filter((m) => !bag.some((b) => b.name === m.name && b.bytes.length === m.bytes.length))];
    setBag(next);
    if (stage === 'review') await start(next);
  };

  const schema = analysis?.base?.schema;
  const today = useMemo(() => new Date(), []);
  const res = useMemo(() => (analysis && schema ? resolve(schema, analysis.identified, analysis.parsed, d, { year: today.getFullYear(), today }) : null), [analysis, schema, d, today]);
  const pv = useMemo(() => (schema && res ? preview(schema, res, today) : null), [schema, res, today]);

  if (stage === 'upload' || stage === 'reading') {
    return (
      <Upload hint={hint} onForget={() => setHint(null)} bag={bag} setBag={setBag} reading={stage === 'reading'} error={error}
        onAdd={addMore} onStart={() => start(bag)} />
    );
  }
  if (stage === 'done' && done) {
    return (
      <div className="mx-auto max-w-[900px] p-5">
        <Banner tone="ok"><b className="text-[15px]">{done.message}</b></Banner>
        <Card title="내려받은 파일">
          <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
            {done.files.map((f) => (
              <li key={f.name} className="flex flex-wrap items-center gap-2">
                <span className="min-w-0 flex-1 break-all">{f.name}{f.note && <span className="text-sub"> ({f.note})</span>}</span>
                <Btn sm onClick={() => download(f)}>다시 받기</Btn>
              </li>
            ))}
          </ul>
          {done.notes.length > 0 && <ul className="m-0 mt-2 list-disc pl-5 text-[12.5px] text-warn-ink">{done.notes.map((n) => <li key={n}>{n}</li>)}</ul>}
          <p className="text-sub">다운로드 폴더에 저장됐어요. 취합본을 나중에 다시 넣으면 다른 취합본과 합칠 수 있어요.</p>
          {done.files.length > 1 && (
            <p className="text-[12.5px] text-sub">
              파일이 다 안 보이면 브라우저가 여러 파일 받기를 막은 거예요. 받지 못한 파일의 [다시 받기]를 누르거나,
              주소창 오른쪽의 다운로드 차단 표시를 눌러 이 사이트를 허용해 주세요.
            </p>
          )}
          <Btn onClick={() => setStage('review')}>검토 화면으로 돌아가기</Btn>
        </Card>
      </div>
    );
  }
  if (!analysis) return null;

  if (!schema) {
    return (
      <div className="mx-auto max-w-[900px] p-5">
        <Banner tone="warn">넣은 파일에서 한난MOA 양식을 찾지 못했어요. 양식 만들기에서 받은 양식 파일(.form.json)을 함께 넣어 주세요.
          <JsonButton onPick={addMore} /></Banner>
        <SkippedList files={analysis.identified.map((f) => ({ name: f.file.fileName, reason: f.skipReason ?? '' }))} />
        <Btn onClick={() => setStage('upload')}>파일 다시 고르기</Btn>
      </div>
    );
  }

  if (!res || !pv) return null;

  const L = unitLabel(schema);
  const collect = schema.layout === 'collect';
  const fieldOf = new Map<string, Field>();
  for (const b of schema.blocks) for (const f of blockFields(b)) fieldOf.set(f.key, f);
  const included = new Set(res.included.map((s) => s.fileId));
  const allValueIssues = analysis.parsed.filter((p) => included.has(p.fileId)).flatMap((p) => p.issues.filter((i) => i.severity === 'value'));
  const rowOut = (i: Issue) => !!(i.slot && 'sourceRow' in i.slot && d.excludeRow[`${i.fileId}:${i.slot.sourceRow}`]);
  const visibleIssues = allValueIssues.filter((i) => rowOut(i) || res.valueIssues.some((v) => v.id === i.id));
  const pending = visibleIssues.filter((i) => !rowOut(i) && !d.cellFix[i.id]).length + res.questions.filter((q) => d.answers[q.id] === undefined).length
    + res.files.filter((f) => f.orgBlank && f.needsOrgLink && f.status === 'included').length;   // 제출처 이름이 빈 파일
  // 지금 결과에 실제로 들어가는 직접 고침만 센다 (고친 뒤 그 줄·파일을 뺐으면 사본에 쓸 것이 없다)
  const manualCount = res.valueIssues.filter((i) => i.choice === '직접 고침').length;
  const autoCount = res.included.reduce((s, x) => s + x.autoFixed.length, 0);
  const noteCount = res.included.reduce((s, x) => s + x.read.authorNotes.length, 0);
  const excluded = res.files.filter((f) => f.status !== 'included' && f.status !== 'duplicate').length;
  const orgsTotal = schema.org.mode === 'preset' || (schema.org.orgs?.length ?? 0) > 0 ? (schema.org.orgs?.length ?? 0) : 0;
  const noMeta = analysis.identified.filter((f) => f.status === 'unreadable' && f.skipReason?.startsWith('한난MOA 양식 파일이 아니거나')).length;
  const available = availableAggregations(schema);
  const required = requiredAggregations(schema);
  const spreadOn = available.includes('spread') && (required.includes('spread') || methods.includes('spread'));
  const rowsTotal = res.included.reduce((s, x) => s + x.rows.length + (x.gridSpareRows?.length ?? 0), 0);
  // 파일 목록에서 운영자가 손댈 것: 제출처 이름 확인, 중복 파일
  // 다른 제출처 칸에 적어 쓰지 않은 값 (빈칸채우기 작성처). 결과는 맞지만 운영자가 알아야 해서 요약·파일 목록에 드러낸다
  const otherOrgCount = res.files.filter((f) => f.status === 'included').reduce((n, f) => n + otherOrgCells(f).length, 0);
  const fileAttention = res.files.filter((f) => f.status === 'included' && (f.needsOrgLink || (f.dupGroup?.length ?? 0) > 1 || otherOrgCells(f).length > 0)).length;
  const autoRows = res.included.flatMap((s) => s.autoFixed.filter((a) => s.marks.get(slotIdOf(a.slot))?.mark === 'auto-fixed')
    .map((a) => ({ id: `auto:${s.fileId}:${slotIdOf(a.slot)}`, fileId: s.fileId, slot: a.slot, who: s.label, where: `${a.address} ${fieldOf.get(a.slot.key)?.label ?? ''}`.trim(), from: a.from, to: a.to })));

  const set = (patch: (x: Decisions) => Decisions) => setD((x) => patch(structuredClone(x)));
  const applyAll = () => set((x) => { for (const i of visibleIssues) if (!x.cellFix[i.id] && !rowOut(i)) x.cellFix[i.id] = { mode: i.proposal !== undefined ? 'proposal' : 'keep' }; return x; });

  const get = async (force = false) => {
    if (pending && !force) { setConfirm(true); return; }
    setConfirm(false);
    setBusy(true);
    try {
      const at = new Date();
      const workbooks = new Map(analysis.identified.filter((f) => f.workbook).map((f) => [f.file.id, f.workbook!]));
      const out = await writeResult({ schema, res, methods, workbooks, now: at });
      const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
      // 파일을 모두 만든 뒤 한꺼번에 내려받는다. 수정본만 몇 초 늦게 따로 받기를 시작하면
      // 브라우저의 '여러 파일 다운로드' 확인과 어긋나서 그 파일만 막히는 일이 있었다
      const files: OutFile[] = [{ name: out.fileName, bytes: out.bytes, type: XLSX }];
      const notes: string[] = [];
      if (out.review) files.push({ name: out.review.fileName, bytes: out.review.bytes, type: XLSX, note: '검토용: 검토 사항 시트에 검산·오류·파일목록·판단 기록' });
      if (wantCopies && manualCount && loaded) {
        const c = await patchCopies(res, loaded.files, withProposals, at, schema.title);
        if (c?.count) files.push({ name: c.fileName, bytes: c.bytes, type: 'application/zip', note: `회신 파일 ${c.count}개` });
        for (const k of c?.skipped ?? []) notes.push(`수정본 사본 없음: ${k.fileName} — ${k.reason}`);
        if (!c?.count && !c?.skipped.length) notes.push('수정본 사본 없음: 원본에 고쳐 쓸 칸을 찾지 못했어요');
      }
      for (const f of files) download(f);
      const rows = res.included.reduce((s, x) => s + x.rows.length + (x.gridSpareRows?.length ?? 0), 0);
      const who = schema.org.mode === 'none' ? `파일 ${res.included.length}개` : `${L} ${res.included.length}곳`;
      const hasList = schema.blocks.some((b) => b.kind === 'list');
      const spare = schema.blocks.some((b) => b.kind === 'grid' && b.spareRows > 0);
      const what = collect ? '의 시트를 모았어요' : hasList ? `, 행 ${rows}개를 취합했어요` : spare && rows ? `을 취합했어요 (여유 줄 ${rows}줄)` : '을 취합했어요';
      setDone({ files, notes, message: `${who}${what} · 검산 ${out.verify.ok ? '일치' : '불일치 — 받은 파일의 검산 시트를 확인해 주세요'}` });
      // 내 업무공간의 취합 이력: 요약만 남긴다 (결과 파일은 저장하지 않음)
      recordAggregation({
        formId: schema.formId, formVersion: schema.formVersion, title: schema.title, layout: schema.layout,
        unit: schema.org.mode === 'none' ? '파일' : L, total: orgsTotal || null, got: res.included.length,
        missing: res.missingOrgs, rows, checked: res.valueIssues.length + res.crossIssues.length, verifyOk: out.verify.ok,
      }, at);
      setStage('done');
    } catch (e) {
      setError(`결과 파일을 만들다가 문제가 생겼어요: ${(e as Error).message}`);
    } finally { setBusy(false); }
  };

  // 목록에 있는 제출처 중 낸 곳 / 목록 수 (+ 목록에 없는 이름으로 낸 파일)
  const outsideList = orgsTotal ? res.included.filter((x) => !x.org || !(schema.org.orgs ?? []).includes(x.org)).length : 0;
  const opRows = Object.entries(d.excludeRow).filter(([, v]) => v).map(([k]) => k);
  const dropCount = excluded + opRows.length;
  const checkTotal = visibleIssues.length + res.questions.length + res.crossIssues.length + res.files.filter((f) => f.orgBlank && f.needsOrgLink && f.status === 'included').length;
  const cards: { id: CardId; k: string; v: ReactNode; tone?: Tone; n: number }[] = [
    { id: 'submit', k: '제출', v: orgsTotal ? `${orgsTotal - res.missingOrgs.length}/${orgsTotal}${outsideList ? ` + 목록 밖 ${outsideList}` : ''}` : res.included.length, n: res.files.length },
    ...(!collect ? [
      { id: 'check' as const, k: '확인할 칸', v: pending, tone: pending ? 'req' as const : undefined, n: checkTotal },
      { id: 'auto' as const, k: '자동 정리', v: autoCount, n: autoCount },
      { id: 'memo' as const, k: '작성자 메모', v: noteCount, n: noteCount },
    ] : []),
    ...(otherOrgCount ? [{ id: 'other' as const, k: '쓰지 않은 값', v: otherOrgCount, tone: 'warn' as const, n: otherOrgCount }] : []),
    { id: 'drop', k: '제외', v: dropCount, n: dropCount },
    ...(orgsTotal ? [{ id: 'miss' as const, k: '미제출', v: res.missingOrgs.length, n: res.missingOrgs.length }] : []),
    ...(!collect ? [{ id: 'verify' as const, k: '검산', v: pv.verify.ok ? '일치' : '불일치', tone: pv.verify.ok ? 'ok' as const : 'err' as const, n: 1 }] : []),
  ];

  // 미리보기의 자료 줄 ↔ 제출 파일의 몇 번째 줄 (목록형은 목록 줄, 빈칸채우기형은 여유 줄)
  const frame = pv.frame;
  const rowOf = new Map<string, number>();
  const refAt = new Map<number, { fileId: string; sourceRow: number }>();
  let region: { from: number; to: number } | null = null;
  if (frame) {
    const lb = schema.blocks.find((b) => b.kind === 'list');
    const gb = schema.blocks.find((b) => b.kind === 'grid');
    const lm = lb ? frame.model.cellMap.blocks[lb.id] : undefined;
    const gm = gb ? frame.model.cellMap.blocks[gb.id] : undefined;
    const put = (refs: typeof frame.rowRefs, first: number) => {
      refs.forEach((r, i) => { refAt.set(first + i, r); if (r.sourceRow >= 0) rowOf.set(`${r.fileId}:${r.sourceRow}`, first + i); });
      if (refs.length) region = { from: first, to: first + refs.length - 1 };
    };
    if (lm?.kind === 'list') put(frame.rowRefs, lm.firstDataRow);
    else if (gm?.kind === 'grid' && gm.spare) put(frame.spareRefs, gm.spare.firstRow);
  }
  const slotRow = (fileId: string, slot?: Issue['slot']) => (slot && 'sourceRow' in slot ? rowOf.get(`${fileId}:${slot.sourceRow}`) : undefined);
  const uniq = (xs: (number | undefined)[]) => [...new Set(xs.filter((x): x is number => x !== undefined))].sort((a, b) => a - b);
  const labelOf = (fileId: string) => res.files.find((f) => f.fileId === fileId)?.label ?? '';
  const focusRows: number[] | null =
    card === 'check' ? uniq(visibleIssues.filter((i) => !rowOut(i)).map((i) => slotRow(i.fileId, i.slot)))
    : card === 'auto' ? uniq(autoRows.map((a) => slotRow(a.fileId, a.slot)))
    : card === 'memo' ? uniq(res.included.flatMap((s) => s.read.authorNotes.map((n) => (n.sourceRow !== undefined ? rowOf.get(`${s.fileId}:${n.sourceRow}`) : undefined))))
    : card === 'submit' && org ? [...refAt].filter(([, r]) => r.fileId === org).map(([row]) => row)
    : null;
  const focus = region && focusRows?.length ? { rows: focusRows, only } : null;
  const band: { tone: Tone; text: ReactNode } | null =
    !card || !frame || !['check', 'auto', 'memo', 'submit'].includes(card) || (card === 'submit' && !org) ? null
    : !focus ? { tone: 'gray', text: '표에서 줄로 모을 수 있는 칸이 없어요. 오른쪽 목록에서 확인해 주세요' }
    : card === 'check' ? { tone: 'req', text: <>확인할 칸이 있는 <b>{focus.rows.length}줄</b>을 위로 모았어요 · 남음 {pending}</> }
    : card === 'auto' ? { tone: 'pri', text: <>프로그램이 자동으로 고친 <b>{focus.rows.length}줄</b>을 위로 모았어요 (원래 값은 칸 메모에)</> }
    : card === 'memo' ? { tone: 'gray', text: <>작성자 메모가 달린 <b>{focus.rows.length}줄</b>을 위로 모았어요</> }
    : { tone: 'gray', text: <><b>{labelOf(org!)}</b> 줄 {focus.rows.length}개를 위로 모았어요</> };

  const pickCard = (id: CardId) => {
    if (collect && id === 'submit') { document.getElementById('agg-files')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); return; }
    setCard((c) => (c === id ? null : id)); setOrg(null); setSel(null);
  };
  const point = (row: number | undefined, side: string) => { setSel(side); if (row !== undefined) setFlash({ row, n: Date.now() }); };
  // 표의 줄을 누르면 그 줄 내용이 있는 항목을 사이드바에 연다
  const onRow = (row: number) => {
    const ref = refAt.get(row);
    if (!ref) return;
    const issue = !collect && visibleIssues.find((i) => !rowOut(i) && slotRow(i.fileId, i.slot) === row);
    const auto = autoRows.find((a) => slotRow(a.fileId, a.slot) === row);
    if (issue) { setCard('check'); setSel(issue.id); }
    else if (auto) { setCard('auto'); setSel(auto.id); }
    else { setCard('submit'); setOrg(ref.fileId); setSel(ref.fileId); }
    setFlash({ row, n: Date.now() });
  };
  const ToTable = ({ row }: { row?: number }) => (row === undefined ? null : <button type="button" className="ml-auto shrink-0 text-xs font-semibold text-pri-ink hover:underline" onClick={(e) => { e.stopPropagation(); setFlash({ row, n: Date.now() }); }}>표에서 보기 ↗</button>);
  const itemCls = (id: string) => cx('mb-2 rounded-box border bg-white px-3 py-2 transition-shadow', sel === id ? 'border-acc shadow-[0_0_0_2px_var(--color-acc-bg)]' : 'border-line hover:border-line-strong');

  const SIDE_TITLE: Record<CardId, string> = { submit: collect ? `${L}별 파일` : '제출한 파일', check: pending ? '이것만 확인해 주세요' : '확인할 칸', auto: '자동으로 처리한 것', memo: '작성자 메모', other: '쓰지 않은 값', drop: '뺀 것', miss: '미제출', verify: '검산' };
  const step = (id: CardId, label: string, chip: ReactNode, done?: boolean) => (
    <button key={id} type="button" onClick={() => pickCard(id)} className="mb-2 flex w-full items-center gap-2.5 rounded-box border border-line bg-white px-3 py-2.5 text-left hover:border-line-strong">
      <span className={cx('grid h-5 w-5 shrink-0 place-items-center rounded-full text-[11px] font-bold', done ? 'bg-pri text-white' : 'bg-req-ink text-white')}>{done ? '✓' : '!'}</span>
      <b className="flex-1">{label}</b>{chip}
    </button>
  );
  const sideBody = (): ReactNode => {
    if (!card) return (
      <>
        <p className="m-0 mb-2.5 text-xs text-sub">위의 카드를 누르면 해당하는 줄이 표 맨 위로 모이고, 여기에서 확인해요.</p>
        {!collect && step('check', '확인할 칸 고르기', <Chip tone={pending ? 'req' : 'ok'}>{pending ? `남음 ${pending}` : '모두 고름'}</Chip>, !pending)}
        {!collect && autoCount > 0 && step('auto', '자동으로 고친 값 훑어보기', <Chip tone="pri">{autoCount}건</Chip>, true)}
        {!collect && noteCount > 0 && step('memo', '작성자 메모 읽기', <Chip>{noteCount}개</Chip>, true)}
        {otherOrgCount > 0 && step('other', '남의 칸에 적은 값', <Chip tone="warn">{otherOrgCount}</Chip>)}
        {step('submit', collect ? `${L}별 파일 (왼쪽 표)` : '제출한 파일', <Chip tone={fileAttention ? 'warn' : 'ok'}>{fileAttention ? `살펴볼 파일 ${fileAttention}개` : `${res.files.length}개`}</Chip>, !fileAttention)}
        {res.missingOrgs.length > 0 && step('miss', '미제출', <Chip>{res.missingOrgs.length}곳</Chip>, true)}
        {!collect && step('verify', '검산', <Chip tone={pv.verify.ok ? 'ok' : 'err'}>{pv.verify.ok ? '일치' : '불일치'}</Chip>, pv.verify.ok)}
      </>
    );
    if (card === 'check') {
      const blankOrg = res.files.filter((f) => f.orgBlank && f.needsOrgLink && f.status === 'included');
      return checkTotal === 0 ? <p className="m-0 text-sub">확인할 칸이 없어요.</p> : (
        <>
          <p className="m-0 mb-1.5 text-xs text-sub">고르지 않은 칸은 받을 때 자동으로 고친 값(고칠 수 없으면 적혀 있던 값 그대로)으로 들어가고, 판단 기록에 "기본값 적용"으로 남아요.</p>
          <div className="mb-2 flex flex-wrap gap-3 text-xs text-sub"><span><Val kind="in">노란 상자</Val> 받은 파일에 적혀 있던 값</span><span><Val kind="fix">파란 상자</Val> 자동으로 고친 값</span></div>
          {visibleIssues.some((i) => !d.cellFix[i.id] && !rowOut(i)) && <Btn sm className="mb-2" onClick={applyAll}>남은 칸 모두 "자동으로 고친 값" 쓰기</Btn>}
          {visibleIssues.map((i) => {
            const row = slotRow(i.fileId, i.slot);
            return (
              <div key={i.id} data-side={i.id} className={itemCls(i.id)} onClick={(e) => { if (!(e.target as HTMLElement).closest('input,label,button')) point(row, i.id); }}>
                <FixRow i={i} who={labelOf(i.fileId)} field={i.slot ? fieldOf.get(i.slot.key) : undefined} d={d} set={set} out={rowOut(i)} today={today} toTable={<ToTable row={row} />} />
              </div>
            );
          })}
          {res.questions.map((q) => <div key={q.id} data-side={q.id} className={itemCls(q.id)}><QuestionRow q={q} who={q.fileId ? labelOf(q.fileId) : undefined} d={d} set={set} /></div>)}
          {res.crossIssues.map((i) => <div key={i.id} className={itemCls(i.id)}><b>{i.location}</b> <span className="text-err-ink">{i.message}</span> <span className="text-xs text-sub">(검토 사항 시트에 기록)</span></div>)}
          {blankOrg.length > 0 && (
            <div className={itemCls('blank-org')}>
              <b>{L}명이 비어 있는 파일 {blankOrg.length}개</b> <span className="text-xs text-sub">파일 이름으로 넣었어요</span>
              <div className="mt-1"><Btn sm onClick={() => { setCard('submit'); setSel(blankOrg[0].fileId); }}>파일 목록에서 {L} 연결하기</Btn></div>
            </div>
          )}
        </>
      );
    }
    if (card === 'auto') return (
      <>
        <p className="m-0 mb-2 text-xs text-sub">원래 값 → 고친 값. 누르면 표에서 그 줄을 짚어 줘요. 검토 파일 "검토 사항" 시트에도 남아요.</p>
        {autoRows.length === 0 && <p className="m-0 text-sub">자동으로 고친 값이 없어요.</p>}
        {autoRows.slice(0, 300).map((a) => {
          const row = slotRow(a.fileId, a.slot);
          return (
            <button key={a.id} type="button" data-side={a.id} className={cx(itemCls(a.id), 'flex w-full flex-wrap items-center gap-1.5 text-left')} onClick={() => point(row, a.id)}>
              <b>{a.who}</b><span className="text-sub">· {a.where}</span><Val kind="in">{show(a.from)}</Val><span className="text-muted">→</span><Val kind="fix">{show(a.to)}</Val>
            </button>
          );
        })}
        {autoRows.length > 300 && <p className="m-0 text-xs text-sub">… {autoRows.length - 300}건 더</p>}
      </>
    );
    if (card === 'memo') return (
      <>
        <p className="m-0 mb-2 text-xs text-sub">회신 파일에 작성자가 단 엑셀 메모예요. 검토 파일의 같은 칸에도 옮겨 둬요.</p>
        {res.included.flatMap((s) => s.read.authorNotes.map((n, k) => {
          const row = n.sourceRow !== undefined ? rowOf.get(`${s.fileId}:${n.sourceRow}`) : undefined;
          const id = `memo:${s.fileId}:${k}`;
          return (
            <button key={id} type="button" data-side={id} className={cx(itemCls(id), 'block w-full text-left')} onClick={() => point(row, id)}>
              <div className="flex gap-1.5"><b>{s.label}</b><span className="text-sub">· {n.address}{n.fieldKey && fieldOf.get(n.fieldKey) ? ` ${fieldOf.get(n.fieldKey)!.label}` : ''}</span></div>
              <div className="mt-0.5 whitespace-pre-wrap">"{n.text}"</div>
            </button>
          );
        }))}
      </>
    );
    if (card === 'other') return (
      <>
        <p className="m-0 mb-2 text-xs text-sub">다른 {L}이 채우는 칸에 적은 값이에요. 결과에는 쓰지 않았어요.</p>
        {res.files.filter((f) => f.status === 'included' && otherOrgCells(f).length).map((f) => (
          <div key={f.fileId} className={itemCls(f.fileId)}><b>{f.label}</b>{otherOrgCells(f).map((i) => <div key={i.id} className="mt-1 rounded-btn border border-[#f3cfa5] bg-warn px-2 py-0.5 text-[12.5px] text-warn-ink">⚠ {i.address} · {i.message}</div>)}</div>
        ))}
      </>
    );
    if (card === 'submit') return (
      <>
        <p className="m-0 mb-2 text-xs text-sub">{frame ? `${L}를 누르면 그 ${L} 줄만 표 맨 위로 모아요. 다시 누르면 풀려요.` : '파일을 누르면 읽은 내용이 펼쳐져요.'}</p>
        <FileCards schema={schema} res={res} d={d} set={set} sel={org} onPick={(fileId) => {
          const next = org === fileId ? null : fileId;
          setOrg(next); setSel(fileId);
          const first = next ? [...refAt].find(([, r]) => r.fileId === next)?.[0] : undefined;
          if (first !== undefined) setFlash({ row: first, n: Date.now() });
        }} />
      </>
    );
    if (card === 'drop') return (
      <>
        <p className="m-0 mb-2 text-xs text-sub">뺀 파일·줄은 결과 파일에 넣지 않고 검토 사항 시트의 파일목록·검산·판단 기록에 남아요.</p>
        {dropCount === 0 && <p className="m-0 text-sub">뺀 것이 없어요.</p>}
        {res.files.filter((f) => f.status !== 'included' && f.status !== 'duplicate').map((f) => (
          <div key={f.fileId} className={itemCls(f.fileId)}>
            <div className="flex items-center gap-2"><b className="min-w-0 flex-1 truncate">{f.label}</b><Chip tone={STATUS_TONE[f.status]}>{STATUS_LABEL[f.status]}</Chip>
              {f.status === 'operator' && <Btn sm onClick={() => set((x) => { x.excludeFile[f.fileId] = false; return x; })}>되돌리기</Btn>}</div>
            {f.label !== f.fileName && <div className="truncate text-xs text-muted">{f.fileName}</div>}
            {f.reason && <div className="text-xs text-sub">{f.reason}</div>}
          </div>
        ))}
        {opRows.map((k) => {
          const [fileId, srow] = [k.slice(0, k.lastIndexOf(':')), k.slice(k.lastIndexOf(':') + 1)];
          return (
            <div key={k} className={itemCls(k)}>
              <div className="flex items-center gap-2"><b className="min-w-0 flex-1 truncate">{labelOf(fileId)} · {srow}행</b><Chip>이 줄 뺌</Chip>
                <Btn sm onClick={() => set((x) => { delete x.excludeRow[k]; return x; })}>되돌리기</Btn></div>
            </div>
          );
        })}
      </>
    );
    if (card === 'miss') return (
      <>
        <p className="m-0 mb-2 text-xs text-sub">{L} 목록에 있지만 파일이 없는 곳이에요. 제출 현황 시트에 "미제출"로 들어가요.</p>
        {res.missingOrgs.map((o) => <div key={o} className={itemCls(o)}><b>{o}</b> <Chip>미제출</Chip></div>)}
      </>
    );
    return (
      <>
        <p className="m-0 mb-2 text-xs text-sub">받기 전에 계산해 둔 결과예요. 하나라도 안 맞으면 빨갛게 보여요.</p>
        {pv.verify.lines.map((l, k) => (
          <div key={k} className={cx(itemCls(`v${k}`), 'flex items-start gap-2', !l.ok && 'border-[#f5c2bd] bg-err')}>
            <span className={cx('mt-0.5 grid h-[18px] w-[18px] shrink-0 place-items-center rounded-full text-[11px] text-white', l.ok ? 'bg-pri' : 'bg-err-ink')}>{l.ok ? '✓' : '!'}</span>
            <div className="min-w-0 flex-1"><b>{l.check}</b><div className={cx('text-[12.5px]', l.ok ? 'text-sub' : 'text-err-ink')}>{l.detail}</div></div>
          </div>
        ))}
      </>
    );
  };

  return (
    <div className="mx-auto max-w-[1440px] p-5">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <b className="text-[16px]">{schema.title}</b><Chip>v{schema.formVersion}</Chip><Chip>{LAYOUT_LABELS[schema.layout]}</Chip>
        <span className="text-sub">파일 {analysis.identified.length}개</span>
        <span className="flex-1" />
        <label className="cursor-pointer rounded-btn border border-line-strong bg-white px-3 py-1.5 hover:bg-panel">파일 더 넣기
          <input type="file" multiple hidden accept=".xlsx,.xls,.csv,.zip,.json" onChange={(e) => { void addMore(e.target.files); e.target.value = ''; }} /></label>
        <Btn onClick={() => { setStage('upload'); setBag([]); setAnalysis(null); }}>처음으로</Btn>
      </div>
      {error && <Banner tone="err">{error}</Banner>}
      {!pv.verify.ok && <Banner tone="err"><b>검산이 맞지 않아요.</b> 받기 전에 검산 카드를 눌러 내역을 확인해 주세요.</Banner>}
      {noMeta > 0 && <Banner tone="warn">양식 정보가 없는 파일이 {noMeta}개 있어요. 양식 파일(.form.json)을 넣으면 이 파일도 취합할 수 있어요. <JsonButton onPick={addMore} /></Banner>}
      {loaded?.notes.map((n) => <Banner key={n} tone="warn">{n}</Banner>)}

      {/* 카드 = 미리보기 거르개. 누르면 그 카드에 해당하는 줄을 표 맨 위로 모으고, 오른쪽 사이드바에 그 내용을 연다 */}
      <div className="mb-3.5 flex flex-wrap gap-2" role="group" aria-label="검토 항목">
        {cards.map((c) => {
          const on = card === c.id;
          const off = c.n === 0;
          return (
            <button key={c.id} type="button" aria-pressed={on} disabled={off} title={off ? '0건이라 살펴볼 것이 없어요' : undefined} onClick={() => pickCard(c.id)}
              className={cx('relative min-w-[104px] rounded-box border px-3 py-2 text-left transition', c.tone ? TONE[c.tone] : 'border-line bg-white', off ? 'cursor-default opacity-55' : 'hover:-translate-y-px hover:shadow-[0_2px_8px_rgba(30,38,32,.1)]', on && 'ring-2 ring-ink')}>
              <div className="text-xs text-sub">{c.k}</div><b className="text-[18px]">{c.v}</b>
            </button>
          );
        })}
      </div>

      <div className="grid items-start gap-3.5 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="min-w-0">
          {!collect && frame && (
            <Card title={<>취합 결과 <span className="text-[13px] font-normal text-sub">{schema.org.mode === 'none' ? `파일 ${res.included.length}개` : `${L} ${res.included.length}곳`}{rowsTotal ? ` · ${rowsTotal}줄` : ''}</span></>}
              right={<Chip tone={pv.verify.ok ? 'ok' : 'err'}>검산 {pv.verify.ok ? '일치' : '불일치'}</Chip>}>
              {band && (
                <div className={cx('mb-2 flex flex-wrap items-center gap-2 rounded-box border px-3 py-1.5 text-[12.5px]', TONE[band.tone])}>
                  <span className="flex-1">{band.text}</span>
                  {focus && (
                    <span className="inline-flex overflow-hidden rounded-btn border border-line-strong bg-white text-xs">
                      {([[false, '위로 모으기'], [true, '해당 줄만']] as const).map(([v, label]) => <button key={label} type="button" aria-pressed={only === v} onClick={() => setOnly(v)} className={cx('px-2 py-0.5', only === v ? 'bg-ink text-white' : 'text-sub')}>{label}</button>)}
                    </span>
                  )}
                  <Btn sm onClick={() => { setCard(null); setOrg(null); setSel(null); }}>전체 보기</Btn>
                </div>
              )}
              <ResultPreview model={frame.model} region={region} focus={focus} flash={flash} onRow={onRow} maxHeight={560} />
              <p className="m-0 mt-1.5 text-xs text-sub">노란 칸은 확인할 칸, 파란 칸은 프로그램이 자동으로 고친 칸이에요. 줄을 누르면 오른쪽에서 그 줄 내용을 찾아 줘요. 결과 파일에는 표시 없이 값만 들어가요.</p>
            </Card>
          )}

          {/* 숫자 표는 위 결과가 모든 제출처의 합이라, 제출처별 값을 따로 보여 준다 (결과 파일의 펼치기 시트와 같은 표) */}
          {!collect && spreadOn && (
            <Card title={<>{spreadName(schema)} 값 <span className="text-[13px] font-normal text-sub">결과 파일의 "{spreadName(schema)}" 시트</span></>}>
              <TablePreview table={spreadTable(schema, res)} />
            </Card>
          )}

          {collect && (
            <div id="agg-files">
              <Card title={<>{schema.org.mode !== 'none' ? `${L}별 파일` : '파일'} <span className="text-[13px] font-normal text-sub">{res.files.length}개{fileAttention ? <> · <span className="text-warn-ink">살펴볼 파일 {fileAttention}개</span></> : ''} · 줄을 누르면 읽은 내용이 펼쳐져요</span></>}>
                <FileTable schema={schema} res={res} d={d} set={set} />
              </Card>
            </div>
          )}
        </div>

        <aside aria-label="검토" className="flex min-w-0 flex-col rounded-card border border-line bg-white lg:sticky lg:top-3 lg:max-h-[calc(100vh-200px)]">
          <div className="flex flex-wrap items-center gap-2 px-4 pb-2 pt-3">
            <h2 className="m-0 text-[15px] font-bold">{card ? SIDE_TITLE[card] : '검토 순서'}</h2>
            {card === 'check' && <Chip tone={pending ? 'req' : 'ok'}>{pending ? `남음 ${pending}` : '모두 고름'}</Chip>}
            {card && <Btn sm className="ml-auto" onClick={() => { setCard(null); setOrg(null); setSel(null); }}>닫기</Btn>}
          </div>
          <div className="min-h-0 flex-1 overflow-auto px-3.5 pb-3">{sideBody()}</div>

          <div className="rounded-b-card border-t border-line px-4 py-3">
            <details className="mb-1.5 text-[12.5px]"><summary className="cursor-pointer text-pri-ink">결과 파일에 넣을 시트: {available.filter((m) => required.includes(m) || methods.includes(m)).map((m) => (collect && m === 'collect-sheets' ? `목차 + ${L}별 시트` : m === 'spread' ? `${spreadName(schema)} 펼치기` : AGGREGATION_LABELS[m])).join(' · ')} (바꾸기)</summary>
              <div className="mt-1.5 flex flex-col gap-1">
                {available.map((m) => {
                  const req = required.includes(m);
                  const label = collect && m === 'collect-sheets' ? `목차 + ${L}별 시트` : m === 'spread' ? `${spreadName(schema)} 펼치기` : AGGREGATION_LABELS[m];
                  return (
                    <label key={m} className="flex items-center gap-1.5">
                      <input type="checkbox" checked={req || methods.includes(m)} disabled={req} onChange={(e) => setMethods((x) => (e.target.checked ? [...x, m] : x.filter((y) => y !== m)))} />
                      {label}{req && ' (필수)'}
                    </label>
                  );
                })}
              </div></details>
            <p className="m-0 mb-2 text-xs text-sub">{collect ? '검토 사항 시트(파일목록 · 판단 기록)도 함께 들어가요.' : `검토 파일도 함께 받아요: 표시가 남은 표 + 검토 사항 시트(검산 · 오류 · 파일목록 · 판단 기록${noteCount ? ` · 메모 ${noteCount}개` : ''})`}</p>
            {manualCount > 0 && (
              <div className="mb-2 flex flex-col gap-1 text-[12.5px]">
                <label className="flex items-center gap-1.5"><input type="checkbox" checked={wantCopies} onChange={(e) => setWantCopies(e.target.checked)} /> 직접 고친 값을 반영한 회신 파일 사본도 받기 ({manualCount}칸)</label>
                {wantCopies && <label className="flex items-center gap-1.5 text-sub"><input type="checkbox" checked={withProposals} onChange={(e) => setWithProposals(e.target.checked)} /> 자동으로 고친 값도 사본에 반영</label>}
              </div>
            )}
            {pending > 0 && !confirm && <div className="mb-2 rounded-btn border border-req-line bg-req px-2.5 py-1 text-xs text-req-ink">확인하지 않은 {pending}칸은 자동 수정안으로 넣어요</div>}
            {confirm && (
              <div className="mb-2 flex flex-wrap items-center gap-2 rounded-box border border-req-line bg-req px-2.5 py-2 text-[12.5px] text-req-ink">
                <span className="w-full">확인하지 않은 {pending}칸은 자동으로 고친 값(고칠 수 없으면 적혀 있던 값 그대로)으로 넣어요.</span>
                <Btn sm onClick={() => { setConfirm(false); setCard('check'); setOrg(null); }}>목록 보기</Btn>
                <Btn sm pri onClick={() => void get(true)}>그대로 받기</Btn>
              </div>
            )}
            <Btn pri className="w-full justify-center py-2 text-[14px]" disabled={busy || !res.included.length} onClick={() => void get()}>{busy ? '만드는 중…' : collect ? '모은 파일 받기' : '취합 파일 받기'}</Btn>
          </div>
        </aside>
      </div>
    </div>
  );
}

function JsonButton({ onPick }: { onPick: (l: FileList | null) => void }) {
  return (
    <label className="cursor-pointer rounded-btn border border-line-strong bg-white px-2 py-0.5 text-xs text-ink">양식 파일 넣기
      <input type="file" accept=".json" hidden onChange={(e) => { onPick(e.target.files); e.target.value = ''; }} /></label>
  );
}

function SkippedList({ files }: { files: { name: string; reason: string }[] }) {
  return <ul className="mb-3 pl-5">{files.map((f) => <li key={f.name}>{f.name} — <span className="text-sub">{f.reason}</span></li>)}</ul>;
}

function Upload({ hint, onForget, bag, setBag, reading, error, onAdd, onStart }: {
  hint: FormSchema | null; onForget: () => void; bag: InputFile[]; setBag: (b: InputFile[]) => void; reading: boolean; error: string;
  onAdd: (l: FileList | null) => void; onStart: () => void;
}) {
  const pick = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  if (reading) {
    return (
      <div className="mx-auto mt-10 max-w-[640px] rounded-card border border-line p-5">
        <h2 className="m-0 mb-2 text-[15px]">파일 읽는 중 <Chip tone="pri">{bag.length}개</Chip></h2>
        <div className="h-2 overflow-hidden rounded bg-chip"><div className="h-full w-1/2 animate-pulse bg-pri" /></div>
        <p className="text-sub">파일 내용은 이 컴퓨터 안에서만 읽어요. 다 읽으면 검토 화면으로 넘어가요.</p>
      </div>
    );
  }
  const kinds = bag.reduce<Record<string, number>>((m, f) => { const k = /\.([^.]+)$/.exec(f.name)?.[1]?.toLowerCase() ?? '?'; m[k] = (m[k] ?? 0) + 1; return m; }, {});
  return (
    <div className="mx-auto max-w-[900px] p-5">
      {hint && (
        <section className="mb-3.5 flex flex-wrap items-center gap-3.5 rounded-card border border-line p-4">
          <div className="min-w-[240px] flex-1">
            <div className="text-xs text-sub">받는 중인 양식 · 양식 만들기에서 넘어왔어요</div>
            <div className="text-[16px] font-bold">{hint.title} <Chip>v{hint.formVersion}</Chip> <Chip>{LAYOUT_LABELS[hint.layout]}</Chip></div>
            <div className="text-sub">{hint.org.orgs?.length ? `${orgLabel(hint)} ${hint.org.orgs.length}곳 · ` : ''}{hint.deadline ? `제출 기한 ${hint.deadline} · ` : ''}이 양식의 회신 파일만 넣으면 돼요. 다른 양식 파일은 자동으로 빠져요.</div>
          </div>
          <Btn sm onClick={onForget}>다른 양식 회신 취합하기</Btn>
        </section>
      )}
      {error && <Banner tone="err">{error}</Banner>}
      <input ref={pick} type="file" multiple hidden accept=".xlsx,.xls,.csv,.zip,.json" onChange={(e) => { onAdd(e.target.files); e.target.value = ''; }} />
      <div role="button" tabIndex={0} aria-label="파일 넣기"
        className={cx('cursor-pointer rounded-card border-2 border-dashed px-5 py-12 text-center', over ? 'border-pri bg-pri-bg' : 'border-line-strong bg-panel')}
        onClick={() => pick.current?.click()} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick.current?.click(); } }}
        onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); onAdd(e.dataTransfer.files); }}>
        <div className="text-[18px] font-semibold">회신받은 엑셀 파일이나 zip을 여기에 끌어다 놓으세요</div>
        <div className="mt-1">또는 눌러서 파일 고르기</div>
        <div className="mt-1.5 text-sub">.xlsx와 옛 .xls(바꿔 읽음)를 처리합니다 · 이전 취합본도 함께 넣을 수 있어요 · 파일 내용은 이 컴퓨터 밖으로 나가지 않아요</div>
      </div>
      {bag.length > 0 && (
        <section className="mt-3.5 rounded-card border border-line p-4">
          <div className="flex flex-wrap items-center gap-2">
            <b>넣은 파일</b>
            <span className="text-sub">{bag.length}개 ({Object.entries(kinds).map(([k, n]) => `${k} ${n}`).join(' · ')})</span>
            <span className="flex-1" />
            <Btn sm onClick={() => setBag([])}>모두 빼기</Btn>
            <Btn pri onClick={onStart}>검토 시작</Btn>
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {bag.map((f) => (
              <span key={f.name} className="inline-flex items-center gap-1 rounded-box border border-line bg-white px-2 py-0.5">
                {f.name}<button type="button" aria-label={`${f.name} 빼기`} className="text-muted hover:text-err-ink" onClick={() => setBag(bag.filter((x) => x !== f))}>×</button>
              </span>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

/** 목록 줄은 0개여도 위쪽 정보·숫자 표에 적은 값이 있으면 '해당 없음'이 아니다 */
const filled = (v: unknown) => v !== null && v !== undefined && v !== '';
function hasOtherValues(schema: FormSchema, fin: Resolved['included'][number]): boolean {
  const calc = new Set(schema.blocks.flatMap((b) => (b.kind === 'fields' ? b.fields.filter((f) => f.type === 'calc').map((f) => f.key) : [])));
  return Object.entries(fin.header).some(([k, v]) => !calc.has(k) && filled(v)) || Object.values(fin.matrices ?? {}).some((m) => m.flat().some(filled)) || (fin.matrix ?? []).flat().some(filled);
}

/** 다른 제출처가 채우는 칸에 적어 쓰지 않은 값 (OTHER_ORG_CELL) */
export const otherOrgCells = (s: FileState) => s.parsed?.issues.filter((i) => i.code === 'OTHER_ORG_CELL') ?? [];

const STATUS_TONE: Record<FileState['status'], Tone> = { included: 'ok', duplicate: 'pri', operator: 'gray', 'form-sheet-missing': 'err', 'other-form': 'err', unreadable: 'err', 'duplicate-content': 'err' };

/** 파일 한 줄에 보여 줄 것: 상태 칩, 내용 요약, 남의 칸에 적은 값 (표·사이드바 카드 공통) */
function fileView(schema: FormSchema, res: Resolved, s: FileState) {
  const L = unitLabel(schema);
  const fin = res.included.find((x) => x.fileId === s.fileId);
  const issues = [...res.valueIssues, ...res.crossIssues].filter((i) => i.fileId === s.fileId).length;   // 빈칸채우기 필수 빈칸도 함께
  const infos = s.parsed?.issues.filter((i) => i.severity === 'info') ?? [];
  const others = s.status === 'included' ? otherOrgCells(s) : [];
  const chip = s.needsOrgLink ? <Chip tone="warn">{s.orgBlank ? `${L}명 없음` : `${L} 확인`}</Chip> : issues && s.status === 'included' ? <Chip tone="req">확인할 칸 {issues}</Chip>
    : others.length ? <Chip tone="warn">남의 칸에 적음 {others.length}</Chip>
    : s.dupGroup && s.status === 'included' ? <Chip tone="pri">중복 {s.dupGroup.length}개</Chip>
    : infos.some((i) => ['COLUMNS_REORDERED', 'HEADER_MOVED', 'COLUMN_MISSING', 'LABEL_MOVED'].includes(i.code)) && s.status === 'included' ? <Chip>구조 변경</Chip>
    : <Chip tone={STATUS_TONE[s.status]}>{s.status === 'included' && fin && !fin.rows.length && schema.blocks.some((b) => b.kind === 'list') && !hasOtherValues(schema, fin) ? '해당 없음' : s.status === 'included' ? '정상' : STATUS_LABEL[s.status]}</Chip>;
  const content = fin ? summary(schema, fin, s) : s.reason ?? '';
  const order = [...res.valueIssues, ...res.crossIssues].some((i) => i.fileId === s.fileId) || s.needsOrgLink ? 0 : s.status === 'included' ? 1 : s.status === 'duplicate' ? 2 : 3;
  return { chip, content, others, order, canOpen: !!s.parsed };
}

/** 파일마다 운영자가 고를 것: 중복 중 반영할 파일, 제출처 연결, 제외 */
function FileControls({ schema, res, s, d, set }: { schema: FormSchema; res: Resolved; s: FileState; d: Decisions; set: (p: (x: Decisions) => Decisions) => void }) {
  const L = unitLabel(schema);
  const orgs = schema.org.orgs ?? [];
  return (
    <div className="flex flex-wrap gap-1.5">
      {s.dupGroup && s.status === 'included' && (
        <select aria-label="반영할 파일" value={s.fileId} onChange={(e) => set((x) => { x.duplicateChoice[s.org!] = e.target.value; return x; })}>
          {s.dupGroup.map((id) => { const f = res.files.find((y) => y.fileId === id)!; return <option key={id} value={id}>{f.fileName} ({fmtTime(f.savedAt).slice(5)})</option>; })}
        </select>
      )}
      {s.parsed && orgs.length === 0 && (s.needsOrgLink || d.orgLink[s.fileId]) && (
        <input aria-label={`${L} 이름 입력`} placeholder={`${L} 이름`} defaultValue={d.orgLink[s.fileId] ?? ''} className="w-28 rounded border border-line px-1.5 py-0.5"
          onBlur={(e) => { const v = e.target.value.trim(); set((x) => { if (v) x.orgLink[s.fileId] = v; else delete x.orgLink[s.fileId]; return x; }); }} />
      )}
      {s.parsed && orgs.length > 0 && (s.needsOrgLink || d.orgLink[s.fileId]) && (
        <select aria-label={`연결할 ${L}`} value={d.orgLink[s.fileId] ?? ''} onChange={(e) => set((x) => { if (e.target.value) x.orgLink[s.fileId] = e.target.value; else delete x.orgLink[s.fileId]; return x; })}>
          <option value="">입력값 그대로</option>{orgs.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      )}
      {(s.status === 'included' || s.status === 'operator') && (
        <Btn sm onClick={() => set((x) => { x.excludeFile[s.fileId] = s.status !== 'operator'; return x; })}>{s.status === 'operator' ? '되돌리기' : '제외'}</Btn>
      )}
      {['other-form', 'unreadable', 'duplicate-content', 'form-sheet-missing'].includes(s.status) && <span className="text-xs text-sub">자동</span>}
    </div>
  );
}

function FileTable({ schema, res, d, set }: { schema: FormSchema; res: Resolved; d: Decisions; set: (p: (x: Decisions) => Decisions) => void }) {
  const [open, setOpen] = useState<string | null>(null);
  const L = unitLabel(schema);
  const rows = [...res.files].sort((a, b) => fileView(schema, res, a).order - fileView(schema, res, b).order);
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] border-collapse">
        <thead><tr className="text-left text-xs text-sub">{[schema.org.mode === 'none' ? '파일' : `${L} / 파일`, '상태', '내용', '처리'].map((h) => <th key={h} className="border-b border-line px-2 py-1.5 font-semibold">{h}</th>)}</tr></thead>
        <tbody>
          {rows.map((s) => {
            const { chip, content, others, canOpen } = fileView(schema, res, s);
            return [
              <tr key={s.fileId} className={cx('border-b border-line', canOpen && 'cursor-pointer hover:bg-panel', s.status !== 'included' && s.status !== 'duplicate' && 'opacity-60')}
                onClick={(e) => { if (canOpen && !(e.target as HTMLElement).closest('button,select,input')) setOpen(open === s.fileId ? null : s.fileId); }}>
                <td className="px-2 py-1.5">{s.label}{s.label !== s.fileName && <div className="text-xs text-sub">{s.fileName}</div>}</td>
                <td className="px-2 py-1.5">{chip}</td>
                <td className="px-2 py-1.5">{content}</td>
                <td className="px-2 py-1.5"><FileControls schema={schema} res={res} s={s} d={d} set={set} /></td>
              </tr>,
              others.length > 0 && (
                <tr key={`${s.fileId}-o`} className="border-b border-line"><td colSpan={4} className="px-2 pb-2">
                  {others.map((i) => <div key={i.id} className="rounded-btn border border-[#f3cfa5] bg-warn px-2.5 py-1 text-[12.5px] text-warn-ink">⚠ {i.address} · {i.message}</div>)}
                </td></tr>
              ),
              open === s.fileId && s.parsed && (
                <tr key={`${s.fileId}-d`} className="border-b border-line bg-panel"><td colSpan={4} className="px-3 py-2.5"><FileDetail res={res} s={s} /></td></tr>
              ),
            ];
          })}
          {res.missingOrgs.length > 0 && (
            <tr className="opacity-60"><td className="px-2 py-1.5">{res.missingOrgs.join(' · ')}</td><td className="px-2 py-1.5"><Chip>미제출</Chip></td><td className="px-2 py-1.5">파일이 없어요</td><td /></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

/** 사이드바용 파일 목록: 파일마다 카드 한 장. 누르면 그 파일 줄을 표에서 모으고(onPick), [읽은 내용]으로 자세히 */
function FileCards({ schema, res, d, set, sel, onPick }: { schema: FormSchema; res: Resolved; d: Decisions; set: (p: (x: Decisions) => Decisions) => void; sel: string | null; onPick: (fileId: string) => void }) {
  const [open, setOpen] = useState<string | null>(null);
  const rows = [...res.files].sort((a, b) => fileView(schema, res, a).order - fileView(schema, res, b).order);
  return (
    <>
      {rows.map((s) => {
        const { chip, content, others, canOpen } = fileView(schema, res, s);
        const pickable = s.status === 'included';
        return (
          <div key={s.fileId} data-side={s.fileId}
            className={cx('mb-2 rounded-box border bg-white px-3 py-2', sel === s.fileId ? 'border-acc shadow-[0_0_0_2px_var(--color-acc-bg)]' : 'border-line', pickable && 'cursor-pointer hover:border-line-strong', !pickable && s.status !== 'duplicate' && 'opacity-60')}
            onClick={(e) => { if (pickable && !(e.target as HTMLElement).closest('button,select,input')) onPick(s.fileId); }}>
            <div className="flex items-center gap-2"><b className="min-w-0 flex-1 truncate">{s.label}</b>{chip}</div>
            {s.label !== s.fileName && <div className="truncate text-xs text-muted" title={s.fileName}>{s.fileName}</div>}
            {content && <div className="mt-0.5 text-[12.5px] text-sub">{content}</div>}
            {others.map((i) => <div key={i.id} className="mt-1 rounded-btn border border-[#f3cfa5] bg-warn px-2 py-0.5 text-[12.5px] text-warn-ink">⚠ {i.address} · {i.message}</div>)}
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              <FileControls schema={schema} res={res} s={s} d={d} set={set} />
              {canOpen && <Btn sm onClick={() => setOpen(open === s.fileId ? null : s.fileId)}>{open === s.fileId ? '접기' : '읽은 내용'}</Btn>}
            </div>
            {open === s.fileId && s.parsed && <div className="mt-2 rounded-box bg-panel px-2.5 py-2"><FileDetail res={res} s={s} /></div>}
          </div>
        );
      })}
      {res.missingOrgs.length > 0 && <div className="mb-2 rounded-box border border-line px-3 py-2 opacity-60"><b>{res.missingOrgs.join(' · ')}</b> <Chip>미제출</Chip></div>}
    </>
  );
}

function summary(schema: FormSchema, fin: Resolved['included'][number], s: FileState): string {
  if (schema.layout === 'collect') {
    const r = fin.read;
    return `모을 시트: ${r.collectSheets?.join(', ')}${r.unreadSheets.length ? ` · ${r.unreadSheets.join(', ')} 시트는 모으지 않음` : ''}`;
  }
  const parts: string[] = [];
  if (fin.fromAggregate) parts.push('본부 취합본에서 풀어냄');
  if (schema.blocks.some((b) => b.kind === 'list')) parts.push(`${fin.rows.length}행`);
  if (fin.grid) parts.push(`채운 칸 ${Object.keys(fin.grid).length}개`);
  if (fin.gridSpareRows?.length) parts.push(`여유 줄 ${fin.gridSpareRows.length}줄`);
  if (fin.autoFixed.length) parts.push(`자동 정리 ${fin.autoFixed.length}칸`);
  if (fin.read.authorNotes.length) parts.push(`작성자 메모 ${fin.read.authorNotes.length}개`);
  if (fin.read.hiddenArea) parts.push(fin.removedRows.some((r) => r.reason === 'hidden') || fin.droppedExtra.length ? '숨긴 곳 뺌' : '숨긴 곳 있음');
  if (fin.read.infos.some((i) => i.code === 'FILTER_CLEARED')) parts.push('필터 풀고 읽음');
  if (s.dupGroup) parts.push(`저장 ${fmtTime(s.savedAt)} 파일 사용`);
  return parts.join(' · ');
}

function FileDetail({ res, s }: { res: Resolved; s: FileState }) {
  const p = s.parsed!;
  const fin = res.included.find((x) => x.fileId === s.fileId);
  const r = p.read;
  const reasons: Record<string, string> = { blank: '빈 줄', example: '예시 줄', total: '합계 줄', operator: '운영자 제외', duplicate: '중복', hidden: '숨긴 줄 제외' };
  const ex = [...r.excludedRows, ...(fin?.removedRows ?? [])].reduce<Record<string, number>>((m, e) => { m[e.reason] = (m[e.reason] ?? 0) + 1; return m; }, {});
  const kept = fin ? fin.rows.length + (fin.gridSpareRows?.length ?? 0) : 0;
  const collectSheets = r.collectSheets ?? [];
  return (
    <div className="flex flex-col gap-1.5 text-[12.5px]">
      {r.readCount > 0 && <div>읽은 {r.readCount}줄 = 반영 {kept}{Object.entries(ex).map(([k, n]) => ` + ${reasons[k]} ${n}`).join('')}</div>}
      {/* 시트 모으기형은 칸을 읽지 않으니, 펼친 칸에 옮겨 갈 시트 이름을 보여 준다 */}
      {collectSheets.length > 0 && <div>모을 시트 {collectSheets.length}개: <b>{collectSheets.join(', ')}</b> — 결과 파일에 그대로 옮겨요</div>}
      {p.autoFixed.length > 0 && (
        <table className="border-collapse">
          <thead><tr className="text-left text-xs text-sub"><th className="pr-3">위치</th><th className="pr-3">원래 값</th><th>정리한 값</th></tr></thead>
          <tbody>{p.autoFixed.slice(0, 50).map((a) => <tr key={a.address}><td className="pr-3">{a.address}</td><td className="pr-3"><Val kind="in">{show(a.from)}</Val></td><td><Val kind="fix">{show(a.to)}</Val></td></tr>)}</tbody>
        </table>
      )}
      {r.authorNotes.length > 0 && <div>작성자 메모 {r.authorNotes.length}개: {r.authorNotes.map((n) => `${n.address} "${n.text}"`).join(', ')}</div>}
      {r.unreadSheets.length > 0 && <div>{collectSheets.length > 0 ? `모으지 않는 시트: ${r.unreadSheets.join(', ')}` : `읽지 않은 시트: ${r.unreadSheets.join(', ')} (작성자가 추가한 시트라 읽지 않았어요)`}</div>}
      {r.extraColumns.length > 0 && <div>양식에 없는 칸: {r.extraColumns.map((e) => e.header).join(', ')} → 결과 파일 "추가 칸" 시트에 담아요</div>}
      {p.issues.filter((i) => i.severity === 'info' && i.code !== 'OTHER_ORG_CELL').map((i) => <div key={i.id} className="text-sub">· {i.message}</div>)}
    </div>
  );
}

function FixRow({ i, who, field, d, set, out, today, toTable }: { i: Issue; who: string; field?: Field; d: Decisions; set: (p: (x: Decisions) => Decisions) => void; out: boolean; today: Date; toTable?: ReactNode }) {
  const fix = d.cellFix[i.id];
  const rowKey = i.slot && 'sourceRow' in i.slot ? `${i.fileId}:${i.slot.sourceRow}` : null;
  if (out) {
    return (
      <div className="flex flex-wrap items-center gap-2 py-0.5 opacity-70">
        <span>{who} · {i.location}</span><Chip>이 줄은 뺐어요 · 취합본에 넣지 않음</Chip>
        <Btn sm onClick={() => set((x) => { delete x.excludeRow[rowKey!]; return x; })}>되돌리기</Btn>
      </div>
    );
  }
  const choose = (mode: 'proposal' | 'manual' | 'keep') => set((x) => { x.cellFix[i.id] = { mode, value: mode === 'manual' ? fix?.value ?? '' : undefined }; return x; });
  const manualErr = fix?.mode === 'manual' && fix.value !== '' && fix.value !== undefined && field ? (() => { const r = normalize(fix.value, field, { year: today.getFullYear(), today }); return r.status === 'proposal' || r.status === 'invalid' ? '이 값도 양식 규칙에 맞지 않아요' : null; })() : null;
  const radio = (mode: 'proposal' | 'manual' | 'keep', label: string) => (
    <label className="flex items-center gap-1"><input type="radio" name={i.id} checked={fix?.mode === mode} onChange={() => choose(mode)} />{label}</label>
  );
  return (
    <div className={cx('py-0.5', fix && 'opacity-80')}>
      <div className="mb-1.5 flex items-start gap-2"><div className="min-w-0"><b>{who}</b> <span className="text-sub">· {i.location}</span><div className="text-[12.5px] font-semibold text-err-ink">{i.message}</div></div>{toTable}</div>
      <div className="mb-1.5 flex flex-wrap items-center gap-2">
        <div className="rounded-box border border-req-line bg-[#fffbea] px-2.5 py-1"><div className="text-[11px] text-req-ink">받은 파일에 적혀 있던 값</div><Val kind="in">{show(i.raw)}</Val></div>
        {i.code !== 'REQUIRED_EMPTY' && (
          <>
            <span className="text-muted">→</span>
            <div className="rounded-box border border-pri-line bg-[#f4f8fe] px-2.5 py-1"><div className="text-[11px] text-pri-ink">자동으로 고친 값</div>{i.proposal !== undefined ? <Val kind="fix">{show(i.proposal)}</Val> : <span className="text-xs text-sub">자동으로 고칠 수 없어요</span>}</div>
          </>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        {i.proposal !== undefined && radio('proposal', '자동으로 고친 값 쓰기')}
        {radio('manual', '직접 고쳐 쓰기')}
        {fix?.mode === 'manual' && (
          <input type="text" aria-label="직접 고칠 값" placeholder="넣을 값" className="w-32 rounded-btn border border-line-strong px-2 py-0.5" autoFocus
            value={String(fix.value ?? '')} onChange={(e) => set((x) => { x.cellFix[i.id] = { mode: 'manual', value: e.target.value }; return x; })} />
        )}
        {radio('keep', '적혀 있던 값 그대로')}
        {rowKey && <Btn sm onClick={() => set((x) => { x.excludeRow[rowKey] = true; return x; })}>이 줄 빼기</Btn>}
      </div>
      {manualErr && <div className="mt-1 text-xs text-err-ink">{manualErr} (그래도 저장은 돼요)</div>}
      {fix && <div className="mt-1 text-xs font-semibold text-pri-ink">✓ {fix.mode === 'proposal' ? '자동으로 고친 값을 써요' : fix.mode === 'manual' ? '직접 고친 값을 써요' : '적혀 있던 값 그대로 넣어요'}</div>}
    </div>
  );
}

function QuestionRow({ q, who, d, set }: { q: Question; who?: string; d: Decisions; set: (p: (x: Decisions) => Decisions) => void }) {
  const ans = d.answers[q.id];
  return (
    <div className={cx('py-0.5', ans && 'opacity-80')}>
      <div className="mb-1.5">{who ? <b>{who} · </b> : null}{q.message}</div>
      <div className="flex flex-wrap gap-3">
        {q.choices.map((c) => (
          <label key={c.id} className="flex items-center gap-1">
            <input type="radio" name={q.id} checked={ans === c.id} onChange={() => set((x) => { x.answers[q.id] = c.id; return x; })} />
            {c.label}{c.id === q.defaultChoice && <span className="text-xs text-sub">(기본)</span>}
          </label>
        ))}
      </div>
    </div>
  );
}
