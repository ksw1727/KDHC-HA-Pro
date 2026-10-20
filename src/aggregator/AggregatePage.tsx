import { useMemo, useRef, useState, type ReactNode } from 'react';
import { AGGREGATION_LABELS, availableAggregations, requiredAggregations, type AggregationId } from '@contract/aggregationIds';
import { blockFields, LAYOUT_LABELS, orgLabel, type Field, type FormSchema } from '@contract/schema';
import { analyze, loadInputs, patchCopies, type Analysis, type InputFile } from './pipeline/run';
import { resolve, STATUS_LABEL, type FileState, type Resolved } from './pipeline/resolve';
import { preview, writeResult } from './pipeline/write';
import { fmtTime, spreadName } from './pipeline/aggregate';
import { normalize } from './pipeline/normalize';
import { emptyDecisions, type Decisions, type Issue, type Question } from './pipeline/types';

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

function download(name: string, bytes: Uint8Array, type: string) {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/** 양식 만들기에서 넘어온 양식 (브라우저에 저장된 것). 실패하면 없음 */
function storedForm(formId?: string): FormSchema | null {
  if (!formId) return null;
  try {
    const raw = localStorage.getItem(`hanan-moa:forms:${formId}`);
    const v = raw ? (JSON.parse(raw) as { schema: FormSchema; lastExported?: FormSchema }) : null;
    return v ? v.lastExported ?? v.schema : null;
  } catch { return null; }
}

async function toInputs(list: FileList | File[]): Promise<InputFile[]> {
  return Promise.all([...list].map(async (f) => ({ name: f.name, bytes: new Uint8Array(await f.arrayBuffer()), lastModified: f.lastModified })));
}

type Stage = 'upload' | 'reading' | 'review' | 'done';

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
  const [done, setDone] = useState<{ files: string[]; message: string } | null>(null);
  const [error, setError] = useState('');
  const fixRef = useRef<HTMLDivElement>(null);

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
          <ul className="m-0 list-disc pl-5">{done.files.map((f) => <li key={f}>{f}</li>)}</ul>
          <p className="text-sub">다운로드 폴더에 저장됐어요. 취합본을 나중에 다시 넣으면 다른 취합본과 합칠 수 있어요.</p>
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

  const L = orgLabel(schema);
  const collect = schema.layout === 'collect';
  const fieldOf = new Map<string, Field>();
  for (const b of schema.blocks) for (const f of blockFields(b)) fieldOf.set(f.key, f);
  const included = new Set(res.included.map((s) => s.fileId));
  const allValueIssues = analysis.parsed.filter((p) => included.has(p.fileId)).flatMap((p) => p.issues.filter((i) => i.severity === 'value'));
  const rowOut = (i: Issue) => !!(i.slot && 'sourceRow' in i.slot && d.excludeRow[`${i.fileId}:${i.slot.sourceRow}`]);
  const visibleIssues = allValueIssues.filter((i) => rowOut(i) || res.valueIssues.some((v) => v.id === i.id));
  const pending = visibleIssues.filter((i) => !rowOut(i) && !d.cellFix[i.id]).length + res.questions.filter((q) => d.answers[q.id] === undefined).length
    + res.files.filter((f) => f.orgBlank && f.needsOrgLink && f.status === 'included').length;   // 제출처 이름이 빈 파일
  const manualCount = Object.values(d.cellFix).filter((x) => x?.mode === 'manual').length;
  const autoCount = res.included.reduce((s, x) => s + x.autoFixed.length, 0);
  const noteCount = res.included.reduce((s, x) => s + x.read.authorNotes.length, 0);
  const excluded = res.files.filter((f) => f.status !== 'included' && f.status !== 'duplicate').length;
  const orgsTotal = schema.org.mode === 'preset' || (schema.org.orgs?.length ?? 0) > 0 ? (schema.org.orgs?.length ?? 0) : 0;
  const noMeta = analysis.identified.filter((f) => f.status === 'unreadable' && f.skipReason?.startsWith('한난MOA 양식 파일이 아니거나')).length;
  const available = availableAggregations(schema);
  const required = requiredAggregations(schema);

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
      download(out.fileName, out.bytes, XLSX);
      const names = [out.fileName];
      if (out.review) { download(out.review.fileName, out.review.bytes, XLSX); names.push(`${out.review.fileName} (검토용: 출처·오류·검산)`); }
      if (wantCopies && manualCount && loaded) {
        const c = await patchCopies(res, loaded.files, withProposals, at, schema.title);
        if (c?.count) { download(c.fileName, c.bytes, 'application/zip'); names.push(`${c.fileName} (회신 파일 ${c.count}개)`); }
        for (const k of c?.skipped ?? []) names.push(`수정본 사본 없음: ${k.fileName} — ${k.reason}`);
      }
      const rows = res.included.reduce((s, x) => s + x.rows.length + (x.gridSpareRows?.length ?? 0), 0);
      const who = schema.org.mode === 'none' ? `파일 ${res.included.length}개` : `${L} ${res.included.length}곳`;
      const hasList = schema.blocks.some((b) => b.kind === 'list');
      const spare = schema.blocks.some((b) => b.kind === 'grid' && b.spareRows > 0);
      const what = collect ? '의 시트를 모았어요' : hasList ? `, 행 ${rows}개를 취합했어요` : spare && rows ? `을 취합했어요 (여유 줄 ${rows}줄)` : '을 취합했어요';
      setDone({ files: names, message: `${who}${what} · 검산 ${out.verify.ok ? '일치' : '불일치 — 받은 파일의 검산 시트를 확인해 주세요'}` });
      setStage('done');
    } catch (e) {
      setError(`결과 파일을 만들다가 문제가 생겼어요: ${(e as Error).message}`);
    } finally { setBusy(false); }
  };

  // 목록에 있는 제출처 중 낸 곳 / 목록 수 (+ 목록에 없는 이름으로 낸 파일)
  const outsideList = orgsTotal ? res.included.filter((x) => !x.org || !(schema.org.orgs ?? []).includes(x.org)).length : 0;
  const stats: [string, ReactNode, Tone?][] = [
    ['제출', orgsTotal ? `${orgsTotal - res.missingOrgs.length}/${orgsTotal}${outsideList ? ` + 목록 밖 ${outsideList}` : ''}` : res.included.length],
    ...(!collect ? [['확인할 칸', pending, pending ? 'req' : undefined] as [string, ReactNode, Tone?], ['자동 정리', autoCount] as [string, ReactNode], ['작성자 메모', noteCount] as [string, ReactNode]] : []),
    ['제외', excluded],
    ...(orgsTotal ? [['미제출', res.missingOrgs.length] as [string, ReactNode]] : []),
    ...(!collect ? [['검산', pv.verify.ok ? '일치' : '불일치', pv.verify.ok ? 'ok' : 'err'] as [string, ReactNode, Tone?]] : []),
  ];

  return (
    <div className="mx-auto max-w-[1100px] p-5">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <b className="text-[16px]">{schema.title}</b><Chip>v{schema.formVersion}</Chip><Chip>{LAYOUT_LABELS[schema.layout]}</Chip>
        <span className="text-sub">파일 {analysis.identified.length}개</span>
        <span className="flex-1" />
        <label className="cursor-pointer rounded-btn border border-line-strong bg-white px-3 py-1.5 hover:bg-panel">파일 더 넣기
          <input type="file" multiple hidden accept=".xlsx,.xls,.csv,.zip,.json" onChange={(e) => { void addMore(e.target.files); e.target.value = ''; }} /></label>
        <Btn onClick={() => { setStage('upload'); setBag([]); setAnalysis(null); }}>처음으로</Btn>
      </div>
      {error && <Banner tone="err">{error}</Banner>}
      {!pv.verify.ok && <Banner tone="err"><b>검산이 맞지 않아요.</b> 받기 전에 아래 검산 내역을 확인해 주세요.</Banner>}
      {noMeta > 0 && <Banner tone="warn">양식 정보가 없는 파일이 {noMeta}개 있어요. 양식 파일(.form.json)을 넣으면 이 파일도 취합할 수 있어요. <JsonButton onPick={addMore} /></Banner>}
      {loaded?.notes.map((n) => <Banner key={n} tone="warn">{n}</Banner>)}

      <div className="mb-3.5 flex flex-wrap gap-2">
        {stats.map(([k, v, t]) => (
          <div key={k} className={cx('min-w-[96px] rounded-box border px-3 py-2', t ? TONE[t] : 'border-line bg-white')}>
            <div className="text-xs text-sub">{k}</div><b className="text-[18px]">{v}</b>
          </div>
        ))}
      </div>

      <Card title={<>{collect ? `${L}별 파일` : '파일'} <span className="text-xs font-normal text-sub">줄을 누르면 읽은 내용이 펼쳐져요</span></>}>
        <FileTable schema={schema} res={res} d={d} set={set} />
      </Card>

      {!collect && (
        <Card title={<>확인할 칸 <Chip tone={pending ? 'req' : 'ok'}>{pending ? `남음 ${pending}` : '모두 고름'}</Chip></>}
          right={visibleIssues.length > 0 && <Btn sm onClick={applyAll}>남은 칸 모두 "자동으로 고친 값" 쓰기</Btn>}>
          <div ref={fixRef}>
            {visibleIssues.length + res.questions.length + res.crossIssues.length === 0 ? <p className="m-0 text-sub">확인할 칸이 없어요.</p> : (
              <>
                <div className="mb-1.5 flex flex-wrap gap-4 text-xs text-sub"><span><Val kind="in">노란 상자</Val> 받은 회신 파일에 적혀 있던 값</span><span><Val kind="fix">파란 상자</Val> 취합하면서 프로그램이 자동으로 고친 값</span></div>
                <p className="m-0 mb-1 text-xs text-sub">고르지 않은 칸은 받을 때 자동으로 고친 값으로 들어가고(고칠 수 없으면 적혀 있던 값 그대로), 판단 기록에 "기본값 적용"으로 남아요.</p>
                {visibleIssues.map((i) => <FixRow key={i.id} i={i} who={res.files.find((f) => f.fileId === i.fileId)?.label ?? ''} field={i.slot ? fieldOf.get(i.slot.key) : undefined} d={d} set={set} out={rowOut(i)} today={today} />)}
                {res.questions.map((q) => <QuestionRow key={q.id} q={q} who={q.fileId ? res.files.find((f) => f.fileId === q.fileId)?.label : undefined} d={d} set={set} />)}
                {res.crossIssues.map((i) => <div key={i.id} className="border-t border-line py-2.5"><b>{i.location}</b> <span className="text-err-ink">{i.message}</span> <span className="text-xs text-sub">(오류 시트에 기록)</span></div>)}
              </>
            )}
          </div>
        </Card>
      )}

      {!collect && (
        <Card title={<>검산 <Chip tone={pv.verify.ok ? 'ok' : 'err'}>{pv.verify.ok ? '일치' : '불일치'}</Chip></>}>
          <ul className="m-0 pl-5">{pv.verify.lines.map((l, k) => <li key={k} className={cx('py-0.5', !l.ok && 'text-err-ink')}><b>{l.check}</b> — {l.detail}</li>)}</ul>
        </Card>
      )}

      <Card title="결과에 넣을 시트">
        <p className="m-0 mb-2 text-xs text-sub">{collect ? '항상 들어가는 시트: 파일목록 · 판단 기록 (그림이 빠진 시트가 있으면 오류 시트에 안내)' : `파일 두 개를 받아요. 결과 파일: 취합한 표와 아래에서 고른 시트. 검토 파일: 출처 파일·원본 줄·상태가 붙은 표와 오류 · 파일목록 · 검산 · 판단 기록${noteCount ? ` · 메모(작성자가 단 엑셀 메모 ${noteCount}개)` : ''}`}</p>
        <div className="flex flex-wrap gap-4">
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
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          {manualCount > 0 && (
            <>
              <label className="flex items-center gap-1.5"><input type="checkbox" checked={wantCopies} onChange={(e) => setWantCopies(e.target.checked)} /> 직접 고친 값을 반영한 회신 파일 사본도 받기 ({manualCount}칸)</label>
              {wantCopies && <label className="flex items-center gap-1.5 text-sub"><input type="checkbox" checked={withProposals} onChange={(e) => setWithProposals(e.target.checked)} /> 자동으로 고친 값도 사본에 반영</label>}
            </>
          )}
          <span className="flex-1" />
          <Btn pri disabled={busy || !res.included.length} onClick={() => void get()}>{busy ? '만드는 중…' : collect ? '모은 파일 받기' : '취합 파일 받기'}</Btn>
        </div>
        {confirm && (
          <Banner tone="req">
            <span>확인하지 않은 {pending}칸은 자동으로 고친 값(고칠 수 없으면 적혀 있던 값 그대로)으로 넣어요.</span>
            <Btn sm onClick={() => { setConfirm(false); fixRef.current?.scrollIntoView({ behavior: 'smooth' }); }}>목록 보기</Btn>
            <Btn sm pri onClick={() => void get(true)}>그대로 받기</Btn>
          </Banner>
        )}
      </Card>
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
        <div className="mt-1.5 text-sub">.xlsx만 처리합니다 · 이전 취합본도 함께 넣을 수 있어요 · 파일 내용은 이 컴퓨터 밖으로 나가지 않아요</div>
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

const STATUS_TONE: Record<FileState['status'], Tone> = { included: 'ok', duplicate: 'pri', operator: 'gray', 'form-sheet-missing': 'err', 'other-form': 'err', unreadable: 'err', 'duplicate-content': 'err' };

function FileTable({ schema, res, d, set }: { schema: FormSchema; res: Resolved; d: Decisions; set: (p: (x: Decisions) => Decisions) => void }) {
  const [open, setOpen] = useState<string | null>(null);
  const L = orgLabel(schema);
  const orgs = schema.org.orgs ?? [];
  const order = (s: FileState) => {
    const p = res.valueIssues.some((i) => i.fileId === s.fileId) || s.needsOrgLink ? 0 : s.status === 'included' ? 1 : s.status === 'duplicate' ? 2 : 3;
    return p;
  };
  const rows = [...res.files].sort((a, b) => order(a) - order(b));
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] border-collapse">
        <thead><tr className="text-left text-xs text-sub">{[`${L} / 파일`, '상태', '내용', '처리'].map((h) => <th key={h} className="border-b border-line px-2 py-1.5 font-semibold">{h}</th>)}</tr></thead>
        <tbody>
          {rows.map((s) => {
            const fin = res.included.find((x) => x.fileId === s.fileId);
            const issues = res.valueIssues.filter((i) => i.fileId === s.fileId).length;
            const infos = s.parsed?.issues.filter((i) => i.severity === 'info') ?? [];
            const chip = s.needsOrgLink ? <Chip tone="warn">{s.orgBlank ? `${L}명 없음` : `${L} 확인`}</Chip> : issues && s.status === 'included' ? <Chip tone="req">확인할 칸 {issues}</Chip>
              : s.dupGroup && s.status === 'included' ? <Chip tone="pri">중복 {s.dupGroup.length}개</Chip>
              : infos.some((i) => ['COLUMNS_REORDERED', 'HEADER_MOVED', 'COLUMN_MISSING', 'LABEL_MOVED'].includes(i.code)) && s.status === 'included' ? <Chip>구조 변경</Chip>
              : <Chip tone={STATUS_TONE[s.status]}>{s.status === 'included' && fin && !fin.rows.length && schema.blocks.some((b) => b.kind === 'list') ? '해당 없음' : s.status === 'included' ? '정상' : STATUS_LABEL[s.status]}</Chip>;
            const content = fin ? summary(schema, fin, s) : s.reason ?? '';
            const canOpen = !!s.parsed;
            return [
              <tr key={s.fileId} className={cx('border-b border-line', canOpen && 'cursor-pointer hover:bg-panel', s.status !== 'included' && s.status !== 'duplicate' && 'opacity-60')}
                onClick={(e) => { if (canOpen && !(e.target as HTMLElement).closest('button,select')) setOpen(open === s.fileId ? null : s.fileId); }}>
                <td className="px-2 py-1.5">{s.label}{s.label !== s.fileName && <div className="text-xs text-sub">{s.fileName}</div>}</td>
                <td className="px-2 py-1.5">{chip}</td>
                <td className="px-2 py-1.5">{content}</td>
                <td className="px-2 py-1.5">
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
                </td>
              </tr>,
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
  return (
    <div className="flex flex-col gap-1.5 text-[12.5px]">
      {r.readCount > 0 && <div>읽은 {r.readCount}줄 = 반영 {kept}{Object.entries(ex).map(([k, n]) => ` + ${reasons[k]} ${n}`).join('')}</div>}
      {p.autoFixed.length > 0 && (
        <table className="border-collapse">
          <thead><tr className="text-left text-xs text-sub"><th className="pr-3">위치</th><th className="pr-3">원래 값</th><th>정리한 값</th></tr></thead>
          <tbody>{p.autoFixed.slice(0, 50).map((a) => <tr key={a.address}><td className="pr-3">{a.address}</td><td className="pr-3"><Val kind="in">{show(a.from)}</Val></td><td><Val kind="fix">{show(a.to)}</Val></td></tr>)}</tbody>
        </table>
      )}
      {r.authorNotes.length > 0 && <div>작성자 메모 {r.authorNotes.length}개: {r.authorNotes.map((n) => `${n.address} "${n.text}"`).join(', ')}</div>}
      {r.unreadSheets.length > 0 && <div>읽지 않은 시트: {r.unreadSheets.join(', ')} (작성자가 추가한 시트라 읽지 않았어요)</div>}
      {r.extraColumns.length > 0 && <div>양식에 없는 칸: {r.extraColumns.map((e) => e.header).join(', ')} → 결과 파일 "추가 칸" 시트에 담아요</div>}
      {p.issues.filter((i) => i.severity === 'info').map((i) => <div key={i.id} className="text-sub">· {i.message}</div>)}
    </div>
  );
}

function FixRow({ i, who, field, d, set, out, today }: { i: Issue; who: string; field?: Field; d: Decisions; set: (p: (x: Decisions) => Decisions) => void; out: boolean; today: Date }) {
  const fix = d.cellFix[i.id];
  const rowKey = i.slot && 'sourceRow' in i.slot ? `${i.fileId}:${i.slot.sourceRow}` : null;
  if (out) {
    return (
      <div className="flex flex-wrap items-center gap-2 border-t border-line py-2.5 opacity-70">
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
    <div className={cx('border-t border-line py-2.5', fix && 'opacity-80')}>
      <div className="mb-1.5"><b>{who} · {i.location}</b> <span className="text-err-ink">{i.message}</span></div>
      <div className="mb-1.5 flex flex-wrap items-center gap-2">
        <div className="rounded-box border border-req-line bg-[#fffbea] px-2.5 py-1"><div className="text-[11px] text-req-ink">받은 파일에 적혀 있던 값</div><Val kind="in">{show(i.raw)}</Val></div>
        {i.code !== 'REQUIRED_EMPTY' && (
          <>
            <span className="text-muted">→</span>
            <div className="rounded-box border border-pri-line bg-[#f4f8fe] px-2.5 py-1"><div className="text-[11px] text-pri-ink">자동으로 고친 값</div>{i.proposal !== undefined ? <Val kind="fix">{show(i.proposal)}</Val> : <span className="text-xs text-sub">자동으로 고칠 수 없어요</span>}</div>
          </>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-3">
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
    </div>
  );
}

function QuestionRow({ q, who, d, set }: { q: Question; who?: string; d: Decisions; set: (p: (x: Decisions) => Decisions) => void }) {
  const ans = d.answers[q.id];
  return (
    <div className={cx('border-t border-line py-2.5', ans && 'opacity-80')}>
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
