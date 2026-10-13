import type { Field } from '../schema';
import type { FieldTypeDef } from './types';
import { notYet } from './types';
import { messages } from './common';

type P = NonNullable<Field['pattern']>;

export const PATTERN_INFO: Record<P, { label: string; example: string; min: number; max: number }> = {
  phone: { label: '전화번호', example: '02-1234-5678', min: 9, max: 13 },
  mobile: { label: '휴대폰', example: '010-1234-5678', min: 10, max: 13 },
  email: { label: '이메일', example: 'name@example.com', min: 5, max: 254 },
  bizno: { label: '사업자번호', example: '123-45-67890', min: 10, max: 12 },
};

export const pattern: FieldTypeDef = {
  type: 'pattern',
  label: '패턴',
  excelNumFmt: () => '@',   // 010으로 시작하는 번호의 앞자리 0을 지키기 위해 글자 서식
  excelValidation(field) {
    if (!field.pattern) return null;
    const p = PATTERN_INFO[field.pattern];
    return {
      type: 'textLength', operator: 'between', allowBlank: true, formulae: [p.min, p.max],
      ...messages(field, `${p.label} 형식으로 입력하세요 (예: ${p.example})`),
    };
  },
  normalize: notYet,
};
