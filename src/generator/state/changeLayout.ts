import type { Block, Field, FormSchema, Layout } from '@contract/schema';
import { blockFields } from '@contract/schema';
import { AGGREGATION_REQUIRED, availableAggregations } from '@contract/aggregationIds';
import { defaultBlocks } from './newSchema';

export interface LayoutChange {
  schema: FormSchema;
  lost: Field[];          // 옮길 곳이 없어 지워지는 항목
  lostNotes: string[];    // 항목 외에 사라지는 것 (표 행·열 제목 등)
}

/**
 * 구조 바꾸기. 목록 칸은 목록 칸으로, 항목:값은 항목:값으로 옮기고,
 * 옮길 곳이 없는 것은 lost로 돌려준다(빌더 확인 창에 사용).
 */
export function changeLayout(schema: FormSchema, to: Layout, key: () => string): LayoutChange {
  if (schema.layout === to) return { schema, lost: [], lostNotes: [] };
  const lostNotes: string[] = [];
  const headerFields = schema.blocks.flatMap((b) => (b.kind === 'fields' ? b.fields : []));
  const listCols = schema.blocks.flatMap((b) => (b.kind === 'list' ? b.columns : []));
  const list = schema.blocks.find((b) => b.kind === 'list');
  const others: Field[] = schema.blocks.flatMap((b) => (b.kind === 'matrix' || b.kind === 'grid' ? blockFields(b) : []));
  const matrix = schema.blocks.find((b) => b.kind === 'matrix');
  if (matrix && to !== 'matrix') lostNotes.push(`표의 행 제목 ${matrix.rowLabels.length}개와 열 제목 ${matrix.colLabels.length}개`);
  const grid = schema.blocks.find((b) => b.kind === 'grid');
  if (grid && to !== 'fill-in') lostNotes.push('빈칸채우기 표의 고정 내용');

  const defaults = defaultBlocks(to, key);
  let blocks: Block[] = defaults;
  let lost: Field[] = [];
  const maxRows = list?.kind === 'list' ? list.maxRows : 100;
  const exampleRow = list?.kind === 'list' ? list.exampleRow : undefined;

  switch (to) {
    case 'list':
      blocks = listCols.length ? [{ kind: 'list', id: 'b1', maxRows, exampleRow, columns: listCols }] : defaults;
      lost = [...headerFields, ...others];
      break;
    case 'header-list':
      blocks = [
        headerFields.length ? { kind: 'fields', id: 'b1', fields: headerFields } : defaults[0],
        listCols.length ? { kind: 'list', id: 'b2', maxRows, exampleRow, columns: listCols } : defaults[1],
      ];
      lost = others;
      break;
    case 'matrix':
    case 'fill-in':
    case 'collect':
      lost = [...headerFields, ...listCols, ...others];
      break;
  }
  if (!blocks.length) blocks = [];
  blocks = blocks.map((b, i) => ({ ...b, id: `b${i + 1}` })) as Block[];
  for (const b of blocks) if (b.kind === 'list' && !b.exampleRow) delete b.exampleRow;

  const org = { ...schema.org };
  if (to === 'collect' && org.mode === 'input') org.mode = 'preset';
  const next: FormSchema = { ...schema, layout: to, blocks, org };
  if (to === 'collect') next.collect = schema.collect ?? { scope: 'report' };
  else delete next.collect;

  const allowed = availableAggregations(next);
  next.aggregations = [...new Set([...AGGREGATION_REQUIRED[to], ...schema.aggregations.filter((a) => allowed.includes(a))])];
  return { schema: next, lost, lostNotes };
}
