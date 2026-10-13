import type { Block, FormSchema, Layout } from '@contract/schema';
import { AGGREGATION_REQUIRED, availableAggregations } from '@contract/aggregationIds';
import { newField } from './fieldDefaults';

export interface Ids {
  formId: string;
  key: () => string;   // 항목 key 발급 (화면에서는 무작위, 테스트에서는 고정)
}

/** 항목 key 발급기: f_ + 영문·숫자 4자리 */
export function randomKey(): string {
  return 'f_' + Math.random().toString(36).slice(2, 6).padEnd(4, '0');
}

export function randomFormId(): string {
  return crypto.randomUUID();
}

/** 구조별 기본 블록 */
export function defaultBlocks(layout: Layout, key: () => string): Block[] {
  switch (layout) {
    case 'list':
      return [{ kind: 'list', id: 'b1', maxRows: 100, columns: [{ ...newField(key(), 'text', '이름'), required: true }] }];
    case 'header-list':
      return [
        { kind: 'fields', id: 'b1', fields: [{ ...newField(key(), 'text', '담당자'), required: true }] },
        { kind: 'list', id: 'b2', maxRows: 100, columns: [{ ...newField(key(), 'text', '이름'), required: true }] },
      ];
    case 'matrix':
      return [{ kind: 'matrix', id: 'b1', rowLabels: ['1행', '2행'], colLabels: ['1열', '2열'], cell: newField(key(), 'number', '값'), totalRow: true, totalCol: false }];
    case 'fill-in':
      return [{
        kind: 'grid', id: 'b1', colLabels: ['구분', '내용', '입력'], spareRows: 0,
        rows: [
          [{ kind: 'fixed', value: '항목 1' }, { kind: 'blank' }, { kind: 'input', field: newField(key(), 'text', '항목 1 · 입력') }],
          [{ kind: 'fixed', value: '항목 2' }, { kind: 'blank' }, { kind: 'input', field: newField(key(), 'text', '항목 2 · 입력') }],
        ],
      }];
    case 'collect':
      return [];
  }
}

/** 기본 취합 방식 = 필수 + (지사를 식별하면) 제출 현황표 */
export function defaultAggregations(schema: Pick<FormSchema, 'layout' | 'org'>) {
  const allowed = availableAggregations(schema);
  const out = [...AGGREGATION_REQUIRED[schema.layout]];
  if (allowed.includes('submission-status')) out.push('submission-status');
  return out;
}

export function newSchema(layout: Layout, now: Date, ids: Ids): FormSchema {
  const org: FormSchema['org'] = { mode: 'preset', orgs: [], label: '지사' };
  const at = now.toISOString();
  return {
    contractVersion: 1,
    formId: ids.formId,
    formVersion: 1,
    title: '',
    layout,
    blocks: defaultBlocks(layout, ids.key),
    ...(layout === 'collect' ? { collect: { scope: 'report' as const } } : {}),
    aggregations: defaultAggregations({ layout, org }),
    org,
    createdAt: at,
    updatedAt: at,
  };
}
