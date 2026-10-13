import type { FormSchema, Layout } from './schema';

/** 취합 방식 ID (01-contract.md 6절). 추가는 계약 변경이다. */
export type AggregationId =
  | 'same-frame'         // 같은 틀 시트        — collect를 뺀 모든 layout, 항상 포함
  | 'spread'             // 지사별 펼치기       — matrix(항상 포함), header-list, fill-in
  | 'collect-sheets'     // 시트 모으기         — 모든 layout. collect는 항상 포함(목차 시트 포함)
  | 'submission-status'; // 제출 현황표         — org.mode가 preset·input일 때

export const AGGREGATION_IDS: AggregationId[] = ['same-frame', 'spread', 'collect-sheets', 'submission-status'];

export const AGGREGATION_LABELS: Record<AggregationId, string> = {
  'same-frame': '같은 틀 시트',
  spread: '지사별 펼치기',
  'collect-sheets': '시트 모으기',
  'submission-status': '제출 현황표',
};

export const AGGREGATION_SUPPORT: Record<AggregationId, Layout[]> = {
  'same-frame': ['list', 'header-list', 'matrix', 'fill-in'],
  spread: ['matrix', 'header-list', 'fill-in'],
  'collect-sheets': ['list', 'header-list', 'matrix', 'fill-in', 'collect'],
  'submission-status': ['list', 'header-list', 'matrix', 'fill-in', 'collect'],
};

export const AGGREGATION_REQUIRED: Record<Layout, AggregationId[]> = {
  list: ['same-frame'],
  'header-list': ['same-frame'],
  'fill-in': ['same-frame'],
  matrix: ['same-frame', 'spread'],
  collect: ['collect-sheets'],
};

/** 이 양식에서 고를 수 있는 취합 방식. 제출 현황표는 지사를 식별할 때(preset·input)만. */
export function availableAggregations(schema: Pick<FormSchema, 'layout' | 'org'>): AggregationId[] {
  return AGGREGATION_IDS.filter((id) => {
    if (!AGGREGATION_SUPPORT[id].includes(schema.layout)) return false;
    if (id === 'submission-status' && schema.org.mode === 'none') return false;
    return true;
  });
}
