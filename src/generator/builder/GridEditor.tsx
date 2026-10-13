import { useState } from 'react';
import type { FieldType, GridBlock } from '@contract/schema';
import { FIELD_TYPES, FIELD_TYPE_ORDER } from '@contract/fieldTypes';
import type { Builder } from '../state/useBuilder';
import { randomKey } from '../state/newSchema';
import { Button, NumberInput, TextArea, TextInput, Toggle, cx } from '../ui/ui';
import { FieldEditor } from './FieldEditor';
import { parsePastedTable } from './parsePastedTable';
import { addCol, addRow, fromPaste, norm, removeCol, removeRow, setBlank, setFixed, setInputs, setValue, syncSpare, type GridData, type Range } from './gridOps';

/** 빈칸채우기형 표 편집기 (02-generator.md 2.4) */
export function GridEditor({ b, block }: { b: Builder; block: GridBlock }) {
  const [sel, setSel] = useState<Range | null>(null);
  const [paste, setPaste] = useState(false);
  const g: GridData = { colLabels: block.colLabels, rows: block.rows, spareRows: block.spareRows, spareColumns: block.spareColumns };
  const put = (next: GridData) => b.act({ type: 'grid/replace', blockId: block.id, grid: next });
  const rg = sel ? norm(sel) : null;
  const single = rg && rg.r1 === rg.r2 && rg.c1 === rg.c2 ? g.rows[rg.r1]?.[rg.c1] : null;
  const isSel = (r: number, c: number) => !!rg && r >= rg.r1 && r <= rg.r2 && c >= rg.c1 && c <= rg.c2;

  const click = (r: number, c: number, shift: boolean) => {
    setSel(shift && sel ? { ...sel, r2: r, c2: c } : { r1: r, c1: c, r2: r, c2: c });
    const cell = g.rows[r][c];
    if (cell.kind === 'input' && !shift) b.setSelected({ blockId: block.id, key: cell.field.key });
    else b.setSelected(null);
  };

  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex flex-wrap gap-1.5">
        <Button size="sm" variant={rg ? 'pri' : 'default'} disabled={!rg} onClick={() => {
          if (!rg) return;
          const next = setInputs(g, rg, randomKey);
          put(next);
          const cell = next.rows[rg.r1][rg.c1];
          if (cell.kind === 'input') b.setSelected({ blockId: block.id, key: cell.field.key });
        }}>입력칸으로</Button>
        <Button size="sm" disabled={!rg} onClick={() => rg && put(setFixed(g, rg))}>고정 칸으로</Button>
        <Button size="sm" disabled={!rg} onClick={() => rg && put(setBlank(g, rg))}>빈칸으로</Button>
        <span className="flex-1" />
        <Button size="sm" onClick={() => put(addRow(g))}>+ 행</Button>
        <Button size="sm" onClick={() => put(addCol(g, randomKey))}>+ 열</Button>
        <Button size="sm" variant="danger" disabled={!rg || g.rows.length <= 1} onClick={() => { if (rg) { put(removeRow(g, rg.r1)); setSel(null); } }}>행 삭제</Button>
        <Button size="sm" variant="danger" disabled={!rg || g.colLabels.length <= 1} onClick={() => { if (rg) { put(removeCol(g, rg.c1, randomKey)); setSel(null); } }}>열 삭제</Button>
      </div>

      <div className="overflow-auto rounded-card border border-line">
        <table className="border-collapse text-xs" aria-label="빈칸채우기 표">
          <thead>
            <tr>
              {g.colLabels.map((label, c) => (
                <th key={c} className="border border-line bg-[#eef2f7] p-0">
                  <input aria-label={`${c + 1}열 머리글`} value={label} placeholder={`${c + 1}열`}
                    onChange={(e) => put(syncSpare({ ...g, colLabels: g.colLabels.map((x, i) => (i === c ? e.target.value : x)) }, randomKey))}
                    className="w-24 bg-transparent px-1.5 py-1 text-center font-semibold outline-none focus:bg-white" />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {g.rows.map((row, r) => (
              <tr key={r}>
                {row.map((cell, c) => (
                  <td key={c} onClick={(e) => click(r, c, e.shiftKey)}
                    className={cx('h-7 min-w-24 cursor-pointer border border-line px-1.5', cell.kind === 'input' && (cell.field.required ? 'bg-req' : 'bg-white'), cell.kind === 'blank' && 'bg-[#fafbfc]', isSel(r, c) && 'shadow-[inset_0_0_0_2px_#1f5fbf]')}>
                    {cell.kind === 'fixed' && String(cell.value)}
                    {cell.kind === 'input' && <span className="text-pri-ink">[{cell.field.label}]</span>}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="m-0 text-xs text-muted">칸을 누르면 고르고, Shift를 누른 채 누르면 범위를 골라요. 고정 칸은 아래에서 글자를 바꿀 수 있어요.</p>

      {single && rg && single.kind !== 'input' && (
        <div className="flex items-center gap-2">
          <span className="text-sub">{rg.r1 + 1}행 {rg.c1 + 1}열 내용</span>
          <TextInput className="flex-1" key={`${rg.r1}-${rg.c1}`} defaultValue={single.kind === 'fixed' ? String(single.value) : ''} placeholder="비우면 빈칸"
            onBlur={(e) => put(setValue(g, rg.r1, rg.c1, e.target.value))} />
        </div>
      )}
      {single?.kind === 'input' && b.selected?.key === single.field.key && (
        <div>
          <div className="rounded-t-card border border-line bg-panel px-2.5 py-1 text-[11.5px] font-semibold text-muted">입력칸 설정</div>
          <FieldEditor f={single.field} onPatch={(p) => b.act({ type: 'field/update', blockId: block.id, key: single.field.key, patch: p })} />
        </div>
      )}

      {paste ? (
        <div className="flex flex-col gap-1.5">
          <TextArea autoFocus className="min-h-24 font-mono text-xs" placeholder={'엑셀에서 표를 복사해 붙여넣으세요. 첫 줄은 머리글이 돼요.\n사업\t예산\t서울'}
            onPaste={(e) => { const t = e.clipboardData.getData('text'); e.preventDefault(); put(fromPaste(parsePastedTable(t))); setPaste(false); setSel(null); }} />
          <Button size="sm" variant="ghost" onClick={() => setPaste(false)}>취소</Button>
        </div>
      ) : (
        <Button size="sm" onClick={() => setPaste(true)}>엑셀에서 복사한 표 붙여넣기 (지금 표를 바꿔요)</Button>
      )}

      <div className="flex flex-col gap-2 rounded-card border border-line bg-panel p-2.5">
        <div className="flex items-center gap-2">
          <span className="text-sub">여유 줄</span>
          <NumberInput className="w-16" aria-label="여유 줄 수" value={g.spareRows} onValue={(v) => put(syncSpare({ ...g, spareRows: Math.max(0, Math.min(500, Math.round(v ?? 0))) }, randomKey))} />
          <span className="text-xs text-muted">작성자가 줄을 더 적을 수 있는 영역</span>
        </div>
        {g.spareRows > 0 && (g.spareColumns ?? []).map((f, i) => (
          <div key={f.key} className="flex items-center gap-2">
            <span className="w-24 truncate">{f.label}</span>
            <select aria-label={`${f.label} 타입`} value={f.type} onChange={(e) => b.act({ type: 'field/update', blockId: block.id, key: f.key, patch: { type: e.target.value as FieldType } })}
              className="h-7 rounded-btn border border-line-strong bg-white px-1.5 text-xs">
              {FIELD_TYPE_ORDER.map((t) => <option key={t} value={t}>{FIELD_TYPES[t].label}</option>)}
            </select>
            <span className="text-xs text-sub">필수</span>
            <Toggle label={`${f.label} 필수`} checked={f.required} onChange={(v) => b.act({ type: 'field/update', blockId: block.id, key: f.key, patch: { required: v } })} />
            <span className="sr-only">{i}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
