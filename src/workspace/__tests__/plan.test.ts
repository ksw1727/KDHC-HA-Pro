import { describe, expect, it } from 'vitest';
import type { FormSchema } from '@contract/schema';
import type { StoredForm } from '../../generator/storage/localForms';
import type { AggregationRecord } from '../history';
import { byDeadline, counts, toDay, weekBars, workItems } from '../plan';

const schema = (id: string, over: Partial<FormSchema> = {}): FormSchema => ({
  contractVersion: 1, formId: id, formVersion: 1, title: id, layout: 'list', blocks: [], aggregations: [],
  org: { mode: 'preset', label: '부서', orgs: ['가', '나', '다'] },
  createdAt: '2026-10-15T01:00:00.000Z', updatedAt: '2026-10-15T01:00:00.000Z', ...over,
} as FormSchema);
const stored = (s: FormSchema, exported?: string): StoredForm => ({ schema: s, savedAt: s.updatedAt, lastExported: exported ? { ...s, updatedAt: exported } : undefined });
const agg = (formId: string, doneAt: string, over: Partial<AggregationRecord> = {}): AggregationRecord => ({
  id: formId + doneAt, formId, formVersion: 1, title: formId, layout: 'list', unit: '부서', total: 3, got: 3, missing: [], rows: 9, checked: 0, verifyOk: true, doneAt, ...over,
});

describe('workItems: 취합 전에는 날짜만, 취합하면 기록으로', () => {
  it('내보내지 않은 양식은 내보내기 전, 내보냈고 기록이 없으면 취합 기다림', () => {
    const [a, b] = workItems([stored(schema('a')), stored(schema('b'), '2026-10-16T00:00:00.000Z')], []);
    expect(a.state).toBe('draft');
    expect(b.state).toBe('waiting');
  });
  it('마지막 내보내기 뒤에 취합했으면 끝, 그 전 취합은 지난 요청 것으로 본다', () => {
    const f = stored(schema('a'), '2026-10-16T00:00:00.000Z');
    expect(workItems([f], [agg('a', '2026-10-17T00:00:00.000Z')])[0].state).toBe('done');
    expect(workItems([f], [agg('a', '2026-10-01T00:00:00.000Z')])[0].state).toBe('waiting');
  });
  it('제출 기한과 만든 날은 그 지역 날짜 자정, 제출처 수는 목록 길이 (식별 안 함은 파일)', () => {
    const [i] = workItems([stored(schema('a', { deadline: '2026-10-24' }), '2026-10-16T00:00:00.000Z')], []);
    expect(i.deadline).toEqual(new Date(2026, 9, 24));
    expect(i.total).toBe(3);
    expect(i.unit).toBe('부서');
    const [n] = workItems([stored(schema('n', { org: { mode: 'none' } } as Partial<FormSchema>))], []);
    expect(n.unit).toBe('파일');
    expect(n.total).toBeNull();
  });
});

describe('counts', () => {
  const today = new Date(2026, 9, 22);   // 목요일
  const items = workItems([
    stored(schema('week', { deadline: '2026-10-24' }), '2026-10-16T00:00:00.000Z'),
    stored(schema('late', { deadline: '2026-10-20' }), '2026-10-16T00:00:00.000Z'),
    stored(schema('next', { deadline: '2026-10-28' }), '2026-10-16T00:00:00.000Z'),
    stored(schema('none'), '2026-10-16T00:00:00.000Z'),
  ], []);
  it('이번 주(토요일까지) 기한, 지난 기한, 기한 없음', () => {
    expect(counts(items, [agg('x', '2026-10-09T03:00:00.000Z'), agg('y', '2026-09-30T03:00:00.000Z')], today))
      .toEqual({ waiting: 4, dueThisWeek: 1, overdue: 1, noDeadline: 1, doneThisMonth: 1 });
  });
  it('기다리는 양식은 기한 가까운 순, 기한 없는 양식은 뒤로', () => {
    expect([...items].sort(byDeadline).map((i) => i.schema.formId)).toEqual(['late', 'week', 'next', 'none']);
  });
});

describe('weekBars: 만든 날 → 제출 기한을 주마다 잘라 그린다', () => {
  const items = workItems([stored(schema('a', { createdAt: '2026-10-15T01:00:00.000Z', deadline: '2026-10-24' }), '2026-10-16T00:00:00.000Z')], []);
  it('시작 주는 목요일부터 토요일 끝까지, 다음 주는 일요일부터 기한까지', () => {
    expect(weekBars(items, new Date(2026, 9, 11))).toMatchObject([{ from: 4, to: 6, starts: true, ends: false }]);
    expect(weekBars(items, new Date(2026, 9, 18))).toMatchObject([{ from: 0, to: 6, starts: false, ends: true }]);
    expect(weekBars(items, new Date(2026, 9, 25))).toEqual([]);
  });
  it('기한이 없으면 만든 날 하루, 내보내기 전 양식은 그리지 않는다', () => {
    const one = workItems([stored(schema('b'), '2026-10-16T00:00:00.000Z'), stored(schema('c'))], []);
    expect(weekBars(one, new Date(2026, 9, 11))).toMatchObject([{ from: 4, to: 4, starts: true, ends: true }]);
  });
  it('날짜 문자열 해석', () => {
    expect(toDay('2026-10-24')).toEqual(new Date(2026, 9, 24));
    expect(toDay('엉터리')).toBeUndefined();
  });
});
