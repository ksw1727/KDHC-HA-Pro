import type { ListBlock, MatrixBlock } from '@contract/schema';
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
          {block.columns.map((c) => (
            <F key={c.key} label={`${c.label} 예시`}>
              <TextInput value={String(block.exampleRow?.[c.key] ?? '')} onChange={(e) => b.act({ type: 'list/set', blockId: block.id, patch: { exampleRow: { ...block.exampleRow, [c.key]: e.target.value } } })} />
            </F>
          ))}
        </div>
      )}
      <p className="m-0 text-xs text-muted">작성자는 줄을 끼워 넣을 수 없어서, 넉넉하게 정해 두세요. 예시 줄은 회색 기울임 글자로 첫 줄에 보여요.</p>
    </div>
  );
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
      <div>
        <div className="rounded-t-card border border-line bg-panel px-2.5 py-1 text-[11.5px] font-semibold text-muted">모든 칸에 적용되는 숫자 서식</div>
        <FieldEditor f={block.cell} lockType onPatch={(p) => b.act({ type: 'field/update', blockId: block.id, key: block.cell.key, patch: p })} />
      </div>
    </div>
  );
}
