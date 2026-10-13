import { freeProblems, freeRegions, inRegion, sheetRange, type FreeRegion } from '@contract/free';
import { scopeFor } from '@contract/formula';
import type { Builder } from '../state/useBuilder';
import { randomKey } from '../state/newSchema';
import { FieldEditor } from '../builder/FieldEditor';
import { FieldList } from '../builder/FieldList';
import { ListSettings, MatrixEditor } from '../builder/BlockSettings';
import { Button, Field as F, TextInput } from '../ui/ui';
import { REGION_COLOR, REGION_NAME, regionSel, selRect, type FreeSel } from './FreeCanvas';

/** ③ 고른 영역 (자유 제작형): 판에서 고른 영역의 이름·칸·서식. 안 골랐으면 사용법과 영역 목록 */
export function FreePanel({ b, sel, onSel, onMove }: { b: Builder; sel: FreeSel | null; onSel: (s: FreeSel | null) => void; onMove: (g: FreeRegion) => void }) {
  const s = b.schema;
  const regions = freeRegions(s);
  const rect = sel ? selRect(sel) : null;
  // 고른 범위가 한 영역 안에 있으면 그 영역 (칸을 더해 영역이 커져도 그대로)
  const g = rect ? regions.find((x) => inRegion(x, rect.r1, rect.c1) && inRegion(x, rect.r2, rect.c2)) : undefined;
  const block = g ? s.blocks.find((x) => x.id === g.blockId) : undefined;
  const badKeys = new Set(b.problems.flatMap((p) => (p.key ? [p.key] : [])));
  const common = freeProblems(s);

  const head = g && (
    <div className="flex items-center gap-2">
      <i className="inline-block h-3 w-3 rounded-[2px] border-2" style={{ borderColor: REGION_COLOR[g.kind] }} />
      <b>{REGION_NAME[g.kind]}</b>
      <span className="rounded-full bg-chip px-2 text-xs text-sub">{sheetRange(s, g)}</span>
      <span className="flex-1" />
      <Button size="sm" onClick={() => onMove(g)}>↦ 옮기기</Button>
      <Button size="sm" variant="danger" onClick={() => { b.act({ type: 'free/op', op: { op: 'unmark', rect: g } }); onSel(null); }}>지정 풀기</Button>
    </div>
  );

  let body = null;
  if (g?.kind === 'fields' && block?.kind === 'fields') {
    const f = block.fields.find((x) => x.key === g.key)!;
    body = (
      <>
        <p className="m-0 text-xs text-muted">이름은 취합본 머리글·{s.org.mode === 'none' ? '파일' : '지사'}별 시트의 칸 이름이 돼요.</p>
        <div className="overflow-hidden rounded-card border border-line">
          <FieldEditor f={f} onPatch={(p) => b.act({ type: 'field/update', blockId: block.id, key: f.key, patch: p })} scope={scopeFor(s, block, f)} />
        </div>
      </>
    );
  } else if (g && block && (block.kind === 'list' || block.kind === 'matrix')) {
    const name = (
      <F label="영역 이름 (취합본·오류 목록에 쓰여요)">
        <TextInput value={block.title ?? ''} onChange={(e) => b.act({ type: 'block/title', blockId: block.id, title: e.target.value })} />
      </F>
    );
    body = block.kind === 'list' ? (
      <>
        {name}
        <FieldList title={`머리글 칸 · 입력 ${block.maxRows}줄`} fields={block.columns} badKeys={badKeys}
          selectedKey={b.selected?.blockId === block.id ? b.selected.key : null}
          onSelect={(key) => b.setSelected(key ? { blockId: block.id, key } : null)}
          onPatch={(key, patch) => b.act({ type: 'field/update', blockId: block.id, key, patch })}
          onAdd={(fieldType) => { const key = randomKey(); b.act({ type: 'field/add', blockId: block.id, key, fieldType }); b.setSelected({ blockId: block.id, key }); }}
          onRemove={(key) => b.act({ type: 'field/remove', blockId: block.id, key })}
          onMove={(from, to) => b.act({ type: 'field/move', blockId: block.id, from, to })}
          extra={<ListSettings b={b} block={block} />}
          scopeOf={(f) => scopeFor(s, block, f)} />
        <p className="m-0 text-xs text-muted">칸을 더하면 영역이 오른쪽으로, 줄 수를 늘리면 아래로 커져요. 다른 영역과 겹치면 ④에서 알려 드려요.</p>
      </>
    ) : (
      <>{name}<MatrixEditor b={b} block={block} /></>
    );
  } else {
    body = (
      <div className="flex flex-col gap-2 text-[12.5px] text-sub">
        <ol className="m-0 flex flex-col gap-1 pl-5">
          <li>오른쪽 판에 <b>글자</b>를 써서 표 모양을 그려요. (두 번 누르거나 바로 타자)</li>
          <li>작성자가 채울 칸을 끌어서 고른 뒤 위 도구로 지정해요.
            <ul className="m-0 mt-0.5 pl-4 text-xs">
              <li><b style={{ color: REGION_COLOR.fields }}>입력 칸</b>: 한 칸에 값 하나 (담당자, 점검일)</li>
              <li><b style={{ color: REGION_COLOR.list }}>입력 줄 영역</b>: 맨 윗줄 머리글 + 아래로 여러 줄 (명단, 내역)</li>
              <li><b style={{ color: REGION_COLOR.matrix }}>숫자 표</b>: 윗줄 열 제목 × 왼쪽 행 제목, 안쪽 숫자</li>
            </ul>
          </li>
          <li>영역을 누르면 여기서 이름·서식을 고쳐요.</li>
          <li>④ 취합 방식에서 이 모양으로 취합되는지 확인해요.</li>
        </ol>
        {regions.length > 0 && (
          <div className="overflow-hidden rounded-card border border-line">
            <div className="border-b border-line bg-panel px-2.5 py-1 text-[11.5px] font-semibold text-muted">지정한 영역 {regions.length}</div>
            {regions.map((x) => (
              <button key={`${x.blockId}-${x.key ?? ''}`} type="button" onClick={() => onSel(regionSel(x))}
                className="flex w-full items-center gap-2 border-b border-line bg-white px-2.5 py-1.5 text-left last:border-b-0 hover:bg-panel">
                <i className="inline-block h-2.5 w-2.5 rounded-[2px] border-2" style={{ borderColor: REGION_COLOR[x.kind] }} />
                <span className="text-ink">{x.name}</span>
                <span className="text-xs text-muted">{REGION_NAME[x.kind]}</span>
                <span className="ml-auto text-xs text-muted">{sheetRange(s, x)}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <>
      {head}
      {body}
      {common.map((p, i) => (
        <div key={i} className="rounded-btn bg-err px-2.5 py-1.5 text-xs text-err-ink">● {p.message} {p.fix}</div>
      ))}
      {b.problems.filter((p) => p.where === 'fields' && !common.some((c) => p.message.startsWith(c.message))).map((p, i) => (
        <div key={`p${i}`} className="text-xs text-err-ink">● {p.message}</div>
      ))}
    </>
  );
}
