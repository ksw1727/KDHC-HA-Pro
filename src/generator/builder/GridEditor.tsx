import { useState } from 'react';
import { gridOwners, type GridBlock } from '@contract/schema';
import { FIELD_TYPES } from '@contract/fieldTypes';
import type { Builder } from '../state/useBuilder';
import { randomKey } from '../state/newSchema';
import { Button, Chip, NumberInput, TextArea, TextInput, cx } from '../ui/ui';
import { FieldEditor } from './FieldEditor';
import { parsePastedTable } from './parsePastedTable';
import { addCol, addRow, applyToInputs, fromPaste, norm, relabel, removeCol, removeRow, setBlank, setCalc, setFixed, setInputs, setValue, syncSpare, type GridData, type Range } from './gridOps';
import { scopeFor } from '@contract/formula';

/** 작성처 색 (제출처 목록 순서대로) */
const OWNER_COLORS = ['#1f5fbf', '#2f8a4c', '#c46a12', '#8a3fb8', '#b8336a', '#0f7d8c', '#7a6a12', '#4a5a8a'];

/** 빈칸채우기형 표 편집기 (02-generator.md 2.4) */
export function GridEditor({ b, block }: { b: Builder; block: GridBlock }) {
  const [sel, setSel] = useState<Range | null>(null);
  const [paste, setPaste] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const applyPaste = (t: string) => { put(fromPaste(parsePastedTable(t))); setPaste(false); setPasteText(''); setSel(null); };
  const [spareOpen, setSpareOpen] = useState<string | null>(null);
  const g: GridData = { colLabels: block.colLabels, rows: block.rows, spareRows: block.spareRows, spareColumns: block.spareColumns };
  /** 표를 바꿀 때마다 자동 이름(행 첫 칸 · 열 머리글)을 맞춘다 */
  const put = (next: GridData) => b.act({ type: 'grid/replace', blockId: block.id, grid: relabel(g, next) });
  const rg = sel ? norm(sel) : null;
  const single = rg && rg.r1 === rg.r2 && rg.c1 === rg.c2 ? g.rows[rg.r1]?.[rg.c1] : null;
  const isSel = (r: number, c: number) => !!rg && r >= rg.r1 && r <= rg.r2 && c >= rg.c1 && c <= rg.c2;
  const orgs = b.schema.org.mode === 'preset' ? b.schema.org.orgs ?? [] : [];
  const owners = gridOwners(b.schema);
  const colorOf = (org?: string) => (org ? OWNER_COLORS[orgs.indexOf(org) % OWNER_COLORS.length] : undefined);
  const inputKeys = g.rows.flat().flatMap((cell) => (cell.kind === 'input' ? [cell.field.key] : []));
  const selInputs = rg ? g.rows.flatMap((row, r) => row.flatMap((cell, c) => (isSel(r, c) && cell.kind === 'input' ? [cell.field] : []))) : [];

  const click = (r: number, c: number, shift: boolean) => {
    setSel(shift && sel ? { ...sel, r2: r, c2: c } : { r1: r, c1: c, r2: r, c2: c });
    const cell = g.rows[r][c];
    if ((cell.kind === 'input' || cell.kind === 'calc') && !shift) b.setSelected({ blockId: block.id, key: cell.field.key });
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
        <Button size="sm" disabled={!rg} onClick={() => {
          if (!rg) return;
          const next = setCalc(g, rg, randomKey);
          put(next);
          const cell = next.rows[rg.r1][rg.c1];
          if (cell.kind === 'calc') b.setSelected({ blockId: block.id, key: cell.field.key });
        }}>계산 칸으로</Button>
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
                  <td key={c} onClick={(e) => click(r, c, e.shiftKey)} tabIndex={0}
                    aria-label={`${r + 1}행 ${c + 1}열 ${cell.kind === 'input' ? `입력칸 ${cell.field.label}` : cell.kind === 'calc' ? `계산 칸 ${cell.field.label}` : cell.kind === 'fixed' ? String(cell.value) : '빈칸'}`}
                    aria-selected={isSel(r, c) || undefined}
                    onKeyDown={(e) => {
                      // Enter·Space = 고르기(Shift = 범위), 방향키 = 옆 칸으로
                      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); click(r, c, e.shiftKey); return; }
                      const d = ({ ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] } as Record<string, number[]>)[e.key];
                      if (!d) return;
                      e.preventDefault();
                      const nr = Math.max(0, Math.min(g.rows.length - 1, r + d[0]));
                      const nc = Math.max(0, Math.min(g.colLabels.length - 1, c + d[1]));
                      (e.currentTarget.closest('tbody')?.rows[nr]?.cells[nc] as HTMLElement | undefined)?.focus();
                      if (e.shiftKey) click(nr, nc, true);
                    }}
                    className={cx('h-7 min-w-24 cursor-pointer border border-line px-1.5 outline-none focus-visible:shadow-[inset_0_0_0_2px_#93b4ea]', cell.kind === 'input' && (cell.field.required ? 'bg-req' : 'bg-white'), cell.kind === 'calc' && 'bg-[#f3f7fd]', cell.kind === 'blank' && 'bg-[#fafbfc]', isSel(r, c) && 'shadow-[inset_0_0_0_2px_#1f5fbf]')}>
                    {cell.kind === 'fixed' && String(cell.value)}
                    {cell.kind === 'input' && <span className="text-pri-ink">[{cell.field.label}]</span>}
                    {cell.kind === 'input' && orgs.length > 0 && (
                      <span className="block text-[10.5px] font-semibold" style={{ color: colorOf(owners.get(cell.field.key)) ?? '#c0392b' }}>
                        {owners.get(cell.field.key) ? `● ${owners.get(cell.field.key)}${cell.field.owner ? '' : ' (자동)'}` : '● 작성처 없음'}
                      </span>
                    )}
                    {cell.kind === 'calc' && <span className="font-mono text-[#174a96]">= {cell.field.formula || '계산식?'}</span>}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="m-0 text-xs text-muted">칸을 누르면 고르고, Shift를 누른 채 누르면 범위를 골라요. 고정 칸은 아래에서 글자를 바꿀 수 있어요.</p>

      {orgs.length > 0 ? (
        <div className="flex flex-col gap-1.5 rounded-card border border-line bg-panel p-2.5" aria-label="작성처">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
            <b className="text-sub">작성처</b>
            {orgs.map((o) => {
              const n = inputKeys.filter((k) => owners.get(k) === o).length;
              return <span key={o} style={{ color: colorOf(o) }} className="font-semibold">● {o} {n ? `${n}칸` : <span className="font-normal text-warn-ink">(칸 없음)</span>}</span>;
            })}
          </div>
          {selInputs.length > 0 && rg ? (
            <label className="flex items-center gap-2 text-sub">
              고른 입력칸 {selInputs.length}개의 작성처
              <select aria-label="고른 칸 작성처"
                value={selInputs.every((f) => f.owner === selInputs[0].owner) ? selInputs[0].owner ?? '' : '(여러 개)'}
                onChange={(e) => put(applyToInputs(g, rg, { owner: e.target.value || undefined }))}
                className="h-8 rounded-btn border border-line-strong bg-white px-2 text-[13px]">
                {!selInputs.every((f) => f.owner === selInputs[0].owner) && <option value="(여러 개)" disabled>(여러 개)</option>}
                <option value="">머리글로 자동</option>
                {orgs.map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            </label>
          ) : (
            <p className="m-0 text-xs text-muted">열 머리글이나 행 첫 칸이 제출처 이름과 같으면 자동으로 그 제출처 칸이 돼요. 다른 칸은 입력칸을 골라 작성처를 정해 주세요. 제출처마다 받는 파일에서 다른 제출처 칸은 회색으로 잠겨요.</p>
          )}
        </div>
      ) : inputKeys.length > 0 && (
        <p className="m-0 text-xs text-muted">⑤ 제출처를 목록으로 정하면 입력칸마다 작성처(어느 제출처가 채우는 칸인지)를 정할 수 있어요.</p>
      )}

      {single && rg && single.kind !== 'input' && (
        <div className="flex items-center gap-2">
          <span className="text-sub">{rg.r1 + 1}행 {rg.c1 + 1}열 내용</span>
          <TextInput className="flex-1" key={`${rg.r1}-${rg.c1}`} defaultValue={single.kind === 'fixed' ? String(single.value) : ''} placeholder="비우면 빈칸"
            onBlur={(e) => put(setValue(g, rg.r1, rg.c1, e.target.value))} />
        </div>
      )}
      {(single?.kind === 'input' || single?.kind === 'calc') && b.selected?.key === single.field.key && (
        <div>
          <div className="rounded-t-card border border-line bg-panel px-2.5 py-1 text-[11.5px] font-semibold text-muted">{single.kind === 'calc' ? '계산 칸 설정 · 다른 칸은 이름으로 써요 (고정 숫자 칸 이름: 행 첫 칸 · 열 머리글)' : '입력칸 설정'}</div>
          <FieldEditor f={single.field} lockType={single.kind === 'calc'} scope={scopeFor(b.schema, block, single.field)} onPatch={(p) => b.act({ type: 'field/update', blockId: block.id, key: single.field.key, patch: p })} />
        </div>
      )}

      {selInputs.length > 1 && rg && (
        <div>
          <div className="rounded-t-card border border-line bg-panel px-2.5 py-1 text-[11.5px] font-semibold text-muted">고른 입력칸 {selInputs.length}개에 한꺼번에 적용 · 이름은 칸마다 따로</div>
          <FieldEditor f={selInputs[0]} hideLabel onPatch={(p) => put(applyToInputs(g, rg, p))} />
        </div>
      )}

      {paste ? (
        <div className="flex flex-col gap-1.5">
          <TextArea autoFocus aria-label="붙여넣을 표" className="min-h-24 font-mono text-xs" value={pasteText} placeholder={'엑셀에서 표를 복사해 붙여넣으세요. 첫 줄은 머리글이 돼요.\n직접 칠 때는 칸 사이를 Tab으로 띄우고 [표로 바꾸기]를 누르세요.\n사업\t예산\t서울'}
            onChange={(e) => setPasteText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Tab') { e.preventDefault(); const t = e.currentTarget; const a = t.selectionStart; setPasteText(pasteText.slice(0, a) + '\t' + pasteText.slice(t.selectionEnd)); requestAnimationFrame(() => t.setSelectionRange(a + 1, a + 1)); } }}
            onPaste={(e) => { const t = e.clipboardData.getData('text'); if (pasteText.trim()) return; e.preventDefault(); applyPaste(t); }} />
          <div className="flex gap-1.5">
            <Button size="sm" variant="pri" disabled={!pasteText.trim()} onClick={() => applyPaste(pasteText)}>표로 바꾸기</Button>
            <Button size="sm" variant="ghost" onClick={() => { setPaste(false); setPasteText(''); }}>취소</Button>
          </div>
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
        {g.spareRows > 0 && (g.spareColumns ?? []).map((f) => (
          <div key={f.key} className="overflow-hidden rounded-card border border-line bg-white">
            <button type="button" aria-expanded={spareOpen === f.key} onClick={() => setSpareOpen(spareOpen === f.key ? null : f.key)}
              className={cx('flex w-full items-center gap-2 px-2.5 py-1.5 text-left', spareOpen === f.key && 'bg-pri-bg')}>
              <span className="truncate">{f.label}</span>
              {f.required && <Chip tone="req">필수</Chip>}
              <span className="flex-1" />
              <Chip tone={spareOpen === f.key ? 'pri' : 'gray'}>{FIELD_TYPES[f.type].label}</Chip>
              <span className="text-xs text-muted">{spareOpen === f.key ? '접기' : '서식'}</span>
            </button>
            {spareOpen === f.key && (
              <FieldEditor f={f} hideLabel scope={scopeFor(b.schema, block, f, 'spare')}
                onPatch={(p) => b.act({ type: 'field/update', blockId: block.id, key: f.key, patch: p })} />
            )}
          </div>
        ))}
        {g.spareRows > 0 && <p className="m-0 text-xs text-muted">열 이름은 표 머리글을 따라가요. 누르면 타입·선택지·단위 같은 서식을 정해요.</p>}
      </div>
    </div>
  );
}
