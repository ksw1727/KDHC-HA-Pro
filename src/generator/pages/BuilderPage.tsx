import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { LAYOUT_LABELS, aggregationLabel, blockFields, orgLabel, validateSchema } from '@contract/schema';
import { layoutSheet } from '@contract/layout';
import { useBuilder, type PanelId } from '../state/useBuilder';
import { validateForExport, type ExportProblem } from '../state/validateForExport';
import { PreviewGrid } from '../preview/PreviewGrid';
import { sampleAggregate, sampleOrgs } from '../preview/sampleAggregate';
import { exportFormJson } from '../export/exportJson';
import { Panel } from '../builder/Panel';
import { MetaPanel } from '../builder/MetaPanel';
import { LayoutPanel } from '../builder/LayoutPanel';
import { FieldsPanel } from '../builder/FieldsPanel';
import { AggPanel } from '../builder/AggPanel';
import { OrgPanel } from '../builder/OrgPanel';
import { CheckDialog } from '../builder/CheckDialog';
import { ExportFlow } from '../builder/ExportFlow';
import { Button, Chip, Dialog, Seg } from '../ui/ui';
import type { StoredForm } from '../storage/localForms';
import { FreeCanvas, regionSel, type FreeSel } from '../free/FreeCanvas';
import { FreePanel } from '../free/FreePanel';
import { freeAggregationChecks, freeRegions, type AggCheck, type FreeRegion } from '@contract/free';

function useHeaderSlot() {
  const [el, setEl] = useState<HTMLElement | null>(null);
  useEffect(() => setEl(document.getElementById('app-header-slot')), []);
  return el;
}

/** onHome: [← 처음 화면] (구조 고르기 첫 화면으로) */
export function BuilderPage({ start, onHome }: { start?: StoredForm; onHome?: () => void }) {
  const b = useBuilder(start);
  const s = b.schema;
  const slot = useHeaderSlot();
  const [mode, setMode] = useState<'template' | 'aggregate'>('template');
  const [previewOrg, setPreviewOrg] = useState<string | undefined>();
  const [check, setCheck] = useState<ExportProblem[] | null>(null);
  const [exporting, setExporting] = useState(false);
  const [loadErr, setLoadErr] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const label = orgLabel(s);
  const free = s.layout === 'free';
  const [freeSel, setFreeSel] = useState<FreeSel | null>(null);
  const [moving, setMoving] = useState<FreeRegion | null>(null);
  const [freeMsg, setFreeMsg] = useState('');
  /** ④·검사 창의 [고치러 가기]: 그 영역(또는 글자 칸)을 판에서 고른다 */
  const gotoFree = (at?: { blockId?: string; key?: string; cell?: string }) => {
    const g = freeRegions(s).find((x) => x.blockId === at?.blockId && x.key === at?.key);
    if (g) setFreeSel(regionSel(g));
    else if (at?.cell) setFreeSel({ anchor: at.cell, focus: at.cell });
    setMode('template');
    b.setOpenPanel('fields');
  };

  const model = useMemo(() => {
    const today = new Date();
    if (mode === 'aggregate' && s.layout !== 'collect') return layoutSheet(s, { mode: 'aggregate', ...sampleAggregate(s) }, { today });
    const orgName = s.org.mode === 'preset' ? previewOrg && s.org.orgs?.includes(previewOrg) ? previewOrg : s.org.orgs?.[0] ?? `(${label}명)` : undefined;
    return layoutSheet(s, { mode: 'template', orgName }, { today });
  }, [s, mode, previewOrg, label]);

  const freeBad = free ? freeAggregationChecks(s).filter((c) => c.status !== 'ok' && s.aggregations.includes(c.id)).length : 0;
  const bad = (w: PanelId) => b.problems.filter((p) => p.where === w).length || (w === 'aggregations' ? freeBad : 0);
  const toggle = (id: PanelId) => b.setOpenPanel(b.openPanel === id ? null : id);
  const exported = b.lastExported?.formVersion;
  const versionUp = exported != null && b.version > exported;

  const onExport = () => {
    const problems = validateForExport(s);
    b.setProblems(problems);
    if (problems.length) setCheck(problems);
    else setExporting(true);
  };
  const onFix = (p: ExportProblem) => {
    setCheck(null);
    if (free && (p.blockId || p.key)) { gotoFree(p); return; }
    b.setOpenPanel(p.where);
    if (p.key && p.blockId) b.setSelected({ blockId: p.blockId, key: p.key });
  };

  const header = (
    <>
      {onHome && <Button variant="ghost" onClick={() => { b.flush(); onHome(); }}>← 처음 화면</Button>}
      <span className="truncate text-sub">{s.title || '새 양식'}</span>
      <Chip>{LAYOUT_LABELS[s.layout]}</Chip>
      <Chip tone={b.saved === false ? 'warn' : 'gray'}>v{b.version} · {b.saved === false ? '이 브라우저에 자동 저장되지 않아요' : '자동 저장됨'}</Chip>
      <span className="flex-1" />
      <Button variant="ghost" onClick={() => fileRef.current?.click()}>양식 파일 열기</Button>
      <Button onClick={() => exportFormJson(s)}>양식 파일 저장</Button>
      <Button variant="pri" onClick={onExport}>엑셀 내보내기{s.org.mode === 'preset' && s.org.orgs?.length ? ` (${s.org.orgs.length}개 · zip)` : ''}</Button>
      <input ref={fileRef} type="file" accept=".json,application/json" className="hidden"
        onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (!f) return;
          try {
            const r = validateSchema(JSON.parse(await f.text()));
            if (!r.ok) throw new Error(r.errors.join('\n'));
            b.act({ type: 'schema/load', schema: r.schema });
            b.setSelected(null);
          } catch {
            setLoadErr('이 파일은 양식 파일이 아니에요.');
          }
        }} />
    </>
  );

  return (
    <div className="grid h-full min-h-0 grid-cols-[400px_1fr]">
      {slot && createPortal(header, slot)}
      <aside className="flex min-h-0 flex-col gap-2.5 overflow-auto border-r border-line bg-panel p-3.5" aria-label="양식 설정">
        <Panel n={1} title="기본 정보" open={b.openPanel === 'meta'} onToggle={() => toggle('meta')} bad={bad('meta')}
          summary={[s.title || '제목 없음', s.deadline && `기한 ${s.deadline.slice(5).replace('-', '/')}`].filter(Boolean).join(' · ')}>
          <MetaPanel b={b} />
        </Panel>
        <Panel n={2} title="양식 구조" open={b.openPanel === 'layout'} onToggle={() => toggle('layout')} summary={LAYOUT_LABELS[s.layout]}>
          <LayoutPanel b={b} />
        </Panel>
        <Panel n={3} title={s.layout === 'collect' ? '시트 시작 모양' : free ? '고른 영역' : '항목·서식'} open={b.openPanel === 'fields'} onToggle={() => toggle('fields')} bad={bad('fields')}
          summary={free ? `영역 ${freeRegions(s).length}개` : s.layout === 'collect' ? (s.collect?.scope === 'all' ? '모든 시트 모음' : '보고서 시트만') : s.layout === 'fill-in' ? `입력칸 ${s.blocks.reduce((n, x) => n + blockFields(x).length, 0)}개` : s.layout === 'matrix' ? '표 1개' : `${s.blocks.reduce((n, x) => n + blockFields(x).length, 0)}개`}>
          {free ? <FreePanel b={b} sel={freeSel} onSel={setFreeSel} onMove={(g) => { setMoving(g); setFreeMsg(''); }} /> : <FieldsPanel b={b} />}
        </Panel>
        <Panel n={4} title="취합 방식" open={b.openPanel === 'aggregations'} onToggle={() => toggle('aggregations')} bad={bad('aggregations')}
          summary={s.aggregations.map((a) => aggregationLabel(s, a)).join(' · ')}>
          <AggPanel b={b} onGoto={(c: AggCheck) => gotoFree(c.at)} />
        </Panel>
        <Panel n={5} title="제출처" open={b.openPanel === 'org'} onToggle={() => toggle('org')} bad={bad('org')}
          summary={s.org.mode === 'none' ? '식별 안 함' : s.org.mode === 'input' ? `${label}명 입력` : `목록 있음 · ${s.org.orgs?.length ?? 0}곳`}>
          <OrgPanel b={b} />
        </Panel>
      </aside>

      <section className="flex min-h-0 flex-col gap-2.5 overflow-auto p-4" aria-label="미리보기">
        <div className="flex flex-wrap items-center gap-2.5">
          <b>미리보기</b>
          <Seg label="미리보기 모양" value={mode} options={[['template', '빈 양식'], ['aggregate', '취합본']]} onChange={setMode} />
          {mode === 'template' ? <span className="text-xs text-muted">{free ? '여기서 바로 그려요' : '머리글을 누르면 왼쪽에서 서식을 고칠 수 있어요'}</span> : <span className="text-xs text-muted">가짜 데이터 3곳으로 그린 취합본 모양</span>}
          <span className="flex-1" />
          {mode === 'template' && s.org.mode === 'preset' && (s.org.orgs?.length ?? 0) > 0 && (
            <label className="flex items-center gap-1.5 text-sub">{label}
              <select value={previewOrg ?? s.org.orgs![0]} onChange={(e) => setPreviewOrg(e.target.value)} className="h-8 rounded-btn border border-line-strong bg-white px-2 text-[13px]">
                {s.org.orgs!.map((o) => <option key={o}>{o}</option>)}
              </select>
            </label>
          )}
        </div>

        {free && mode === 'template' ? (
          <FreeCanvas schema={s} model={model} sel={freeSel} onSel={(x) => { setFreeSel(x); if (x) b.setOpenPanel('fields'); }}
            onOp={(op) => b.act({ type: 'free/op', op })} moving={moving} onMoving={setMoving} message={freeMsg} onMessage={setFreeMsg} />
        ) : mode === 'aggregate' && s.layout === 'collect' ? (
          <CollectAggregatePreview orgs={sampleOrgs(s)} label={label} title={s.title} />
        ) : (
          <PreviewGrid model={model} schema={s} selectedKey={b.selected?.key} onSelect={b.selectKey} showSampleForSelected={mode === 'template'} />
        )}

        <div className="flex flex-wrap gap-3 text-[11.5px] text-sub">
          <span><i className="mr-1 inline-block h-2.5 w-2.5 border border-line-strong bg-req align-[-1px]" />필수 입력칸</span>
          <span>🔒 잠긴 칸</span>
          <span><i className="mr-1 inline-block h-2.5 w-2.5 border border-line-strong bg-auto align-[-1px]" />취합 때 자동으로 붙는 칸</span>
          <span><i className="mr-1 inline-block h-2.5 w-2.5 align-[-1px] shadow-[inset_0_0_0_2px_#1f5fbf]" />선택한 항목</span>
        </div>
        {s.layout === 'collect' && mode === 'template' && (
          <div className="rounded-box border border-dashed border-pri-line bg-pri-bg px-3 py-2 text-center text-pri-ink">↑ 4행부터 아래는 {label}에서 자유롭게 작성해요 (칸·줄·셀 합치기·시트 추가 모두 가능)</div>
        )}
        {versionUp && <div className="rounded-btn bg-warn px-2.5 py-1.5 text-xs text-warn-ink">칸 구조를 바꿨어요. 내보내면 버전 {b.version}이 됩니다.</div>}
      </section>

      {check && <CheckDialog problems={check} onFix={onFix} onClose={() => setCheck(null)} />}
      {exporting && <ExportFlow schema={s} lastExported={b.lastExported} onClose={() => setExporting(false)} onExported={b.markExported} />}
      {loadErr && <Dialog tone="err" title={loadErr} onClose={() => setLoadErr('')} footer={<><span className="flex-1" /><Button variant="pri" onClick={() => setLoadErr('')}>확인</Button></>}><p className="m-0">한난MOA에서 저장한 .form.json 파일을 골라 주세요.</p></Dialog>}
    </div>
  );
}

function CollectAggregatePreview({ orgs, label, title }: { orgs: string[]; label: string; title: string }) {
  return (
    <div className="rounded-card border border-line bg-[#f1f3f6] p-3">
      <div className="rounded-box border border-line bg-white p-3">
        <b>{title || '양식'} · 취합 목차</b>
        <table className="mt-2 w-full border-collapse text-xs">
          <thead><tr>{[label, '상태', '원본 파일', '바로가기'].map((h) => <th key={h} className="border border-[#d9dfe7] bg-[#eef2f7] px-2 py-1 text-left">{h}</th>)}</tr></thead>
          <tbody>{orgs.map((o) => <tr key={o}><td className="border border-[#d9dfe7] px-2 py-1">{o}</td><td className="border border-[#d9dfe7] px-2 py-1">제출</td><td className="border border-[#d9dfe7] px-2 py-1">…_{o}.xlsx</td><td className="border border-[#d9dfe7] px-2 py-1 text-pri underline">{o} 시트 →</td></tr>)}</tbody>
        </table>
      </div>
      <div className="mt-1 flex gap-0.5 text-[11.5px]">
        <span className="rounded-b border border-t-0 border-[#d9dfe7] bg-pri-bg px-2.5 font-bold text-pri-ink">목차</span>
        {orgs.map((o) => <span key={o} className="rounded-b border border-t-0 border-[#d9dfe7] bg-[#f6f7f9] px-2.5 text-sub">{o}</span>)}
        <span className="rounded-b border border-t-0 border-[#d9dfe7] bg-err px-2.5 text-err-ink">오류 목록</span>
      </div>
      <p className="mb-0 mt-2 text-xs text-muted">시트 모으기형은 같은 틀 시트 대신 목차와 {label}별 시트로 모여요. 각 시트는 작성한 모양 그대로예요.</p>
    </div>
  );
}
