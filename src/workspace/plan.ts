import { orgLabel, type FormSchema } from '@contract/schema';
import type { StoredForm } from '../generator/storage/localForms';
import type { AggregationRecord } from './history';

/**
 * 내 업무공간에 보일 양식 상태.
 * 누가 냈는지는 취합해야 알 수 있으므로, 취합 전에는 날짜(만든 날·제출 기한)와 제출처 수만 쓴다.
 * - draft: 아직 엑셀로 내보내지 않음
 * - waiting: 내보냈고, 그 뒤로 취합 기록이 없음
 * - done: 마지막으로 내보낸 뒤 취합한 기록이 있음
 */
export type WorkState = 'draft' | 'waiting' | 'done';

export interface WorkItem {
  entry: StoredForm;
  schema: FormSchema;
  state: WorkState;
  made: Date;                 // 만든 날 (자정)
  deadline?: Date;            // 제출 기한 (자정). 비워 둔 양식은 없음
  unit: string;
  total: number | null;       // 제출처 목록 수
  aggs: AggregationRecord[];  // 이 양식의 취합 기록 (최근 순)
}

export const DAY = 864e5;
export function midnight(d: Date): Date { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
/** 'YYYY-MM-DD'(제출 기한)나 ISO 시각을 그 지역 날짜 자정으로 */
export function toDay(s: string): Date | undefined {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  const d = m ? new Date(+m[1], +m[2] - 1, +m[3]) : new Date(s);
  return Number.isNaN(d.getTime()) ? undefined : midnight(d);
}
export function dayDiff(a: Date, b: Date): number { return Math.round((midnight(a).getTime() - midnight(b).getTime()) / DAY); }

export function orgCount(schema: FormSchema): number | null {
  return schema.org.mode === 'preset' || (schema.org.orgs?.length ?? 0) > 0 ? (schema.org.orgs?.length ?? 0) : null;
}

export function workItems(forms: StoredForm[], aggs: AggregationRecord[]): WorkItem[] {
  return forms.map((entry) => {
    const schema = entry.schema;
    const mine = aggs.filter((a) => a.formId === schema.formId);
    const exportedAt = entry.lastExported?.updatedAt ?? '';
    const state: WorkState = !entry.lastExported ? 'draft' : mine.some((a) => a.doneAt >= exportedAt) ? 'done' : 'waiting';
    return {
      entry, schema, state, aggs: mine,
      made: toDay(schema.createdAt) ?? toDay(entry.savedAt) ?? midnight(new Date()),
      deadline: schema.deadline ? toDay(schema.deadline) : undefined,
      unit: schema.org.mode === 'none' ? '파일' : orgLabel(schema),
      total: orgCount(schema),
    };
  });
}

/** 기다리는 양식: 기한 가까운 순, 기한 없는 양식은 뒤로 */
export function byDeadline(a: WorkItem, b: WorkItem): number {
  if (a.deadline && b.deadline) return a.deadline.getTime() - b.deadline.getTime();
  if (a.deadline || b.deadline) return a.deadline ? -1 : 1;
  return b.made.getTime() - a.made.getTime();
}

export interface Counts { waiting: number; dueThisWeek: number; overdue: number; doneThisMonth: number; noDeadline: number }

export function counts(items: WorkItem[], aggs: AggregationRecord[], today: Date): Counts {
  const t = midnight(today);
  const weekEnd = new Date(t.getTime() + (6 - t.getDay()) * DAY);   // 이번 주 토요일
  const waiting = items.filter((i) => i.state === 'waiting');
  return {
    waiting: waiting.length,
    dueThisWeek: waiting.filter((i) => i.deadline && i.deadline >= t && i.deadline <= weekEnd).length,
    overdue: waiting.filter((i) => i.deadline && i.deadline < t).length,
    noDeadline: waiting.filter((i) => !i.deadline).length,
    doneThisMonth: aggs.filter((a) => { const d = new Date(a.doneAt); return d.getFullYear() === t.getFullYear() && d.getMonth() === t.getMonth(); }).length,
  };
}

/** 달력 한 주에 그릴 막대: 만든 날 → 제출 기한 (기한 없으면 만든 날 하루) */
export interface Bar { item: WorkItem; from: number; to: number; starts: boolean; ends: boolean }

export function weekBars(items: WorkItem[], weekStart: Date): Bar[] {
  const ws = midnight(weekStart), we = new Date(ws.getTime() + 6 * DAY);
  const out: Bar[] = [];
  for (const item of items) {
    if (item.state === 'draft') continue;
    const r = item.made, e = item.deadline && item.deadline >= r ? item.deadline : r;
    if (e < ws || r > we) continue;
    const a = r < ws ? ws : r, b = e > we ? we : e;
    out.push({ item, from: dayDiff(a, ws), to: dayDiff(b, ws), starts: a.getTime() === r.getTime(), ends: b.getTime() === e.getTime() });
  }
  return out.sort((x, y) => x.item.made.getTime() - y.item.made.getTime() || x.from - y.from);
}
