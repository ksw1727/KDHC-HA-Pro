import type { Field } from '../schema';
import type { FieldTypeDef } from './types';
import { notYet } from './types';
import { fmtKoDate, messages, resolveDate } from './common';

export const DATE_EXAMPLE: Record<NonNullable<Field['dateFormat']>, string> = {
  'yyyy-mm-dd': '2026-11-01',
  'yyyy.mm.dd': '2026.11.01',
  'yyyy-mm': '2026-11',
  yyyy: '2026',
};

export const date: FieldTypeDef = {
  type: 'date',
  label: '날짜',
  excelNumFmt(field) {
    const f = field.dateFormat ?? 'yyyy-mm-dd';
    return f === 'yyyy' ? '0' : f;
  },
  excelValidation(field, today) {
    const fmt = field.dateFormat ?? 'yyyy-mm-dd';
    const lo = resolveDate(field.minDate, today);
    const hi = resolveDate(field.maxDate, today);
    if (fmt === 'yyyy') {
      const a = lo?.getUTCFullYear() ?? 1900;
      const b = hi?.getUTCFullYear() ?? 9999;
      return { type: 'whole', operator: 'between', allowBlank: true, formulae: [a, b], ...messages(field, `연도 4자리를 입력하세요 (예: 2026)`) };
    }
    const example = DATE_EXAMPLE[fmt];
    let rule = `날짜를 입력하세요 (예: ${example})`;
    if (lo && hi) rule = `${fmtKoDate(lo)} ~ ${fmtKoDate(hi)} 사이 날짜를 입력하세요 (예: ${example})`;
    else if (lo) rule = `${fmtKoDate(lo)} 이후 날짜를 입력하세요 (예: ${example})`;
    else if (hi) rule = `${fmtKoDate(hi)} 이전 날짜를 입력하세요 (예: ${example})`;
    return {
      type: 'date', operator: 'between', allowBlank: true,
      formulae: [lo ?? new Date(Date.UTC(1900, 0, 1)), hi ?? new Date(Date.UTC(9999, 11, 31))],
      ...messages(field, rule),
    };
  },
  normalize: notYet,
};
