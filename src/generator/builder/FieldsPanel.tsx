import type { Builder } from '../state/useBuilder';
import { randomKey } from '../state/newSchema';
import { FieldList } from './FieldList';
import { ListSettings, MatrixEditor } from './BlockSettings';
import { GridEditor } from './GridEditor';
import { CollectSettings } from './CollectSettings';
import { scopeFor } from '@contract/formula';

/** ③ 항목·서식: 블록 종류별 편집기 */
export function FieldsPanel({ b }: { b: Builder }) {
  const s = b.schema;
  const badKeys = new Set(b.problems.flatMap((p) => (p.key ? [p.key] : [])));
  if (s.layout === 'collect') return <CollectSettings b={b} />;
  return (
    <>
      {s.blocks.map((block) => {
        if (block.kind === 'fields' || block.kind === 'list') {
          const fields = block.kind === 'fields' ? block.fields : block.columns;
          const title = block.kind === 'fields' ? '위쪽 정보 · 한 번만 작성' : s.layout === 'header-list' ? `아래 목록 · 입력 ${block.maxRows}줄` : `목록 · 입력 ${block.maxRows}줄`;
          return (
            <FieldList key={block.id} title={title} fields={fields} badKeys={badKeys}
              selectedKey={b.selected?.blockId === block.id ? b.selected.key : null}
              onSelect={(key) => b.setSelected(key ? { blockId: block.id, key } : null)}
              onPatch={(key, patch) => b.act({ type: 'field/update', blockId: block.id, key, patch })}
              onAdd={(fieldType) => {
                const key = randomKey();
                b.act({ type: 'field/add', blockId: block.id, key, fieldType, after: b.selected?.blockId === block.id ? b.selected.key : undefined });
                b.setSelected({ blockId: block.id, key });
              }}
              onRemove={(key) => { b.act({ type: 'field/remove', blockId: block.id, key }); if (b.selected?.key === key) b.setSelected(null); }}
              onMove={(from, to) => b.act({ type: 'field/move', blockId: block.id, from, to })}
              extra={block.kind === 'list' ? <ListSettings b={b} block={block} /> : undefined}
              scopeOf={(f) => scopeFor(s, block, f)}
            />
          );
        }
        if (block.kind === 'matrix') return <MatrixEditor key={block.id} b={b} block={block} />;
        return <GridEditor key={block.id} b={b} block={block} />;
      })}
      {b.problems.filter((p) => p.where === 'fields').map((p, i) => (
        <div key={i} className="text-xs text-err-ink">● {p.message}</div>
      ))}
    </>
  );
}
