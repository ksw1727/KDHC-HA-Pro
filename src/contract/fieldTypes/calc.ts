import type { FieldTypeDef } from './types';
import { numberFormat } from './number';

/** 계산 칸: 엑셀 수식이 들어가고 잠긴다. 입력 규칙 없음, 숫자 서식(쉼표·소수·단위)은 결과에 적용. 취합 때는 읽지 않고 다시 계산한다. */
export const calc: FieldTypeDef = {
  type: 'calc',
  label: '계산',
  excelNumFmt: numberFormat,
  excelValidation: () => null,
  normalize: (raw) => ({ status: 'ok', value: typeof raw === 'number' || typeof raw === 'string' ? raw : null }),
};
