import { beforeEach, describe, expect, it } from 'vitest';
import { listLocalAggregations, loadAggregations, recordAggregation, removeAggregation, type AggregationSummary } from '../history';

const summary = (title: string): AggregationSummary => ({
  formId: 'f1', formVersion: 2, title, layout: 'matrix', unit: '지사', total: 19, got: 18, missing: ['세종지사'], rows: 0, checked: 2, verifyOk: true,
});

describe('취합 기록 (로컬 모드)', () => {
  beforeEach(() => localStorage.clear());
  it('요약만 저장하고 최근 순으로 돌려준다', async () => {
    recordAggregation(summary('먼저'), new Date('2026-10-08T01:00:00Z'));
    recordAggregation(summary('나중'), new Date('2026-10-14T01:00:00Z'));
    const list = listLocalAggregations();
    expect(list.map((a) => a.title)).toEqual(['나중', '먼저']);
    expect(list[0]).toMatchObject({ missing: ['세종지사'], got: 18, total: 19, synced: true });
    expect(JSON.stringify(list)).not.toMatch(/bytes|xlsx/);
    expect((await loadAggregations()).list).toHaveLength(2);
  });
  it('한 건만 지운다', async () => {
    const a = recordAggregation(summary('남길 것'), new Date('2026-10-08T01:00:00Z'));
    const b = recordAggregation(summary('지울 것'), new Date('2026-10-14T01:00:00Z'));
    const r = await removeAggregation(b.id);
    expect(r.error).toBeUndefined();
    expect(r.list.map((x) => x.id)).toEqual([a.id]);
    expect(listLocalAggregations().map((x) => x.title)).toEqual(['남길 것']);
  });
});
