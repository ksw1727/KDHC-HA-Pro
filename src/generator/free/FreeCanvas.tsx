import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import type { FormSchema } from '@contract/schema';
import { cellStyle, colLetter, expandRange, parseAddr, addr, BORDER_COLOR, type ModelCell, type SheetModel } from '@contract/layout';
import { freeRegions, freeSize, freeTop, type FreeRegion, type RegionKind } from '@contract/free';
import { applyFreeOp, rectText, type FreeOp, type Rect } from '../state/freeEdit';
import { randomKey } from '../state/newSchema';
import { Button, cx } from '../ui/ui';

/** 영역 색 (목업 generator-free.html) */
export const REGION_COLOR: Record<RegionKind, string> = { fields: '#1f5fbf', list: '#0f8a6a', matrix: '#8a4fd1' };
export const REGION_NAME: Record<RegionKind, string> = { fields: '입력 칸', list: '입력 줄 영역', matrix: '숫자 표' };

/** 판 위 선택: anchor = 처음 누른 칸, focus = 끌어서 닿은 칸 (판 주소) */
export interface FreeSel { anchor: string; focus: string }
export const selRect = (s: FreeSel): Rect => {
  const p = parseAddr(s.anchor);
  const q = parseAddr(s.focus);
  return { r1: Math.min(p.row, q.row), c1: Math.min(p.col, q.col), r2: Math.max(p.row, q.row), c2: Math.max(p.col, q.col) };
};
export const regionSel = (g: FreeRegion): FreeSel => ({ anchor: addr(g.c1, g.r1), focus: addr(g.c2, g.r2) });
const sameRect = (a: Rect, b: Rect) => a.r1 === b.r1 && a.c1 === b.c1 && a.r2 === b.r2 && a.c2 === b.c2;

/** 목록 입력 줄을 판에서 줄여 보여줄 줄 수 */
const SHOWN_ROWS = 4;

interface Props {
  schema: FormSchema;
  model: SheetModel;
  sel: FreeSel | null;
  onSel: (s: FreeSel | null) => void;
  onOp: (op: FreeOp) => void;
  moving: FreeRegion | null;
  onMoving: (g: FreeRegion | null) => void;
  message: string;
  onMessage: (m: string) => void;
}

/**
 * 자유 제작형 그리는 판 (02-generator.md 2.7). 미리보기 자리에서 바로 그린다.
 * 끌어서 칸 고르기 → 위 도구로 입력 칸·입력 줄 영역·숫자 표 지정, 두 번 눌러 글자 쓰기.
 */
export function FreeCanvas({ schema, model, sel, onSel, onOp, moving, onMoving, message, onMessage }: Props) {
  const top = freeTop(schema);
  const size = freeSize(schema);
  const regions = useMemo(() => freeRegions(schema), [schema]);
  const [drag, setDrag] = useState(false);
  const [edit, setEdit] = useState<{ at: string; value: string } | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const up = () => setDrag(false);
    window.addEventListener('mouseup', up);
    return () => window.removeEventListener('mouseup', up);
  }, []);

  const { cells, merges, covered } = useMemo(() => {
    const cells = new Map<string, ModelCell>(model.cells.map((c) => [c.address, c]));
    const merges = new Map<string, { colSpan: number; rowSpan: number }>();
    const covered = new Set<string>();
    for (const m of model.merges) {
      const [a, b = a] = m.split(':');
      const p = parseAddr(a);
      const q = parseAddr(b);
      merges.set(a, { colSpan: q.col - p.col + 1, rowSpan: q.row - p.row + 1 });
      for (const x of expandRange(m)) if (x !== a) covered.add(x);
    }
    return { cells, merges, covered };
  }, [model]);

  // 판 주소 → 영역, 줄여 보일 행
  const regionOf = useMemo(() => {
    const m = new Map<string, FreeRegion>();
    for (const g of regions) for (let r = g.r1; r <= g.r2; r++) for (let c = g.c1; c <= g.c2; c++) m.set(addr(c, r), g);
    return m;
  }, [regions]);
  const rows = useMemo(() => {
    const skip = new Map<number, string>();
    for (const g of regions) {
      if (g.kind !== 'list' || g.r2 - g.r1 <= SHOWN_ROWS + 1) continue;
      for (let r = g.r1 + 1 + SHOWN_ROWS; r <= g.r2; r++) skip.set(r, r === g.r1 + 1 + SHOWN_ROWS ? `… 입력 줄 ${g.r2 - g.r1}줄 (판 ${g.r1 + 1}~${g.r2}행)` : '');
    }
    const out: ({ kind: 'row'; r: number } | { kind: 'gap'; text: string })[] = [];
    for (let r = 1; r < top; r++) out.push({ kind: 'row', r });
    for (let cr = 1; cr <= size.rows; cr++) {
      const t = skip.get(cr);
      if (t === undefined) out.push({ kind: 'row', r: top + cr - 1 });
      else if (t) out.push({ kind: 'gap', text: t });
    }
    return out;
  }, [regions, size.rows, top]);
  const nCols = Math.max(size.cols, model.columns.length);
  const rect = sel ? selRect(sel) : null;
  const selRegion = rect ? regions.find((g) => sameRect(g, rect)) : undefined;

  const tryOp = (op: FreeOp) => {
    const r = applyFreeOp(schema, op);
    if (r.error) { onMessage(r.error); return false; }
    onMessage('');
    onOp(op);
    return true;
  };
  const keys = () => Array.from({ length: 40 }, randomKey);
  const commitEdit = () => {
    if (edit) tryOp({ op: 'text', at: edit.at, value: edit.value });
    setEdit(null);
    boxRef.current?.focus();
  };

  const down = (at: string) => {
    if (moving) {
      if (tryOp({ op: 'move', blockId: moving.blockId, key: moving.key, to: at })) {
        const p = parseAddr(at);
        onSel({ anchor: at, focus: addr(p.col + moving.c2 - moving.c1, p.row + moving.r2 - moving.r1) });
      }
      onMoving(null);
      return;
    }
    if (edit) commitEdit();
    onSel({ anchor: at, focus: at });
    setDrag(true);
  };
  const up = (at: string) => {
    // 끌지 않고 영역 칸을 누르면 그 영역 전체를 고른다
    if (sel && sel.anchor === at && sel.focus === at) {
      const g = regionOf.get(at);
      if (g) onSel(regionSel(g));
    }
  };

  const onKey = (e: KeyboardEvent) => {
    if (edit) return;
    if (e.key === 'Escape') { onSel(null); onMoving(null); return; }
    if (!sel) return;
    const p = parseAddr(sel.focus);
    const moveTo = (dc: number, dr: number) => {
      const n = addr(Math.max(1, Math.min(nCols, p.col + dc)), Math.max(1, Math.min(size.rows, p.row + dr)));
      onSel(e.shiftKey ? { anchor: sel.anchor, focus: n } : { anchor: n, focus: n });
      e.preventDefault();
    };
    if (e.key === 'ArrowRight') return moveTo(1, 0);
    if (e.key === 'ArrowLeft') return moveTo(-1, 0);
    if (e.key === 'ArrowDown') return moveTo(0, 1);
    if (e.key === 'ArrowUp') return moveTo(0, -1);
    if (e.key === 'Delete' || e.key === 'Backspace') { tryOp({ op: 'clear', rect: rect! }); e.preventDefault(); return; }
    if (e.key === 'Enter' || e.key === 'F2') { startEdit(sel.anchor); e.preventDefault(); return; }
    if (e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) { startEdit(sel.anchor, e.key); e.preventDefault(); }
  };
  const startEdit = (at: string, initial?: string) => {
    const g = regionOf.get(at);
    if (g) { onMessage(`'${g.name}' 영역의 이름·서식은 왼쪽 ③에서 고쳐요.`); return; }
    setEdit({ at, value: initial ?? schema.free?.texts[at] ?? '' });
  };

  const edges = (g: FreeRegion, r: number, c: number) => {
    const col = REGION_COLOR[g.kind];
    const sh = [];
    if (r === g.r1) sh.push(`inset 0 2px 0 ${col}`);
    if (r === g.r2) sh.push(`inset 0 -2px 0 ${col}`);
    if (c === g.c1) sh.push(`inset 2px 0 0 ${col}`);
    if (c === g.c2) sh.push(`inset -2px 0 0 ${col}`);
    return sh;
  };

  const tool = (label: string, color: string | null, onClick: () => void, disabled?: boolean, title?: string) => (
    <Button size="sm" onClick={onClick} disabled={disabled} title={title}>
      {color && <i className="inline-block h-2.5 w-2.5 rounded-[2px] border-2" style={{ borderColor: color }} />}{label}
    </Button>
  );

  return (
    <div className="flex min-h-0 flex-col gap-2">
      <div className="flex flex-wrap items-center gap-1.5 rounded-card border border-line bg-white px-2.5 py-1.5" role="toolbar" aria-label="그리기 도구">
        <b className="text-xs text-sub">{rect ? `${rectText(rect)}을(를)` : '칸을 고르면'}</b>
        {tool('입력 칸', REGION_COLOR.fields, () => rect && tryOp({ op: 'mark', kind: 'fields', rect, keys: keys() }), !rect, '고른 칸마다 값 하나를 받아요. 왼쪽 글자 칸이 이름이 돼요')}
        {tool('입력 줄 영역', REGION_COLOR.list, () => rect && tryOp({ op: 'mark', kind: 'list', rect, keys: keys() }), !rect, '맨 윗줄 = 머리글, 아래 줄 수 = 입력 줄 수')}
        {tool('숫자 표', REGION_COLOR.matrix, () => rect && tryOp({ op: 'mark', kind: 'matrix', rect, keys: keys() }), !rect, '맨 윗줄 = 열 제목, 맨 왼쪽 열 = 행 제목, 안쪽 = 숫자 칸')}
        <span className="mx-0.5 h-5 w-px bg-line" />
        {tool('⊞ 칸 합치기', null, () => rect && tryOp({ op: 'merge', rect }), !rect)}
        {tool('합치기 풀기', null, () => rect && tryOp({ op: 'unmerge', rect }), !rect)}
        {tool('⌫ 지정 풀기', null, () => rect && tryOp({ op: 'unmark', rect }), !rect)}
        {tool(moving ? '옮길 자리를 누르세요…' : '↦ 옮기기', null, () => (moving ? onMoving(null) : selRegion && onMoving(selRegion)), !selRegion && !moving, '영역을 고른 뒤 누르고, 옮길 왼쪽 위 칸을 누르세요')}
        <span className="mx-0.5 h-5 w-px bg-line" />
        {tool('+ 행', null, () => tryOp({ op: 'resize', rows: (schema.free?.rows ?? 1) + 1, cols: schema.free?.cols ?? 1 }))}
        {tool('− 행', null, () => tryOp({ op: 'resize', rows: (schema.free?.rows ?? 1) - 1, cols: schema.free?.cols ?? 1 }))}
        {tool('+ 열', null, () => tryOp({ op: 'resize', rows: schema.free?.rows ?? 1, cols: (schema.free?.cols ?? 1) + 1 }))}
        {tool('− 열', null, () => tryOp({ op: 'resize', rows: schema.free?.rows ?? 1, cols: (schema.free?.cols ?? 1) - 1 }))}
      </div>
      <div className={cx('min-h-5 text-xs', message ? 'text-err-ink' : 'text-muted')} role="status">
        {message || (moving ? `'${moving.name}'을(를) 옮길 왼쪽 위 칸을 누르세요. (Esc = 그만두기)` : '끌어서 여러 칸 고르기 · 두 번 누르거나 바로 타자 쳐서 글자 쓰기 · Delete = 글자 지우기 · 영역 칸을 누르면 영역 전체 선택')}
      </div>

      <div ref={boxRef} tabIndex={0} onKeyDown={onKey} className="overflow-auto rounded-card border border-line bg-[#f1f3f6] p-2.5 outline-none focus-visible:ring-3 focus-visible:ring-pri-bg">
        <table role="grid" aria-label="그리는 판" className="select-none border-collapse bg-white text-xs" style={{ tableLayout: 'fixed' }}>
          <colgroup>
            <col style={{ width: 30 }} />
            {Array.from({ length: nCols }, (_, i) => <col key={i} style={{ width: Math.round(Math.max(10, Math.min(30, model.columns[i]?.width ?? 10)) * 7.2) }} />)}
          </colgroup>
          <thead>
            <tr>
              <th className="h-6 border border-line bg-[#f3f5f8]" />
              {Array.from({ length: nCols }, (_, i) => <th key={i} scope="col" className="h-6 border border-line bg-[#f3f5f8] text-[11px] font-normal text-muted">{colLetter(i + 1)}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => row.kind === 'gap' ? (
              <tr key={`g${i}`}><td className="border border-line bg-[#f3f5f8]" /><td colSpan={nCols} className="h-6 border border-line bg-[#fafbfc] text-center text-[11px] text-muted">{row.text}</td></tr>
            ) : (
              <tr key={row.r}>
                <th scope="row" className={cx('h-6 border border-line text-[11px] font-normal', row.r < top ? 'bg-[#eceff3] text-line-strong' : 'bg-[#f3f5f8] text-muted')}>{row.r}</th>
                {Array.from({ length: nCols }, (_, ci) => {
                  const a = addr(ci + 1, row.r);
                  if (covered.has(a)) return null;
                  const span = merges.get(a);
                  const c = cells.get(a);
                  const st = c ? cellStyle(c.role, c.required, c.mark) : null;
                  const inCanvas = row.r >= top;
                  const fa = inCanvas ? addr(ci + 1, row.r - top + 1) : '';
                  const g = inCanvas ? regionOf.get(fa) : undefined;
                  const cr = row.r - top + 1;
                  const picked = !!rect && inCanvas && cr >= rect.r1 && cr <= rect.r2 && ci + 1 >= rect.c1 && ci + 1 <= rect.c2;
                  const shadows = [...(g ? edges(g, cr, ci + 1) : []), ...(picked ? ['inset 0 0 0 1px #1f5fbf'] : [])];
                  const style: CSSProperties = {
                    background: picked ? '#dbe7fb' : g && (c?.role === 'input' || c?.role === 'calc') ? (c.required ? '#fff5d1' : `${REGION_COLOR[g.kind]}12`) : st?.fill,
                    color: st?.color, fontWeight: st?.bold ? 700 : undefined, fontSize: st?.size ? Math.round(st.size * 1.05) : undefined,
                    textAlign: st?.align, border: `1px solid ${c || inCanvas ? BORDER_COLOR : 'transparent'}`,
                    boxShadow: shadows.join(',') || undefined, opacity: inCanvas ? 1 : 0.55,
                    cursor: inCanvas ? (moving ? 'copy' : 'cell') : 'default',
                  };
                  const text = c?.formula ? '자동 합계' : c?.value !== undefined ? (c.role === 'locked-value' ? `🔒 ${c.value}` : String(c.value)) : '';
                  // 이름표: 줄 영역·숫자 표는 늘, 입력 칸은 골랐을 때만 (작은 칸끼리 겹치지 않게)
                  const tag = g && cr === g.r1 && ci + 1 === g.c1 && (g.kind !== 'fields' || picked);
                  return (
                    <td key={a} colSpan={span?.colSpan} rowSpan={span?.rowSpan} style={style} className="relative h-6 p-0"
                      aria-label={inCanvas ? `${fa}${g ? ` ${REGION_NAME[g.kind]} ${g.name}` : ''}` : undefined}
                      aria-selected={picked || undefined}
                      onMouseDown={inCanvas ? (e) => { e.preventDefault(); boxRef.current?.focus(); down(fa); } : undefined}
                      onMouseEnter={inCanvas && drag && sel ? () => onSel({ anchor: sel.anchor, focus: fa }) : undefined}
                      onMouseUp={inCanvas ? () => up(fa) : undefined}
                      onDoubleClick={inCanvas ? () => startEdit(fa) : undefined}>
                      {tag && <span className="pointer-events-none absolute -top-2 left-0.5 z-10 whitespace-nowrap rounded px-1 text-[9.5px] font-bold leading-[14px] text-white" style={{ background: REGION_COLOR[g.kind] }}>{REGION_NAME[g.kind]} · {g.name}</span>}
                      {edit?.at === fa ? (
                        <input autoFocus aria-label={`${fa} 글자`} value={edit.value} className="h-full w-full border-0 bg-white px-1 text-xs outline-2 outline-pri"
                          onChange={(e) => setEdit({ at: fa, value: e.target.value })}
                          onMouseDown={(e) => e.stopPropagation()}
                          onKeyDown={(e) => { if (e.key === 'Enter') commitEdit(); if (e.key === 'Escape') { setEdit(null); boxRef.current?.focus(); } e.stopPropagation(); }}
                          onBlur={commitEdit} />
                      ) : (
                        <div className="overflow-hidden text-ellipsis whitespace-nowrap px-1.5 leading-6" style={{ fontStyle: c?.formula ? 'italic' : undefined, color: c?.formula ? '#9AA3AE' : undefined }}>{text}</div>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap gap-3 text-[11.5px] text-sub">
        {(['fields', 'list', 'matrix'] as RegionKind[]).map((k) => <span key={k}><i className="mr-1 inline-block h-2.5 w-2.5 rounded-[2px] border-2 align-[-1px]" style={{ borderColor: REGION_COLOR[k] }} />{REGION_NAME[k]}</span>)}
        <span><i className="mr-1 inline-block h-2.5 w-2.5 border border-line-strong bg-[#EEF2F7] align-[-1px]" />글자 칸 (작성자가 못 고침)</span>
        <span className="text-muted">흐린 1~{top - 1}행은 제목·안내·제출처 자리(① ⑤에서 정함)</span>
      </div>
    </div>
  );
}
