import { AGGREGATION_LABELS, AGGREGATION_REQUIRED, availableAggregations, type AggregationId } from '@contract/aggregationIds';
import { orgLabel } from '@contract/schema';
import type { Builder } from '../state/useBuilder';
import { Checkbox } from '../ui/ui';

const DESC: Record<AggregationId, string> = {
  'same-frame': '빈 양식과 같은 모양에 모든 값을 담은 첫 시트',
  spread: '제출처마다 한 줄로 펼친 시트',
  'collect-sheets': '제출처별 시트를 그대로 모은 시트들',
  'submission-status': '제출·미제출·제외 현황',
};

/** ④ 취합 방식: 이 양식에서 쓸 수 있는 것만, 필수는 잠금 */
export function AggPanel({ b }: { b: Builder }) {
  const s = b.schema;
  const req = AGGREGATION_REQUIRED[s.layout];
  const label = orgLabel(s);
  return (
    <div className="flex flex-col gap-2">
      {availableAggregations(s).map((id) => (
        <div key={id}>
          <Checkbox checked={s.aggregations.includes(id)} disabled={req.includes(id)} locked={req.includes(id)}
            label={<b className="font-semibold">{AGGREGATION_LABELS[id].replace('지사', label)}</b>}
            onChange={() => b.act({ type: 'agg/toggle', id })} />
          <div className="pl-6 text-xs text-muted">{DESC[id].replace('제출처', label)}</div>
        </div>
      ))}
      <p className="m-0 text-xs text-muted">취합할 때 다시 고를 수 있어요. 오류 목록·파일 목록 시트는 항상 들어가요.</p>
    </div>
  );
}
