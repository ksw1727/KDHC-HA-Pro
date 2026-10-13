import type { FieldTypeDef } from './types';
import { notYet } from './types';
import { promptOnly } from './common';

export const memo: FieldTypeDef = {
  type: 'memo',
  label: '메모',
  excelNumFmt: () => '@',
  excelValidation: (field) => promptOnly(field),
  normalize: notYet,
};
