import type { FieldTypeDef } from './types';
import { notYet } from './types';
import { messages, promptOnly } from './common';

export const text: FieldTypeDef = {
  type: 'text',
  label: '텍스트',
  excelNumFmt: () => '@',
  excelValidation(field) {
    if (!field.maxLength) return promptOnly(field);
    return {
      type: 'textLength', operator: 'lessThanOrEqual', allowBlank: true, formulae: [field.maxLength],
      ...messages(field, `${field.maxLength}자 이내로 입력하세요`),
    };
  },
  normalize: notYet,
};
