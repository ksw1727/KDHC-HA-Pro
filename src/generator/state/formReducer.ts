import type { Block, CollectSpec, Field, FieldType, FormSchema, GridBlock, ListBlock, MatrixBlock } from '@contract/schema';
import { AGGREGATION_REQUIRED, availableAggregations, type AggregationId } from '@contract/aggregationIds';
import { newField, patchField } from './fieldDefaults';
import { changeLayout } from './changeLayout';
import { defaultAggregations } from './newSchema';

export type Action =
  | { type: 'meta/set'; patch: Partial<Pick<FormSchema, 'title' | 'guide' | 'deadline' | 'contact'>> }
  | { type: 'layout/change'; layout: FormSchema['layout']; keys: string[] }
  | { type: 'field/add'; blockId: string; key: string; fieldType: FieldType; label?: string; after?: string }
  | { type: 'field/update'; blockId: string; key: string; patch: Partial<Field> }
  | { type: 'field/remove'; blockId: string; key: string }
  | { type: 'field/move'; blockId: string; from: number; to: number }
  | { type: 'list/set'; blockId: string; patch: { maxRows?: number; exampleRow?: Record<string, string | number> | null } }
  | { type: 'matrix/set'; blockId: string; patch: Partial<Pick<MatrixBlock, 'rowLabels' | 'colLabels' | 'totalRow' | 'totalCol'>> }
  | { type: 'grid/replace'; blockId: string; grid: Pick<GridBlock, 'colLabels' | 'rows' | 'spareRows' | 'spareColumns'> }
  | { type: 'collect/set'; patch: Partial<CollectSpec> }
  | { type: 'org/set'; patch: Partial<FormSchema['org']> }
  | { type: 'agg/toggle'; id: AggregationId }
  | { type: 'schema/load'; schema: FormSchema };

const updateBlock = (s: FormSchema, id: string, fn: (b: Block) => Block): FormSchema => ({
  ...s,
  blocks: s.blocks.map((b) => (b.id === id ? fn(b) : b)),
});

const fieldsOf = (b: Block): Field[] | null => (b.kind === 'fields' ? b.fields : b.kind === 'list' ? b.columns : null);
const withFields = (b: Block, fields: Field[]): Block =>
  b.kind === 'fields' ? { ...b, fields } : b.kind === 'list' ? { ...b, columns: fields } : b;

/** 항목 이름 기본값: "항목 n" (같은 블록에서 겹치지 않게) */
export function nextLabel(existing: Field[]): string {
  const names = new Set(existing.map((f) => f.label));
  let n = existing.length + 1;
  while (names.has(`항목 ${n}`)) n++;
  return `항목 ${n}`;
}

/** 순수 함수 리듀서. 시간·무작위 값은 action으로 받는다. */
export function formReducer(s: FormSchema, a: Action): FormSchema {
  switch (a.type) {
    case 'meta/set':
      return { ...s, ...a.patch };

    case 'layout/change': {
      const pool = [...a.keys];
      return changeLayout(s, a.layout, () => pool.shift() ?? `f_${Math.random().toString(36).slice(2, 6)}`).schema;
    }

    case 'field/add':
      return updateBlock(s, a.blockId, (b) => {
        const list = fieldsOf(b);
        if (!list) return b;
        const f = newField(a.key, a.fieldType, a.label ?? nextLabel(list));
        const i = a.after ? list.findIndex((x) => x.key === a.after) + 1 : list.length;
        return withFields(b, [...list.slice(0, i), f, ...list.slice(i)]);
      });

    case 'field/update':
      return updateBlock(s, a.blockId, (b) => {
        if (b.kind === 'matrix') return b.cell.key === a.key ? { ...b, cell: patchField(b.cell, { ...a.patch, type: 'number' }) } : b;
        if (b.kind === 'grid') {
          return {
            ...b,
            rows: b.rows.map((r) => r.map((c) => (c.kind === 'input' && c.field.key === a.key ? { ...c, field: patchField(c.field, a.patch) } : c))),
            spareColumns: b.spareColumns?.map((f) => (f.key === a.key ? patchField(f, a.patch) : f)),
          };
        }
        const list = fieldsOf(b)!;
        return withFields(b, list.map((f) => (f.key === a.key ? patchField(f, a.patch) : f)));
      });

    case 'field/remove':
      return updateBlock(s, a.blockId, (b) => {
        const list = fieldsOf(b);
        if (!list) return b;
        const next = withFields(b, list.filter((f) => f.key !== a.key));
        if (next.kind === 'list' && next.exampleRow) {
          const { [a.key]: _drop, ...rest } = next.exampleRow;
          next.exampleRow = rest;
        }
        return next;
      });

    case 'field/move':
      return updateBlock(s, a.blockId, (b) => {
        const list = fieldsOf(b);
        if (!list || a.from === a.to || a.from < 0 || a.from >= list.length) return b;
        const next = [...list];
        const [moved] = next.splice(a.from, 1);
        next.splice(Math.max(0, Math.min(next.length, a.to)), 0, moved);
        return withFields(b, next);
      });

    case 'list/set':
      return updateBlock(s, a.blockId, (b) => {
        if (b.kind !== 'list') return b;
        const next: ListBlock = { ...b };
        if (a.patch.maxRows !== undefined) next.maxRows = Math.max(1, Math.min(5000, Math.round(a.patch.maxRows)));
        if (a.patch.exampleRow === null) delete next.exampleRow;
        else if (a.patch.exampleRow) next.exampleRow = a.patch.exampleRow;
        return next;
      });

    case 'matrix/set':
      return updateBlock(s, a.blockId, (b) => (b.kind === 'matrix' ? { ...b, ...a.patch } : b));

    case 'grid/replace':
      return updateBlock(s, a.blockId, (b) => {
        if (b.kind !== 'grid') return b;
        const next: GridBlock = { ...b, ...a.grid };
        if (next.spareRows <= 0) delete next.spareColumns;
        return next;
      });

    case 'collect/set':
      return { ...s, collect: { scope: 'report', ...s.collect, ...a.patch } };

    case 'org/set': {
      const org = { ...s.org, ...a.patch };
      if (s.layout === 'collect' && org.mode === 'input') org.mode = 'preset';
      if (org.orgs) org.orgs = [...new Set(org.orgs.map((o) => o.trim()).filter(Boolean))];
      const next = { ...s, org };
      const allowed = availableAggregations(next);
      const kept = s.aggregations.filter((x) => allowed.includes(x));
      // 식별 안 함 → 지사 식별로 바꾸면 제출 현황표를 기본으로 켠다
      if (s.org.mode === 'none' && org.mode !== 'none') next.aggregations = [...new Set([...kept, ...defaultAggregations(next)])];
      else next.aggregations = kept;
      return next;
    }

    case 'agg/toggle': {
      if (AGGREGATION_REQUIRED[s.layout].includes(a.id)) return s;
      if (!availableAggregations(s).includes(a.id)) return s;
      const on = s.aggregations.includes(a.id);
      return { ...s, aggregations: on ? s.aggregations.filter((x) => x !== a.id) : [...s.aggregations, a.id] };
    }

    case 'schema/load':
      return a.schema;
  }
}
