import { useMemo, type CSSProperties } from 'react';
import type { Field, FormSchema } from '@contract/schema';
import { blockFields } from '@contract/schema';
import { cellStyle, colLetter, expandRange, parseAddr, BORDER_COLOR, type ModelCell, type SheetModel } from '@contract/layout';
import { formatNumber, formatSample } from './formatSample';

/** 목록·여유 줄을 미리보기에서 줄여 보여줄 줄 수 */
const SHOWN_ROWS = 5;

interface Props {
  model: SheetModel;
  schema: FormSchema;
  selectedKey?: string | null;
  onSelect?: (key: string) => void;
  /** 빈 양식이면 선택한 항목의 첫 입력칸에 예시 값을 흐리게 보여준다 */
  showSampleForSelected?: boolean;
}

type Row = { kind: 'row'; r: number } | { kind: 'gap'; text: string };

/**
 * SheetModel을 엑셀처럼 생긴 표로 그린다 (02-generator.md 3절).
 * 색·굵기는 contract/layout/styles.ts의 role 표에서만 가져온다.
 */
export function PreviewGrid({ model, schema, selectedKey, onSelect, showSampleForSelected }: Props) {
  const fieldsByKey = useMemo(() => {
    const m = new Map<string, Field>();
    for (const b of schema.blocks) for (const f of blockFields(b)) m.set(f.key, f);
    return m;
  }, [schema]);

  const { cells, merges, covered, rows, nCols } = useMemo(() => {
    const cells = new Map<string, ModelCell>(model.cells.map((c) => [c.address, c]));
    const merges = new Map<string, { colSpan: number; rowSpan: number }>();
    const covered = new Set<string>();
    for (const m of model.merges) {
      const [a, b] = m.split(':');
      const p = parseAddr(a);
      const q = parseAddr(b);
      merges.set(a, { colSpan: q.col - p.col + 1, rowSpan: q.row - p.row + 1 });
      for (const x of expandRange(m)) if (x !== a) covered.add(x);
    }
    const maxRow = Math.max(2, ...model.cells.map((c) => parseAddr(c.address).row));
    // 목록 입력 줄·여유 줄은 처음 몇 줄만
    const hidden = new Map<number, string>(); // 숨길 첫 행 → 안내 문구
    const skip = new Set<number>();
    for (const b of Object.values(model.cellMap.blocks)) {
      let from = 0;
      let to = 0;
      if (b.kind === 'list') { from = b.firstDataRow; to = b.lastDataRow; }
      if (b.kind === 'grid' && b.spare) { from = b.spare.firstRow; to = b.spare.lastRow; }
      const total = to - from + 1;
      if (from && total > SHOWN_ROWS + 1) {
        hidden.set(from + SHOWN_ROWS, `… (총 ${total.toLocaleString('ko-KR')}줄)`);
        for (let r = from + SHOWN_ROWS; r <= to; r++) skip.add(r);
      }
    }
    const rows: Row[] = [];
    for (let r = 1; r <= maxRow; r++) {
      if (hidden.has(r)) rows.push({ kind: 'gap', text: hidden.get(r)! });
      if (!skip.has(r)) rows.push({ kind: 'row', r });
    }
    return { cells, merges, covered, rows, nCols: model.columns.length };
  }, [model]);

  const firstInputRowOf = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of model.cells) {
      if (c.role === 'input' && c.fieldKey && !m.has(c.fieldKey)) m.set(c.fieldKey, parseAddr(c.address).row);
    }
    return m;
  }, [model]);

  const display = (c: ModelCell): { text: string; sample?: boolean } => {
    if (c.formula && c.role === 'calc') return { text: `= ${c.note?.replace(/^계산: /, '') ?? '계산'}`, sample: true };
    if (c.formula) return { text: '자동 합계', sample: true };
    const f = c.fieldKey ? fieldsByKey.get(c.fieldKey) : undefined;
    if (c.value !== undefined) {
      if (typeof c.value === 'number' && (f?.type === 'number' || f?.type === 'calc') && c.role !== 'header' && c.role !== 'label') return { text: formatNumber(c.value, f) };
      return { text: typeof c.value === 'number' ? c.value.toLocaleString('ko-KR') : c.value };
    }
    if (showSampleForSelected && f && c.fieldKey === selectedKey && c.role === 'input' && firstInputRowOf.get(f.key) === parseAddr(c.address).row)
      return { text: formatSample(f), sample: true };
    return { text: '' };
  };

  const colWidths = model.columns.map((c) => Math.round(Math.max(6, Math.min(40, c.width)) * 7.2));

  return (
    <div className="overflow-auto rounded-card border border-line bg-[#f1f3f6] p-2.5">
      <table role="grid" aria-label="엑셀 미리보기" className="border-collapse bg-white text-xs" style={{ tableLayout: 'fixed' }}>
        <colgroup>
          <col style={{ width: 30 }} />
          {colWidths.map((w, i) => <col key={i} style={{ width: w }} />)}
        </colgroup>
        <thead>
          <tr>
            <th className="h-6 border border-line bg-[#f3f5f8]" />
            {Array.from({ length: nCols }, (_, i) => (
              <th key={i} scope="col" className="h-6 border border-line bg-[#f3f5f8] text-[11px] font-normal text-muted">{colLetter(i + 1)}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) =>
            row.kind === 'gap' ? (
              <tr key={`g${i}`}>
                <td className="border border-line bg-[#f3f5f8]" />
                <td colSpan={nCols} className="h-6 border border-line bg-[#fafbfc] text-center text-[11px] text-muted">{row.text}</td>
              </tr>
            ) : (
              <tr key={row.r}>
                <th scope="row" className="h-6 border border-line bg-[#f3f5f8] text-[11px] font-normal text-muted">{row.r}</th>
                {Array.from({ length: nCols }, (_, ci) => {
                  const a = `${colLetter(ci + 1)}${row.r}`;
                  if (covered.has(a)) return null;
                  const span = merges.get(a);
                  const c = cells.get(a);
                  if (!c) return <td key={a} colSpan={span?.colSpan} rowSpan={span?.rowSpan} className="h-6" style={{ border: `1px solid ${BORDER_COLOR}` }} />;
                  const st = cellStyle(c.role, c.required, c.mark);
                  const { text, sample } = display(c);
                  const clickable = !!(onSelect && c.fieldKey && (c.role === 'header' || c.role === 'label'));
                  const selected = !!selectedKey && c.fieldKey === selectedKey;
                  const style: CSSProperties = {
                    background: st.fill,
                    color: sample ? '#9AA3AE' : st.color,
                    fontWeight: st.bold ? 700 : undefined,
                    fontStyle: st.italic || sample ? 'italic' : undefined,
                    fontSize: st.size ? Math.round(st.size * 1.05) : undefined,
                    textAlign: st.align ?? (typeof c.value === 'number' ? 'right' : undefined),
                    textDecoration: st.strike ? 'line-through' : undefined,
                    border: st.border ? `1px solid ${BORDER_COLOR}` : '1px solid transparent',
                    boxShadow: selected ? 'inset 0 0 0 2px #1f5fbf' : undefined,
                    whiteSpace: c.wrap ? 'normal' : 'nowrap',
                  };
                  return (
                    <td
                      key={a}
                      colSpan={span?.colSpan}
                      rowSpan={span?.rowSpan}
                      title={c.note}
                      style={style}
                      className={'h-6 overflow-hidden text-ellipsis px-1.5 ' + (clickable ? 'cursor-pointer hover:outline-2 hover:-outline-offset-2 hover:outline-dashed hover:outline-pri' : '')}
                      onClick={clickable ? () => onSelect!(c.fieldKey!) : undefined}
                      onKeyDown={clickable ? (e) => (e.key === 'Enter' || e.key === ' ') && onSelect!(c.fieldKey!) : undefined}
                      tabIndex={clickable ? 0 : undefined}
                      aria-selected={selected || undefined}
                    >
                      {c.role === 'locked-value' && text ? `🔒 ${text}` : text}
                      {c.note && c.role !== 'calc' && <span className="ml-1 text-[10px] text-pri" aria-hidden>●</span>}
                    </td>
                  );
                })}
              </tr>
            ),
          )}
        </tbody>
      </table>
    </div>
  );
}
