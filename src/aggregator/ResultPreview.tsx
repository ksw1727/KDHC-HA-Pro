import { useMemo } from 'react';
import type { SheetModel } from '@contract/layout';
import type { Field } from '@contract/schema';
import type { Table } from './pipeline/aggregate';
import { cellStyle } from '@contract/layout/styles';
import { parseAddr } from '@contract/layout/address';

/** 취합 결과 미리보기: 같은 틀 시트(검토용 모양)를 화면 표로. 노란 칸 = 오류로 그대로 둔 값, 파란 칸 = 자동으로 고친 값 (03-aggregator.md 2.2) */
export function ResultPreview({ model, maxRows = 40 }: { model: SheetModel; maxRows?: number }) {
  const { grid, nCols, nRows, more } = useMemo(() => {
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
    const shown = Math.min(nR, maxRows);
    const col = (n: number) => { let s = ''; while (n) { s = String.fromCharCode(65 + ((n - 1) % 26)) + s; n = Math.floor((n - 1) / 26); } return s; };
    const rows = Array.from({ length: shown }, (_, i) => i + 1).map((r) =>
      Array.from({ length: nC }, (_, i) => i + 1).filter((c) => !covered.has(`${r}:${c}`)).map((c) => ({ c, span: span.get(`${r}:${c}`) ?? 1, cell: at.get(`${col(c)}${r}`) })));
    return { grid: rows, nCols: nC, nRows: nR, more: nR - shown };
  }, [model, maxRows]);

  return (
    <div className="overflow-auto rounded-box border border-line" style={{ maxHeight: 420 }}>
      <table className="border-collapse text-xs" aria-label="취합 결과 미리보기">
        <tbody>
          {grid.map((row, r) => (
            <tr key={r}>
              <th className="sticky left-0 border border-line bg-[#f3f5f8] px-1.5 text-[11px] font-normal text-muted">{r + 1}</th>
              {row.map(({ c, span, cell }) => {
                const st = cell ? cellStyle(cell.role, cell.required, cell.mark) : null;
                const v = cell?.value;
                return (
                  <td key={c} colSpan={span} title={cell?.note}
                    className={cx('h-6 max-w-[220px] overflow-hidden text-ellipsis whitespace-nowrap px-1.5', st?.border !== false && 'border border-line')}
                    style={{ background: st?.fill, color: st?.color, fontWeight: st?.bold ? 600 : undefined, textAlign: st?.align ?? (typeof v === 'number' ? 'right' : undefined), textDecoration: st?.strike ? 'line-through' : undefined, fontSize: st?.size && st.size > 12 ? 14 : undefined }}>
                    {cell?.note ? <span className="float-right ml-1 inline-block h-0 w-0 border-l-[5px] border-t-[5px] border-l-transparent border-t-[#d33]" /> : null}
                    {v === undefined || v === null ? '' : typeof v === 'number' ? v.toLocaleString('ko-KR') : String(v)}
                  </td>
                );
              })}
            </tr>
          ))}
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
