import type { DataValidation } from 'exceljs';
import type { Field, FieldType } from '../schema';
import type { CellValue } from '../meta';

export type IssueCode =
  | 'REQUIRED_EMPTY' | 'TOO_LONG' | 'NOT_NUMBER' | 'NOT_DATE' | 'OUT_OF_RANGE'
  | 'NOT_IN_OPTIONS' | 'BAD_PATTERN' | 'FORMULA_ERROR';

export interface NormalizeResult {
  status: 'ok' | 'auto' | 'proposal' | 'invalid';
  value: CellValue;          // ok·auto: 정리된 값. proposal·invalid: 원래 값(문자열)
  proposal?: CellValue;      // proposal일 때 자동 수정안
  issue?: IssueCode;         // proposal·invalid일 때
}

/** 항목 타입 정의 (01-contract.md 5절). 엑셀 쪽은 개발자 1, normalize는 개발자 2가 채운다. */
export interface FieldTypeDef {
  type: FieldType;
  label: string;                                    // 빌더에 보이는 이름: '텍스트' 등
  // 생성 파트가 사용
  excelValidation(field: Field, today: Date): DataValidation | null;
  excelNumFmt(field: Field): string | undefined;    // 예: '#,##0"개"', 'yyyy-mm-dd', '0'
  // 취합 파트가 사용
  normalize(raw: unknown, field: Field, ctx: { year: number; today: Date }): NormalizeResult;
}

export const notYet = (): never => {
  throw new Error('normalize는 취합 파트(개발자 2)가 구현할 예정이에요');
};
