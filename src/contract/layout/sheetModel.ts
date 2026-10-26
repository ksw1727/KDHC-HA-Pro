import type { DataValidation } from 'exceljs';
import type { CellMap, CellValue } from '../meta';
import type { Field } from '../schema';

export type Role =
  | 'title' | 'guide' | 'label' | 'header' | 'input' | 'locked-value' | 'row-number'
  | 'example' | 'fixed' | 'auto-header' | 'auto-value' | 'calc'
  | 'other-input';   // 빈칸채우기: 다른 제출처가 채우는 칸 (이 파일에서는 잠금)

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
  matrixSumsBy?: Record<string, CellValue[][]>;   // 자유 제작형처럼 숫자 표가 여러 개일 때: 블록 id → 칸별 합 (없으면 matrixSums)
  grid?: Record<string, { value: CellValue; note?: string }>;   // fill-in 입력칸 겹친 값
  gridSpare?: { values: CellValue[]; auto: CellValue[] }[];       // fill-in 여유 줄에 추가된 행
  stackedBy?: Record<string, StackedRows>;        // 블록 id → 제출처별로 그대로 쌓은 줄 (시트 맨 아래에 붙는다)
}

/**
 * 합계·대표값 하나만 남는 자리(숫자 표, 여러 곳이 같은 칸을 채운 빈칸채우기)의 원래 내용.
 * 같은 틀 시트 맨 아래에 '제출처별 …' 블록으로 그대로 쌓아, 결과 파일만 봐도 누가 무엇을 냈는지 남는다.
 */
export interface StackedRows {
  title: string;                                  // 블록 제목, 예 '지사별 적어 낸 값 — 분기별 점검 건수'
  columns: { header: string; field?: Field }[];   // 첫 열은 제출처(식별 안 하면 출처 파일). field = 그 열의 숫자·날짜 서식
  rows: CellValue[][];
}

export type LayoutInput =
  | { mode: 'template'; orgName?: string; shared?: boolean }  // 빈 양식. shared = preset 양식의 공용 파일 (제출처명을 목록에서 고름)
  | { mode: 'aggregate'; info: string; data: AggregateFill }; // 같은 틀 시트
