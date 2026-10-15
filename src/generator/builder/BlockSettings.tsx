import type { Field, ListBlock, MatrixBlock } from '@contract/schema';
import { scopeFor } from '@contract/formula';
import { randomKey } from '../state/newSchema';
import { newField } from '../state/fieldDefaults';
import { useState } from 'react';
import { Button } from '../ui/ui';
import type { Builder } from '../state/useBuilder';
import { Field as F, NumberInput, TextArea, TextInput, Toggle } from '../ui/ui';
import { FieldEditor } from './FieldEditor';

/** 목록 블록 설정: 입력 줄 수, 예시 줄 */
export function ListSettings({ b, block }: { b: Builder; block: ListBlock }) {
  const on = !!block.exampleRow;
  return (
    <div className="mt-2 flex flex-col gap-2 rounded-card border border-line bg-panel p-2.5">
      <div className="flex items-center gap-2">
        <span className="text-sub">입력 줄 수</span>
        <NumberInput className="w-20" aria-label="입력 줄 수" value={block.maxRows} onValue={(v) => v && b.act({ type: 'list/set', blockId: block.id, patch: { maxRows: v } })} />
        <span className="flex-1" />
        <span className="text-sub">예시 줄</span>
        <Toggle label="예시 줄" checked={on} onChange={(v) => b.act({ type: 'list/set', blockId: block.id, patch: { exampleRow: v ? {} : null } })} />
      </div>
      {on && (
        <div className="grid grid-cols-2 gap-2">
          {block.columns.filter((c) => c.type !== 'calc').map((c) => (
            <F key={c.key} label={`${c.label} 예시`}>
              <TextInput value={String(block.exampleRow?.[c.key] ?? '')} onChange={(e) => b.act({ type: 'list/set', blockId: block.id, patch: { exampleRow: { ...block.exampleRow, [c.key]: exampleValue(c, e.target.value) } } })} />
            </F>
          ))}
        </div>
      )}
      <p className="m-0 text-xs text-muted">작성자는 줄을 끼워 넣을 수 없어서, 넉넉하게 정해 두세요. 예시 줄은 회색 기울임 글자로 첫 줄에 보여요.</p>
    </div>
  );
}

/** 예시 값: 숫자 칸은 숫자로 저장(엑셀에서 서식이 적용되고, 취합의 예시 줄 비교도 맞게). 계산 칸은 엔진이 계산 */
function exampleValue(f: Field, text: string): string | number {
  if (f.type !== 'number') return text;
  const unit = f.unit?.trim();
  const clean = (unit ? text.split(unit).join('') : text).replace(/[,\s]/g, '');
  // 다 친 숫자만 숫자로 ("1."처럼 치는 중인 값은 글자 그대로 두어 커서가 튀지 않게)
  return clean !== '' && String(Number(clean)) === clean ? Number(clean) : text;
}

const lines = (t: string) => t.split('\n');
const clean = (t: string) => t.split('\n').map((x) => x.trim()).filter(Boolean);

/** 표형 편집: 행·열 제목, 합계, 칸 서식 */
export function MatrixEditor({ b, block }: { b: Builder; block: MatrixBlock }) {
  const set = (patch: Partial<Pick<MatrixBlock, 'rowLabels' | 'colLabels' | 'totalRow' | 'totalCol'>>) => b.act({ type: 'matrix/set', blockId: block.id, patch });
  return (
    <div className="flex flex-col gap-2.5">
      <div className="grid grid-cols-2 gap-2">
        <F label="행 제목 (줄마다 하나)" hint={<>한 줄에 하나씩 적어요.<br />예: 1학년 ⏎ 2학년 ⏎ 3학년</>}>
          <TextArea className="min-h-24" value={block.rowLabels.join('\n')} onChange={(e) => set({ rowLabels: lines(e.target.value) })} onBlur={(e) => set({ rowLabels: clean(e.target.value) })} />
        </F>
        <F label="열 제목 (줄마다 하나)" hint={<>한 줄에 하나씩 적어요.<br />예: 남 ⏎ 여</>}>
          <TextArea className="min-h-24" value={block.colLabels.join('\n')} onChange={(e) => set({ colLabels: lines(e.target.value) })} onBlur={(e) => set({ colLabels: clean(e.target.value) })} />
        </F>
      </div>
      <p className="m-0 rounded-btn bg-panel px-2.5 py-1.5 text-xs leading-relaxed text-sub">
        행 제목은 표 왼쪽에 세로로, 열 제목은 표 위쪽에 가로로 들어가요. 엑셀에서 제목들을 한 열로 복사해 붙여넣어도 줄마다 나뉘어 들어가요. 빈 줄은 저장할 때 지워져요.
      </p>
      <div className="flex items-center gap-2">
        <span className="text-sub">합계 행</span><Toggle label="합계 행" checked={block.totalRow} onChange={(v) => set({ totalRow: v })} />
        <span className="ml-4 text-sub">합계 열(계)</span><Toggle label="합계 열" checked={block.totalCol} onChange={(v) => set({ totalCol: v })} />
      </div>
      <CalcLines b={b} block={block} kind="calcCols" />
      <CalcLines b={b} block={block} kind="calcRows" />
      <div>
        <div className="rounded-t-card border border-line bg-panel px-2.5 py-1 text-[11.5px] font-semibold text-muted">모든 칸에 적용되는 숫자 서식</div>
        <FieldEditor f={block.cell} lockType onPatch={(p) => b.act({ type: 'field/update', blockId: block.id, key: block.cell.key, patch: p })} />
      </div>
    </div>
  );
}

/** 표형 계산 열·계산 행 목록 */
function CalcLines({ b, block, kind }: { b: Builder; block: MatrixBlock; kind: 'calcRows' | 'calcCols' }) {
  const lines = block[kind] ?? [];
  const [openLocal, setOpen] = useState<string | null>(null);
  const open = b.selected?.blockId === block.id && lines.some((l) => l.key === b.selected?.key) ? b.selected.key : openLocal;
  const isCol = kind === 'calcCols';
  const set = (next: Field[]) => b.act({ type: 'matrix/set', blockId: block.id, patch: { [kind]: next } });
  return (
    <div className="overflow-hidden rounded-card border border-line">
      <div className="flex items-center justify-between border-b border-line bg-panel px-2.5 py-1 text-[11.5px] font-semibold text-muted">
        <span>{isCol ? '계산 열 · 표 오른쪽에 붙어요 (예: 비율 = [여] ÷ [계] × 100)' : '계산 행 · 표 아래에 붙어요 (예: 차이 = [2학년] − [1학년])'}</span>
        <span>{lines.length}</span>
      </div>
      {lines.map((f) => (
        <div key={f.key}>
          <div className={'flex items-center gap-2 border-b border-line px-2.5 py-1.5 ' + (open === f.key ? 'bg-pri-bg' : 'bg-white')}>
            <button type="button" className="flex-1 text-left" aria-expanded={open === f.key} onClick={() => { setOpen(open === f.key ? null : f.key); b.setSelected(open === f.key ? null : { blockId: block.id, key: f.key }); }}>
              <b>{f.label || '(이름 없음)'}</b> <span className="ml-1 font-mono text-xs text-muted">{f.formula || '계산식 없음'}</span>
            </button>
            <button type="button" aria-label={`${f.label} 삭제`} className="px-1 text-muted hover:text-err-ink" onClick={() => set(lines.filter((x) => x.key !== f.key))}>✕</button>
          </div>
          {open === f.key && (
            <FieldEditor f={f} lockType scope={scopeFor(b.schema, block, f, isCol ? 'col' : 'row')}
              onPatch={(p) => b.act({ type: 'field/update', blockId: block.id, key: f.key, patch: p })} />
          )}
        </div>
      ))}
      <div className="px-2.5 py-1.5">
        <Button size="sm" onClick={() => { const key = randomKey(); set([...lines, { ...newField(key, 'calc', isCol ? `계산 열 ${lines.length + 1}` : `계산 행 ${lines.length + 1}`) }]); setOpen(key); }}>
          + {isCol ? '계산 열' : '계산 행'} 추가
        </Button>
      </div>
    </div>
  );
}
