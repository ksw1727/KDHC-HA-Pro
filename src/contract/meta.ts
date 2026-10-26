import type { FormSchema } from './schema';
import type { AggregationId } from './aggregationIds';

/** 생성된 엑셀 파일 안에 숨겨 넣는 설계도 사본 (01-contract.md 4절). */
export interface FileMeta {
  contractVersion: 1;
  kind: 'submission' | 'aggregate';
  schema: FormSchema;
  generatedAt: string;          // ISO 8601
  checksum: string;             // 4.4절

  // kind = 'submission'일 때
  orgName?: string;             // preset 모드에서 미리 정해진 지사명. input·none 모드는 없음
  sheetName?: string;           // 입력 시트 이름 (= 양식 제목, 31자 제한·금지문자 치환). collect는 보고서 시트 이름
  cellMap?: CellMap;            // collect는 없음

  // kind = 'aggregate'일 때
  aggregate?: {
    includedSources: { org?: string; sourceFile: string; savedAt: string }[];
    methods: AggregationId[];
    recordsSheet: '_records';   // 4.5절
  };
}

export interface CellMap {
  orgCell?: string;             // 지사명 칸 주소, 예: "B4". org.mode = 'none'이면 없음
  printArea: string;            // 인쇄영역, 예: "A1:F106" (제목 ~ 입력 영역 끝)
  blocks: Record<string, FieldsBlockMap | ListBlockMap | MatrixBlockMap | GridBlockMap>;  // key = block.id
}
export interface FieldsBlockMap {
  kind: 'fields';
  cells: Record<string, { labelCell: string; valueCell: string }>;   // key = field.key
}
export interface ListBlockMap {
  kind: 'list';
  headerRow: number;            // 머리글 행 번호 (1부터)
  firstDataRow: number;
  lastDataRow: number;          // firstDataRow + maxRows - 1
  exampleRow?: number;          // 예시 줄 행 번호 (있을 때)
  columns: Record<string, string>;   // key = field.key, 값 = 열 문자 예: "B"
}
export interface MatrixBlockMap {
  kind: 'matrix';
  rowLabelCells: string[];      // rowLabels와 같은 순서 (취합본은 제출처 줄 순서)
  colLabelCells: string[];      // colLabels와 같은 순서
  cells: string[][];            // [rowIndex][colIndex] = 칸 주소 (취합본은 [제출처 줄][열])
  totalCells?: string[][];      // 취합본만: [원래 행 제목][열] = 그 항목의 '계' 줄 칸 주소
}
export interface GridBlockMap {
  kind: 'grid';
  headerRow: number;
  firstRow: number;             // 본문 첫 행
  columns: string[];            // colLabels 순서대로 열 문자
  inputCells: Record<string, string>;   // key = field.key, 값 = 칸 주소
  fixedCells: Record<string, string | number>;   // 주소 → 고정 값 (변경 감지용)
  spare?: { firstRow: number; lastRow: number };  // 여유 줄 범위
}

export type CellValue = string | number | null;   // 날짜는 'YYYY-MM-DD' / 'YYYY-MM' / 'YYYY' 문자열

export type RowFlag = 'hidden' | 'strike';          // 직접 숨긴 줄(필터로 가린 줄은 보통 줄로 읽음) / 취소선

export interface RowRecord {
  values: Record<string, CellValue>;   // key = field.key
  sourceRow: number;                   // 원본 파일의 행 번호
  flags?: RowFlag[];
}

export interface NormalizedSubmission {
  org?: string;                                     // org.mode = 'none'이면 없음
  sourceFile: string;
  savedAt: string;                                  // ISO 8601
  header: Record<string, CellValue>;                // fields 블록 값, key = field.key
  rows: RowRecord[];                                // list 블록의 반영 행 (제외 행 빼고)
  matrix?: CellValue[][];                           // matrix 블록 값 [row][col]
  grid?: Record<string, CellValue>;                 // grid 입력칸 값 (빈칸은 키 없음)
  gridSpareRows?: RowRecord[];                      // grid 여유 줄에 추가된 행
}
