import type { DataValidation } from 'exceljs';
import type { CellMap, CellValue } from '../meta';

export type Role =
  | 'title' | 'guide' | 'label' | 'header' | 'input' | 'locked-value' | 'row-number'
  | 'example' | 'fixed' | 'auto-header' | 'auto-value' | 'calc';

export type Mark = 'auto-fixed' | 'error' | 'muted' | 'strike';

export interface ModelCell {
  address: string;
  value?: string | number;
  formula?: string;                  // 합계 행·열 등
  role: Role;
  required?: boolean;
  numFmt?: string;
  wrap?: boolean;
  mark?: Mark;                       // aggregate에서 연한 파랑 / 노랑 / 흐리게 / 취소선
  note?: string;                     // 셀 메모 (원래 값, 오류 내용, 출처 등)
  fieldKey?: string;                 // 이 칸이 속한 항목 (미리보기 머리글 클릭 연동용, 엑셀에는 쓰지 않음)
}

export interface SheetModel {
  sheetName: string;
  columns: { width: number }[];
  cells: ModelCell[];                // 값이 있거나 서식이 있는 칸만
  merges: string[];                  // 예: 'A1:E1'
  validations: { address: string; rule: DataValidation }[];  // template에서만
  printArea: string;                 // collect는 ''
  freeze?: { row: number };          // 이 행까지 고정
  cellMap: CellMap;                  // collect는 { printArea: '', blocks: {} } (엑셀 메타에는 넣지 않음)
}

/**
 * 같은 틀 시트를 채울 데이터 (01-contract.md 7절 — 개발자 2와 합의 대상, 계획 K4).
 * 취합 파트는 실제 제출 값으로, 생성 파트 미리보기는 가짜 데이터로 채운다.
 */
export interface AggregateFill {
  autoColumns: string[];             // 오른쪽 자동 칸 이름 순서, 예 ['지사','담당자','출처 파일','원본 줄','상태']
  rows?: {                           // list·header-list: 반영 행
    values: Record<string, CellValue>;
    auto: CellValue[];               // autoColumns 순서
    marks?: { key: string; mark: Mark; note?: string }[];
    muted?: boolean;                 // 숨긴 줄
    strike?: boolean;                // 취소선
  }[];
  matrixSums?: CellValue[][];        // matrix: 칸별 합 [row][col]
  grid?: Record<string, { value: CellValue; note?: string }>;   // fill-in 입력칸 겹친 값
  gridSpare?: { values: CellValue[]; auto: CellValue[] }[];       // fill-in 여유 줄에 추가된 행
}

export type LayoutInput =
  | { mode: 'template'; orgName?: string }                    // 빈 양식
  | { mode: 'aggregate'; info: string; data: AggregateFill }; // 같은 틀 시트
