import { useState, type DragEvent, type ReactNode } from 'react';
import { availableAggregations, requiredAggregations, type AggregationId } from '@contract/aggregationIds';
import { aggregationLabel, orgLabel, unitLabel, type FormSchema, type ListBlock } from '@contract/schema';
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

/** 고른 취합 방식을 한 문장으로: "한 표로 모으고, 지사마다 한 줄로도 펼치고, 제출 현황도 만들어요" */
export function aggSentence(ids: AggregationId[], label: string): string {
  const parts = [
    ids.includes('same-frame') && '한 표로 모으고',
    ids.includes('spread') && `${label}마다 한 줄로도 펼치고`,
    ids.includes('collect-sheets') && `${label}별 시트를 그대로 모으고`,
    ids.includes('submission-status') && '제출 현황도 만들고',
  ].filter(Boolean) as string[];
  if (!parts.length) return '고른 방식이 없어요';
  const last = parts.length - 1;
  parts[last] = parts[last].replace(/고$/, '').replace(/모으$/, '모아').replace(/펼치$/, '펼쳐').replace(/만들$/, '만들어') + '요';
  return parts.join(', ');
}

/** 취합본 열 순서에서 제출처 칸 자리: 0 = 맨 앞(번호 다음), n = 맨 뒤(항목 다 지난 뒤) */
export function orgSlot(b: ListBlock): number {
  if (b.orgAfter === undefined) return b.columns.length;
  if (b.orgAfter === '') return 0;
  const i = b.columns.findIndex((c) => c.key === b.orgAfter);
  return i < 0 ? b.columns.length : i + 1;
}
const slotPatch = (b: ListBlock, p: number) => ({ orgAfter: p <= 0 ? '' : p >= b.columns.length ? null : b.columns[p - 1].key });
export const orgPlaceText = (b: ListBlock): string => {
  const p = orgSlot(b);
  return p === 0 ? '맨 앞' : p >= b.columns.length ? '맨 뒤' : `${b.columns[p - 1].label} 다음`;
};

/**
 * 취합본 열 순서 띠: 제출처 칸(초록)을 ◀ ▶나 끌어서 옮긴다. 빈 양식에는 없는 칸이고, 취합본의 같은 틀 시트에만 그 자리에 생긴다.
 * 혼합형의 위쪽 항목(담당자 등)은 제출처 칸 바로 뒤에 같이 붙는다 (01-contract.md ListBlock.orgAfter).
 */
function OrgColumnOrder({ b, list }: { b: Builder; list: ListBlock }) {
  const s: FormSchema = b.schema;
  const label = orgLabel(s);
  const p = orgSlot(list);
  const n = list.columns.length;
  const header = s.blocks.find((x) => x.kind === 'fields');
  const followers = header?.kind === 'fields' ? header.fields.map((f) => f.label || '항목') : [];
  const move = (to: number) => b.act({ type: 'list/set', blockId: list.id, patch: slotPatch(list, Math.max(0, Math.min(n, to))) });
  const [drag, setDrag] = useState(false);
  const drop = (to: number) => (e: DragEvent) => { e.preventDefault(); setDrag(false); move(to); };
  const over = (e: DragEvent) => { if (drag) e.preventDefault(); };
  const chip = 'rounded-[6px] border px-1.5 py-0.5 text-[11.5px] leading-[18px]';
  const items: ReactNode[] = [];
  const org = (
    <span key="org" draggable onDragStart={(e) => { setDrag(true); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', 'org'); }} onDragEnd={() => setDrag(false)}
      title="끌어서 옮기기" className={cx(chip, 'cursor-grab border-[#a8d8c4] bg-auto font-bold text-auto-ink')}>⋮⋮ {label}</span>
  );
  const follow = followers.map((f, i) => <span key={`fw${i}`} className={cx(chip, 'border-[#cfe7dc] bg-[#f2faf6] text-auto-ink')}>{f}</span>);
  items.push(<span key="no" onDragOver={over} onDrop={drop(0)} className={cx(chip, 'border-line bg-chip text-muted')}>번호</span>);
  for (let i = 0; i <= n; i++) {
    if (i === p) items.push(org, ...follow);
    if (i < n) items.push(<span key={list.columns[i].key} onDragOver={over} onDrop={drop(i + 1 > p ? i + 1 : i)} className={cx(chip, 'border-line bg-white text-sub', drag && 'border-dashed border-auto-ink/40')}>{list.columns[i].label || `${i + 1}번째 항목`}</span>);
  }
  return (
    <div className="rounded-box border border-pri-line bg-[#fbfdf9] p-2.5">
      <div className="mb-1.5 flex items-center gap-1.5 text-[12.5px] font-bold">취합본 열 순서 <span className="font-normal text-muted">· {label} 칸 {orgPlaceText(list)}</span></div>
      <div className="flex flex-wrap gap-1" aria-label={`취합본 열 순서, ${label} 칸 ${orgPlaceText(list)}`}>{items}</div>
      <div className="mt-2 flex items-center gap-1.5">
        <Button size="sm" aria-label={`${label} 칸 왼쪽으로`} disabled={p <= 0} onClick={() => move(p - 1)}>◀</Button>
        <Button size="sm" aria-label={`${label} 칸 오른쪽으로`} disabled={p >= n} onClick={() => move(p + 1)}>▶</Button>
        <span className="text-xs text-muted">{label} 칸을 옮겨요 · 끌어서 옮겨도 돼요{followers.length ? ` · 위쪽 항목(${followers.slice(0, 2).join('·')}${followers.length > 2 ? '…' : ''})도 바로 뒤에 같이 붙어요` : ''}</span>
      </div>
      <p className="m-0 mt-1 text-[11.5px] text-muted">{label}에 보내는 빈 양식에는 이 칸이 없고, 취합하면 줄마다 {label} 이름이 이 자리에 들어가요.</p>
    </div>
  );
}

/** ④ 취합 방식: 평소에는 한 문장 요약 + [바꾸기]. 펼치면 이 양식에서 쓸 수 있는 것만, 필수는 잠금. 자유 제작형은 방식마다 취합 가능 검사 (02-generator.md 2.7) */
export function AggPanel({ b, onGoto }: { b: Builder; onGoto?: (c: AggCheck) => void }) {
  const s = b.schema;
  const req = requiredAggregations(s);
  const label = unitLabel(s);
  const checks = s.layout === 'free' ? new Map(freeAggregationChecks(s).map((c) => [c.id, c])) : null;
  const [open, setOpen] = useState(false);
  // 목록형·혼합형 + 제출처 식별: 취합본에서 제출처 칸 자리를 정할 수 있다
  const list = (s.layout === 'list' || s.layout === 'header-list') && s.org.mode !== 'none' ? (s.blocks.find((x) => x.kind === 'list') as ListBlock | undefined) : undefined;
  // 자유 제작형에서 고친 방식이 문제가 있으면 접지 않는다
  const trouble = !!checks && s.aggregations.some((id) => checks.get(id) && checks.get(id)!.status !== 'ok');
  if (!open && !trouble) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <span className="min-w-0 flex-1">{aggSentence(s.aggregations, label)}{list && s.aggregations.includes('same-frame') && <span className="text-muted"> · {orgLabel(s)} 칸 {orgPlaceText(list)}</span>}</span>
        <Button size="sm" onClick={() => setOpen(true)}>바꾸기</Button>
      </div>
    );
  }
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
            {id === 'same-frame' && on && list && <div className="mt-1.5 pl-6"><OrgColumnOrder b={b} list={list} /></div>}
          </div>
        );
      })}
      <div className="flex items-center gap-2">
        <p className="m-0 flex-1 text-xs text-muted">취합할 때 다시 고를 수 있어요. 오류·파일 목록은 검토 파일에 따로 들어가요.</p>
        {!trouble && <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>접기</Button>}
      </div>
    </div>
  );
}
