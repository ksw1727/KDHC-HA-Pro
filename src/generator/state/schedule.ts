import type { FormSchema } from '@contract/schema';

/**
 * 내보내기 ① 일정 정보: 내 업무공간 취합 일정(달력)은 양식의 제출 기한과 내보낸 기록으로 그린다.
 * 기한이 비었거나 이미 지났으면 내보내기 전에 묻는다.
 */
const pad = (n: number) => String(n).padStart(2, '0');
/** 그 지역 날짜를 'YYYY-MM-DD'로 */
export const isoDay = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

export function needsSchedule(s: Pick<FormSchema, 'deadline'>, today: Date): boolean {
  return !s.deadline || s.deadline < isoDay(today);
}

/** 빠른 버튼: 3일 뒤 · 1주 뒤 · 2주 뒤 · 이번 달 말 (오늘이 말일이면 다음 달 말) */
export function quickDeadlines(today: Date): [string, string][] {
  const at = (n: number) => isoDay(new Date(today.getFullYear(), today.getMonth(), today.getDate() + n));
  let end = new Date(today.getFullYear(), today.getMonth() + 1, 0);
  if (isoDay(end) === isoDay(today)) end = new Date(today.getFullYear(), today.getMonth() + 2, 0);
  return [['3일 뒤', at(3)], ['1주 뒤', at(7)], ['2주 뒤', at(14)], ['이번 달 말', isoDay(end)]];
}

/** '2026-10-30' → '10/30(금)' */
export function shortDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  return `${+m[2]}/${+m[3]}(${'일월화수목금토'[new Date(+m[1], +m[2] - 1, +m[3]).getDay()]})`;
}

/** 오늘부터 며칠 */
export function daysFrom(iso: string, today: Date): number {
  const [y, m, d] = iso.split('-').map(Number);
  return Math.round((new Date(y, m - 1, d).getTime() - new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()) / 864e5);
}
