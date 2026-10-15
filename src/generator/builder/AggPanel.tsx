import { availableAggregations, requiredAggregations, type AggregationId } from '@contract/aggregationIds';
import { aggregationLabel, unitLabel } from '@contract/schema';
import { freeAggregationChecks, type AggCheck } from '@contract/free';
import type { Builder } from '../state/useBuilder';
import { Button, Checkbox, cx } from '../ui/ui';

const DESC: Record<AggregationId, string> = {
  'same-frame': '빈 양식과 같은 모양에 모든 값을 담은 첫 시트',
  spread: '제출처마다 한 줄로 펼친 시트',
  'collect-sheets': '제출처별 시트를 그대로 모은 시트들',
  'submission-status': '제출·미제출·제외 현황',
};

const STATUS: Record<AggCheck['status'], { icon: string; text: string; cls: string }> = {
  ok: { icon: '✓', text: '가능', cls: 'text-[#2f7a3b]' },
  fix: { icon: '!', text: '고치면 됨', cls: 'text-warn-ink' },
  no: { icon: '✕', text: '이 양식으론 안 됨', cls: 'text-err-ink' },
};

/** ④ 취합 방식: 이 양식에서 쓸 수 있는 것만, 필수는 잠금. 자유 제작형은 방식마다 취합 가능 검사 (02-generator.md 2.7) */
export function AggPanel({ b, onGoto }: { b: Builder; onGoto?: (c: AggCheck) => void }) {
  const s = b.schema;
  const req = requiredAggregations(s);
  const label = unitLabel(s);
  const checks = s.layout === 'free' ? new Map(freeAggregationChecks(s).map((c) => [c.id, c])) : null;
  return (
    <div className="flex flex-col gap-2">
      {availableAggregations(s).map((id) => {
        const c = checks?.get(id);
        const on = s.aggregations.includes(id);
        return (
          <div key={id} className={cx(c && on && c.status === 'fix' && 'rounded-box border border-[#f1d2ac] bg-[#fffcf7] p-1.5', c && on && c.status === 'no' && 'rounded-box border border-[#f3c2bd] bg-[#fffafa] p-1.5')}>
            <div className="flex items-center gap-2">
              <Checkbox checked={on} disabled={req.includes(id)} locked={req.includes(id)}
                label={<b className="font-semibold">{aggregationLabel(s, id)}</b>}
                onChange={() => b.act({ type: 'agg/toggle', id })} />
              {c && <span className={cx('ml-auto text-xs font-bold', STATUS[c.status].cls)}>{STATUS[c.status].icon} {STATUS[c.status].text}</span>}
            </div>
            {c ? (
              <div className="pl-6 text-xs">
                <div className={on ? 'text-sub' : 'text-muted'}>{c.why}</div>
                {c.fix && on && (
                  <div className="mt-1 flex flex-wrap items-center gap-1.5">
                    <span className="text-ink">→ {c.fix}</span>
                    {c.at && onGoto && <Button size="sm" onClick={() => onGoto(c)}>고치러 가기</Button>}
                    {!req.includes(id) && <Button size="sm" variant="ghost" onClick={() => b.act({ type: 'agg/toggle', id })}>방식 빼기</Button>}
                  </div>
                )}
              </div>
            ) : (
              <div className="pl-6 text-xs text-muted">{DESC[id].replace('제출처', label)}</div>
            )}
          </div>
        );
      })}
      <p className="m-0 text-xs text-muted">취합할 때 다시 고를 수 있어요. 오류 목록·파일 목록 시트는 항상 들어가요.</p>
    </div>
  );
}
