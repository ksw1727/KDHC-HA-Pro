import type { Field } from '../schema';
import type { FieldTypeDef } from './types';
import { notYet } from './types';
import { messages } from './common';

/**
 * 엑셀 드롭다운은 선택지를 "a,b,c" 글자로 넣을 때 255자 제한이 있고 쉼표를 쓸 수 없다.
 * 이 경우 엑셀 쓰기 단계에서 숨김 시트 범위를 참조해야 한다.
 */
export function selectNeedsRange(field: Field): boolean {
  const opts = field.options ?? [];
  return opts.some((o) => o.includes(',') || o.includes('"')) || opts.join(',').length > 250;
}

export const select: FieldTypeDef = {
  type: 'select',
  label: '목록 선택',
  excelNumFmt: () => undefined,
  excelValidation(field) {
    const opts = field.options ?? [];
    if (opts.length === 0) return null;
    return {
      type: 'list', allowBlank: true,
      formulae: [`"${opts.join(',')}"`],
      ...messages(field, `목록에서 고르세요 (${opts.slice(0, 5).join(', ')}${opts.length > 5 ? ' …' : ''})`),
    };
  },
  normalize: notYet,
};
