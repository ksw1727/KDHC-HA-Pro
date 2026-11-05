import { useLayoutEffect, useMemo, useRef } from 'react';
import type { SheetModel } from '@contract/layout';
import type { Field } from '@contract/schema';
import type { Table } from './pipeline/aggregate';
import { cellStyle } from '@contract/layout/styles';
import { parseAddr } from '@contract/layout/address';

/** 미리보기에서 줄 모으기: rows = 자료 줄 중 위로 모을 시트 행, only = 나머지 자료 줄은 숨김(아니면 흐리게) */
interface PreviewFocus { rows: number[]; only?: boolean }

/**
 * 취합 결과 미리보기: 같은 틀 시트(검토용 모양)를 화면 표로. 노란 칸 = 오류로 그대로 둔 값, 파란 칸 = 자동으로 고친 값 (03-aggregator.md 2.2)
 * region = 자료 줄 범위(시트 행 번호). focus가 있으면 그 줄을 자료 줄 맨 위로 모으고(움직이는 모습으로), 나머지는 흐리게 또는 숨긴다.
 * flash = 잠깐 테두리로 짚어 줄 시트 행 (n이 바뀔 때마다 다시). onRow = 자료 줄을 눌렀을 때.
 */
export function ResultPreview({ model, maxRows = 40, region, focus, flash, onRow, maxHeight = 420 }: {
  model: SheetModel; maxRows?: number; region?: { from: number; to: number } | null; focus?: PreviewFocus | null; flash?: { row: number; n: number } | null; onRow?: (row: number) => void; maxHeight?: number;
}) {
  const { cellsOf, nCols, nRows, widths } = useMemo(() => {
    const at = new Map(model.cells.map((c) => [c.address, c]));
    let nR = 0, nC = 0;
    for (const c of model.cells) { const p = parseAddr(c.address); nR = Math.max(nR, p.row); nC = Math.max(nC, p.col); }
    const covered = new Set<string>();
    const span = new Map<string, number>();
    for (const m of model.merges) {
      const [a, b] = m.split(':').map(parseAddr);
      if (a.row !== b.row) continue;   // 미리보기는 가로 병합만 (제목·안내 줄)
      span.set(`${a.row}:${a.col}`, b.col - a.col + 1);
      for (let c = a.col + 1; c <= b.col; c++) covered.add(`${a.row}:${c}`);
    }
    const col = (n: number) => { let s = ''; while (n) { s = String.fromCharCode(65 + ((n - 1) % 26)) + s; n = Math.floor((n - 1) / 26); } return s; };
    const cellsOf = (r: number) => Array.from({ length: nC }, (_, i) => i + 1).filter((c) => !covered.has(`${r}:${c}`)).map((c) => ({ c, span: span.get(`${r}:${c}`) ?? 1, cell: at.get(`${col(c)}${r}`) }));
    // 열 너비: 줄을 모으거나 숨겨도 흔들리지 않게 전체 칸 내용으로 미리 정한다 (병합된 제목 줄은 빼고)
    const widths = Array.from({ length: nC }, (_, i) => Math.max(36, (model.columns[i]?.width ?? 6) * 6));
    for (const c of model.cells) {
      const p = parseAddr(c.address);
      if (span.has(`${p.row}:${p.col}`) || c.value === null || c.value === undefined) continue;
      const t = typeof c.value === 'number' ? c.value.toLocaleString('ko-KR') : String(c.value);
      const w = [...t].reduce((n, ch) => n + (/[\u3131-\uD79D]/.test(ch) ? 11.5 : 7), 0) + 22;
      widths[p.col - 1] = Math.max(widths[p.col - 1], w);
    }
    return { cellsOf, nCols: nC, nRows: nR, widths: widths.map((w) => Math.round(Math.min(200, w))) };
  }, [model]);

  // 보여 줄 줄 순서: 자료 줄 앞 → 모은 줄 → (구분선) → 나머지 자료 줄 → 자료 줄 뒤
  const { order, hit, sepAfter } = useMemo(() => {
    const all = Array.from({ length: nRows }, (_, i) => i + 1);
    if (!focus || !region) return { order: all, hit: new Set<number>(), sepAfter: 0 };
    const { from, to } = region;
    const hit = new Set(focus.rows.filter((r) => r >= from && r <= to));
    const data = all.filter((r) => r >= from && r <= to);
    const top = data.filter((r) => hit.has(r));
    const rest = focus.only ? [] : data.filter((r) => !hit.has(r));
    const order = [...all.filter((r) => r < from), ...top, ...rest, ...all.filter((r) => r > to)];
    return { order, hit, sepAfter: top.length && rest.length ? top[top.length - 1] : 0 };
  }, [nRows, focus, region]);
  const shown = order.slice(0, maxRows);
  const more = nRows - shown.length - (focus?.only && region ? region.to - region.from + 1 - hit.size : 0);

  // 줄이 자리를 옮길 때 미끄러지듯 (FLIP)
  const rowEls = useRef(new Map<number, HTMLTableRowElement>());
  const tops = useRef(new Map<number, number>());
  const key = shown.join(',');
  useLayoutEffect(() => {
    const reduce = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const next = new Map<number, number>();
    for (const [r, el] of rowEls.current) {
      if (!el.isConnected) { rowEls.current.delete(r); continue; }
      next.set(r, el.offsetTop);
      const before = tops.current.get(r);
      if (reduce || before === undefined || before === el.offsetTop) continue;
      el.style.transition = 'none';
      el.style.transform = `translateY(${before - el.offsetTop}px)`;
      requestAnimationFrame(() => requestAnimationFrame(() => { el.style.transition = 'transform .42s cubic-bezier(.2,.8,.2,1)'; el.style.transform = ''; }));
    }
    tops.current = next;
  }, [key]);

  // 짚어 줄 줄: 보이게 스크롤하고 잠깐 테두리
  useLayoutEffect(() => {
    if (!flash) return;
    const el = rowEls.current.get(flash.row);
    if (!el) return;
    el.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
    for (const td of Array.from(el.cells)) td.animate?.([{ boxShadow: 'inset 0 0 0 2px #e0605a' }, { boxShadow: 'inset 0 0 0 2px #e0605a', offset: 0.5 }, { boxShadow: 'inset 0 0 0 0 transparent' }], { duration: 1300, easing: 'ease-out' });
  }, [flash]);

  const inData = (r: number) => !!region && r >= region.from && r <= region.to;
  return (
    <div className="overflow-auto rounded-box border border-line" style={{ maxHeight }}>
      <table className="border-collapse text-xs" aria-label="취합 결과 미리보기" style={{ tableLayout: 'fixed', width: 40 + widths.reduce((a, b) => a + b, 0) }}>
        {/* 줄을 모으거나 숨겨도 열 너비가 흔들리지 않게 전체 내용으로 정한 너비를 쓴다 */}
        <colgroup><col style={{ width: 40 }} />{Array.from({ length: nCols }, (_, i) => <col key={i} style={{ width: widths[i] }} />)}</colgroup>
        <tbody>
          {shown.flatMap((r) => {
            const on = hit.has(r);
            const dim = !!focus && inData(r) && !on;
            const clickable = !!onRow && inData(r);
            const tr = (
              <tr key={r} ref={(el) => { if (el) rowEls.current.set(r, el); }} data-row={r}
                className={cx(dim && 'opacity-35', clickable && 'cursor-pointer hover:bg-panel')}
                style={{ transition: 'opacity .25s' }}
                onClick={clickable ? () => onRow!(r) : undefined}>
                <th className={cx('sticky left-0 border border-line px-1.5 text-[11px] font-normal', on ? 'bg-ink font-bold text-white' : 'bg-[#f3f5f8] text-muted')}>{r}</th>
                {cellsOf(r).map(({ c, span, cell }) => {
                  const st = cell ? cellStyle(cell.role, cell.required, cell.mark) : null;
                  const v = cell?.value;
                  return (
                    <td key={c} colSpan={span} title={cell?.note}
                      className={cx('h-6 overflow-hidden text-ellipsis whitespace-nowrap px-1.5', st?.border !== false && 'border border-line')}
                      style={{ background: st?.fill, color: st?.color, fontWeight: st?.bold ? 600 : undefined, textAlign: st?.align ?? (typeof v === 'number' ? 'right' : undefined), textDecoration: st?.strike ? 'line-through' : undefined, fontSize: st?.size && st.size > 12 ? 14 : undefined }}>
                      {cell?.note ? <span className="float-right ml-1 inline-block h-0 w-0 border-l-[5px] border-t-[5px] border-l-transparent border-t-[#d33]" /> : null}
                      {v === undefined || v === null ? '' : typeof v === 'number' ? v.toLocaleString('ko-KR') : String(v)}
                    </td>
                  );
                })}
              </tr>
            );
            return r === sepAfter
              ? [tr, <tr key="sep" aria-hidden><td colSpan={nCols + 1} className="h-1.5 p-0" style={{ background: 'repeating-linear-gradient(90deg,#cfd7cc 0 6px,transparent 6px 12px)' }} /></tr>]
              : [tr];
          })}
        </tbody>
      </table>
      {more > 0 && <p className="m-0 px-2 py-1 text-xs text-muted">… {more}줄 더 (전체 {nRows}행 · {nCols}열)</p>}
    </div>
  );
}

/** 결과 파일의 표 시트(지사별 펼치기 등)를 화면 표로. 마지막 줄이 '합계'면 굵게 */
export function TablePreview({ table }: { table: Table }) {
  return (
    <div className="overflow-auto rounded-box border border-line" style={{ maxHeight: 420 }}>
      <table className="border-collapse text-xs" aria-label={`${table.name} 미리보기`}>
        <thead className="sticky top-0">
          <tr>{table.columns.map((c, i) => <th key={i} className="whitespace-nowrap border border-line bg-[#eef2f7] px-1.5 py-1 font-semibold">{c.header}</th>)}</tr>
        </thead>
        <tbody>
          {table.rows.map((r, ri) => (
            <tr key={ri} className={cx(r[0] === '합계' && 'bg-panel font-semibold')}>
              {r.map((v, i) => (
                <td key={i} className="h-6 max-w-[220px] overflow-hidden text-ellipsis whitespace-nowrap border border-line px-1.5" style={{ textAlign: typeof v === 'number' ? 'right' : undefined }}>
                  {v === null || v === undefined ? '' : typeof v === 'number' ? num(v, table.columns[i]?.field) : String(v)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** 양식 서식대로 숫자 보여 주기 (쉼표·소수 자리·단위) */
function num(v: number, f?: Field): string {
  if (!f || (f.type !== 'number' && f.type !== 'calc')) return v.toLocaleString('ko-KR', { maximumFractionDigits: 4 });
  const d = Math.max(0, Math.min(4, f.decimals ?? 0));
  const s = v.toLocaleString('ko-KR', { minimumFractionDigits: d, maximumFractionDigits: d, useGrouping: f.thousands !== false });
  return f.unit?.trim() ? `${s}${f.unit.trim()}` : s;
}

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');
