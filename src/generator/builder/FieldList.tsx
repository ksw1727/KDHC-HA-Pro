import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { Field, FieldType } from '@contract/schema';
import { FIELD_TYPES, FIELD_TYPE_ORDER } from '@contract/fieldTypes';
import { Chip, cx } from '../ui/ui';
import { FieldEditor } from './FieldEditor';
import { useState } from 'react';
import type { FormulaScope } from '@contract/formula';

interface Props {
  title: string;
  fields: Field[];
  selectedKey?: string | null;
  badKeys: Set<string>;
  onSelect: (key: string | null) => void;
  onPatch: (key: string, p: Partial<Field>) => void;
  onAdd: (type: FieldType) => void;
  onRemove: (key: string) => void;
  onMove: (from: number, to: number) => void;
  extra?: React.ReactNode;
  scopeOf?: (f: Field) => FormulaScope;
}

function Row({ f, selected, bad, onClick, onRemove }: { f: Field; selected: boolean; bad: boolean; onClick: () => void; onRemove: () => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: f.key });
  return (
    <div ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cx('flex items-center gap-2 border-b border-line bg-white px-2.5 py-1.5 last:border-b-0', selected && 'bg-pri-bg shadow-[inset_3px_0_0_var(--color-pri)]', bad && 'bg-err shadow-[inset_3px_0_0_#b42318]', isDragging && 'relative z-10 shadow-lg')}>
      <button type="button" {...attributes} {...listeners} aria-label={`${f.label} 순서 바꾸기`} className="cursor-grab px-0.5 text-xs tracking-[-2px] text-line-strong">⋮⋮</button>
      <button type="button" onClick={onClick} aria-expanded={selected} className="flex flex-1 items-center gap-1.5 text-left outline-none focus-visible:underline">
        <span className={cx(!f.label.trim() && 'text-muted')}>{f.label.trim() || '(이름 없음)'}</span>
        {f.required && <Chip tone="req">필수</Chip>}
      </button>
      <Chip tone={selected ? 'pri' : bad ? 'err' : 'gray'}>{FIELD_TYPES[f.type].label}</Chip>
      <button type="button" onClick={onRemove} aria-label={`${f.label} 삭제`} className="px-1 text-muted hover:text-err-ink">✕</button>
    </div>
  );
}

export function FieldList({ title, fields, selectedKey, badKeys, onSelect, onPatch, onAdd, onRemove, onMove, extra, scopeOf }: Props) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  const [adding, setAdding] = useState(false);
  const onDragEnd = (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return;
    onMove(fields.findIndex((f) => f.key === e.active.id), fields.findIndex((f) => f.key === e.over!.id));
  };
  return (
    <div>
      <div className="overflow-hidden rounded-card border border-line">
        <div className="flex justify-between border-b border-line bg-panel px-2.5 py-1 text-[11.5px] font-semibold text-muted"><span>{title}</span><span>{fields.length}</span></div>
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={fields.map((f) => f.key)} strategy={verticalListSortingStrategy}>
            {fields.map((f) => (
              <div key={f.key}>
                <Row f={f} selected={selectedKey === f.key} bad={badKeys.has(f.key)} onClick={() => onSelect(selectedKey === f.key ? null : f.key)} onRemove={() => onRemove(f.key)} />
                {selectedKey === f.key && <FieldEditor f={f} onPatch={(p) => onPatch(f.key, p)} scope={scopeOf?.(f)} />}
              </div>
            ))}
          </SortableContext>
        </DndContext>
        {fields.length === 0 && <div className="px-2.5 py-3 text-center text-xs text-muted">아직 항목이 없어요</div>}
      </div>
      {extra}
      {adding ? (
        <div className="mt-2 flex flex-wrap gap-1.5" role="group" aria-label="추가할 항목 타입">
          {FIELD_TYPE_ORDER.map((t) => (
            <button key={t} type="button" onClick={() => { onAdd(t); setAdding(false); }} className="rounded-btn border border-pri-line bg-pri-bg px-2 py-0.5 text-xs text-pri-ink hover:bg-white">{FIELD_TYPES[t].label}</button>
          ))}
          <button type="button" onClick={() => setAdding(false)} className="px-1 text-xs text-muted">취소</button>
        </div>
      ) : (
        <button type="button" onClick={() => setAdding(true)} className="mt-2 text-[12.5px] font-bold text-pri-ink">+ 항목 추가</button>
      )}
    </div>
  );
}
