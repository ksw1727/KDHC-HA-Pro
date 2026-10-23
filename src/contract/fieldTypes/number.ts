import type { Field } from '../schema';
import type { FieldTypeDef } from './types';
import { notYet } from './types';
import { messages, numText } from './common';

/** 최소·최대를 정하지 않은 숫자칸의 엑셀 입력 규칙 한도 (취합도 같은 한도로 검사) */
export const NUMBER_LIMIT = 999_999_999_999;
const LIMIT = NUMBER_LIMIT;

/** 숫자 표시 서식: 쉼표(기본 켬) · 소수 자릿수 · 단위. 단위는 글자로 붙인다(15 → "15%"). */
export function numberFormat(field: Field): string {
  const decimals = Math.max(0, Math.min(4, field.decimals ?? 0));
  let fmt = field.thousands === false ? '0' : '#,##0';
  if (decimals > 0) fmt += '.' + '0'.repeat(decimals);
  const unit = field.unit?.trim();
  if (unit) fmt += `"${unit.replace(/"/g, '')}"`;
  return fmt;
}

function rangeText(field: Field): string {
  const kind = (field.decimals ?? 0) > 0 ? `소수 ${field.decimals}자리까지의 숫자` : '정수';
  const { min, max } = field;
  if (min != null && max != null) return `${numText(min)} 이상 ${numText(max)} 이하의 ${kind}를 입력하세요`;
  if (min != null) return `${numText(min)} 이상의 ${kind}를 입력하세요`;
  if (max != null) return `${numText(max)} 이하의 ${kind}를 입력하세요`;
  return `${kind}를 입력하세요`;
}

export const number: FieldTypeDef = {
  type: 'number',
  label: '숫자',
  excelNumFmt: numberFormat,
  excelValidation(field) {
    const type = (field.decimals ?? 0) > 0 ? 'decimal' : 'whole';
    const { min, max } = field;
    const base = { type, allowBlank: true, ...messages(field, rangeText(field)) } as const;
    if (min != null && max != null) return { ...base, operator: 'between', formulae: [min, max] };
    if (min != null) return { ...base, operator: 'greaterThanOrEqual', formulae: [min] };
    if (max != null) return { ...base, operator: 'lessThanOrEqual', formulae: [max] };
    return { ...base, operator: 'between', formulae: [-LIMIT, LIMIT] };
  },
  normalize: notYet,
};
