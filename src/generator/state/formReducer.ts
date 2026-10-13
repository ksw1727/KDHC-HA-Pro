import type { Block, CollectSpec, Field, FieldType, FormSchema, GridBlock, ListBlock, MatrixBlock } from '@contract/schema';
import { availableAggregations, requiredAggregations, type AggregationId } from '@contract/aggregationIds';
import { applyFreeOp, tidy, type FreeOp } from './freeEdit';
import { newField, patchField } from './fieldDefaults';
import { changeLayout } from './changeLayout';
import { defaultAggregations } from './newSchema';
import { renameRef } from '@contract/formula';

export type Action =
  | { type: 'meta/set'; patch: Partial<Pick<FormSchema, 'title' | 'guide' | 'deadline' | 'contact'>> }
  | { type: 'layout/change'; layout: FormSchema['layout']; keys: string[] }
  | { type: 'field/add'; blockId: string; key: string; fieldType: FieldType; label?: string; after?: string }
  | { type: 'field/update'; blockId: string; key: string; patch: Partial<Field> }
  | { type: 'field/remove'; blockId: string; key: string }
  | { type: 'field/move'; blockId: string; from: number; to: number }
  | { type: 'list/set'; blockId: string; patch: { maxRows?: number; exampleRow?: Record<string, string | number> | null } }
  | { type: 'matrix/set'; blockId: string; patch: Partial<Pick<MatrixBlock, 'rowLabels' | 'colLabels' | 'totalRow' | 'totalCol' | 'calcRows' | 'calcCols'>> }
  | { type: 'grid/replace'; blockId: string; grid: Pick<GridBlock, 'colLabels' | 'rows' | 'spareRows' | 'spareColumns'> }
  | { type: 'collect/set'; patch: Partial<CollectSpec> }
  | { type: 'org/set'; patch: Partial<FormSchema['org']> }
  | { type: 'agg/toggle'; id: AggregationId }
  | { type: 'schema/load'; schema: FormSchema }
  | { type: 'free/op'; op: FreeOp }
  | { type: 'block/title'; blockId: string; title: string };

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

/** 항목 이름이 바뀌면 같은 블록·위쪽 정보 계산식 안의 [이전 이름]도 바꾼다 */
function renameInFormulas(s: FormSchema, from: string, to: string): FormSchema {
  if (!from.trim() || from.trim() === to.trim()) return s;
  const fix = (f: Field): Field => (f.type === 'calc' && f.formula ? { ...f, formula: renameRef(f.formula, from.trim(), to.trim()) } : f);
  return {
    ...s,
    blocks: s.blocks.map((b): Block => {
      switch (b.kind) {
        case 'fields': return { ...b, fields: b.fields.map(fix) };
        case 'list': return { ...b, columns: b.columns.map(fix) };
        case 'matrix': return { ...b, calcRows: b.calcRows?.map(fix), calcCols: b.calcCols?.map(fix) };
        case 'grid': return { ...b, rows: b.rows.map((r) => r.map((c) => (c.kind === 'calc' ? { ...c, field: fix(c.field) } : c))), spareColumns: b.spareColumns?.map(fix) };
      }
    }),
  };
}

function labelOf(s: FormSchema, blockId: string, key: string): string | undefined {
  const b = s.blocks.find((x) => x.id === blockId);
  if (!b) return undefined;
  const all: Field[] = b.kind === 'fields' ? b.fields : b.kind === 'list' ? b.columns : b.kind === 'matrix' ? [b.cell, ...(b.calcRows ?? []), ...(b.calcCols ?? [])] : [...b.rows.flat().flatMap((c) => (c.kind === 'input' || c.kind === 'calc' ? [c.field] : [])), ...(b.spareColumns ?? [])];
  return all.find((f) => f.key === key)?.label;
}

/** 순수 함수 리듀서. 시간·무작위 값은 action으로 받는다. */
export function formReducer(s: FormSchema, a: Action): FormSchema {
  if (a.type === 'field/update' && a.patch.label !== undefined) {
    const old = labelOf(s, a.blockId, a.key);
    const next = formReducerCore(s, a);
    return old !== undefined ? renameInFormulas(next, old, a.patch.label) : next;
  }
  const next = formReducerCore(s, a);
  // 자유 제작형: 입력 칸 항목을 지우면 놓인 자리도 지우고, 필수 취합 방식을 맞춘다
  if (next.layout === 'free' && next !== s && a.type !== 'schema/load' && a.type !== 'layout/change') {
    if (a.type === 'field/remove' && next.free?.places[a.key]) {
      const { [a.key]: _gone, ...places } = next.free.places;
      return tidy({ ...next, free: { ...next.free, places } });
    }
    return a.type === 'free/op' ? next : tidy(next);
  }
  return next;
}

function formReducerCore(s: FormSchema, a: Action): FormSchema {
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
        if (b.kind === 'matrix') {
          if (b.cell.key === a.key) return { ...b, cell: patchField(b.cell, { ...a.patch, type: 'number' }) };
          const fix = (f: Field) => (f.key === a.key ? patchField(f, { ...a.patch, type: 'calc' }) : f);
          return { ...b, calcRows: b.calcRows?.map(fix), calcCols: b.calcCols?.map(fix) };
        }
        if (b.kind === 'grid') {
          return {
            ...b,
            rows: b.rows.map((r) => r.map((c) => ((c.kind === 'input' || c.kind === 'calc') && c.field.key === a.key ? { ...c, field: patchField(c.field, c.kind === 'calc' ? { ...a.patch, type: 'calc' } : a.patch) } : c))),
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
      if (requiredAggregations(s).includes(a.id)) return s;
      if (!availableAggregations(s).includes(a.id)) return s;
      const on = s.aggregations.includes(a.id);
      return { ...s, aggregations: on ? s.aggregations.filter((x) => x !== a.id) : [...s.aggregations, a.id] };
    }

    case 'schema/load':
      return a.schema;

    case 'block/title':
      return updateBlock(s, a.blockId, (b) => ({ ...b, title: a.title }));

    case 'free/op':
      // 할 수 없는 편집은 그대로 둔다 (화면이 미리 applyFreeOp로 이유를 보여준다)
      return applyFreeOp(s, a.op).schema ?? s;
  }
}
