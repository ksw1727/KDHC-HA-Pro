import type ExcelJS from 'exceljs';
import type { CellValue, FileMeta, NormalizedSubmission, RowFlag } from '@contract/meta';
import type { IssueCode } from '@contract/fieldTypes';
import type { FormSchema } from '@contract/schema';

/** 03-aggregator.md 3.1 내부 데이터 모델 (B단계에서 쓰는 부분) */

export interface LoadedFile {
  id: string;
  fileName: string;
  bytes: Uint8Array;
  lastModified: number;          // 브라우저 File.lastModified (파일 속성 modified가 없을 때만 씀)
}

export type MetaSource = 'meta-sheet' | 'doc-props' | 'header-match' | 'none';

export type FileStatus = 'ok' | 'other-form' | 'unreadable' | 'duplicate-content';

export interface IdentifiedFile {
  file: LoadedFile;
  source: MetaSource;
  kind: 'submission' | 'aggregate' | 'unknown';
  formId?: string;
  formVersion?: number;
  meta?: FileMeta;                 // meta-sheet일 때
  orgFromFile?: string;            // 메타 orgName 또는 파일 속성 kdhc.org (지사명 칸 값은 읽기 단계에서)
  savedAt: string;                 // 문서 속성 modified → 없으면 file.lastModified
  contentHash: string;             // 보이는 시트 값 기준 해시
  status: FileStatus;
  skipReason?: string;             // unreadable·other-form·duplicate-content일 때 화면에 보일 말
  notes: string[];                 // 예: '메타 변조 감지', '양식 버전 다름(v1)'
  workbook?: ExcelJS.Workbook;     // 읽기 단계에서 다시 쓰려고 들고 있음 (unreadable이면 없음)
}

export interface BaseForm {
  schema: FormSchema;
  /** 기준 양식 버전의 칸 지도. 메타가 없는 파일은 이 지도를 빌려 읽는다 */
  meta?: FileMeta;
}

export type ExcludeReason = 'blank' | 'example' | 'total' | 'operator' | 'duplicate';

export interface RawCell {
  raw: unknown;                    // 엑셀 값 그대로 (수식은 결과 값, 오류는 { error })
  address: string;
  comment?: string;                // 작성자가 단 엑셀 메모
  fill?: 'ditto' | 'merged';       // 〃 또는 합친 셀이라 다른 칸 값으로 채움
}

export interface ReadRow {
  cells: Record<string, RawCell>;  // key = field.key (계산 칸 제외)
  sourceRow: number;
  flags: RowFlag[];
}

export type InfoCode =
  | 'COLUMN_MISSING' | 'COLUMNS_REORDERED' | 'HEADER_MOVED' | 'VERSION_MISMATCH' | 'META_TAMPERED' | 'META_MISSING'
  | 'EXTRA_SHEET' | 'TEXT_OUTSIDE_INPUT' | 'FORM_SHEET_MISSING' | 'TOTAL_MISMATCH' | 'LABEL_MOVED'
  | 'FIXED_CELL_CHANGED' | 'IMAGE_NOT_COPIED' | 'OTHER_ORG_CELL' | 'FILTER_CLEARED' | 'EXAMPLE_ROW_USED';

export interface Info {
  code: InfoCode;
  message: string;                 // 화면·결과 파일용 한국어 문장
  address?: string;
}

export interface Question {
  id: string;
  fileId?: string;
  kind: 'column-alias' | 'same-row-twice' | 'grid-conflict' | 'hidden-area';
  message: string;
  choices: { id: string; label: string }[];
  defaultChoice: string;
  fieldKey?: string;               // column-alias·grid-conflict: 어느 항목
  header?: string;                 // column-alias: 파일에 적힌 칸 이름
  sourceRow?: number;              // same-row-twice: 뒤에 나온 같은 줄
}

export interface ReadResult {
  fileId: string;
  sheetName: string;
  org?: string;
  header: Record<string, RawCell>;
  rows: ReadRow[];
  matrices?: Record<string, (RawCell | undefined)[][]>;   // 숫자 표: 블록 id → [row][col] (자유 제작형은 여러 개)
  grid?: Record<string, RawCell>;       // 빈칸채우기 입력칸
  gridSpareRows?: ReadRow[];            // 빈칸채우기 여유 줄
  collectSheets?: string[];             // 시트 모으기: 모을 시트 이름
  excludedRows: { sourceRow: number; reason: ExcludeReason; preview: string }[];
  extraColumns: { header: string; values: { sourceRow: number; value: unknown }[] }[];
  authorNotes: { address: string; fieldKey?: string; sourceRow?: number; text: string }[];
  unreadSheets: string[];
  totalRowChecks: { sourceRow: number; fieldKey: string; written: number; computed: number; label?: string }[];
  infos: Info[];
  questions: Question[];
  /**
   * 작성자가 직접 숨긴 줄·열에 있는 값 (03-aggregator.md 3.3 "모양 속 숨은 뜻").
   * 필터로 가린 줄은 여기 넣지 않고 보통 줄로 읽는다. 값이 있는 곳만 담는다.
   * rows: 숨긴 목록 줄·여유 줄 / slots: 숨긴 열(또는 숨긴 줄의 위쪽 정보·표·입력칸)에 든 값 / extraHeaders: 숨긴 추가 칸
   */
  hiddenArea?: { rows: number[]; cols: string[]; slots: Slot[]; extraHeaders: string[] };
  /** 검산용: 데이터 영역에서 읽은 줄 수 (빈 줄은 글이 있는 줄 사이에 낀 것만 센다) */
  readCount: number;
}

/** 값이 들어 있는 자리: 결정(수정)을 반영할 때 이 자리를 찾아 바꾼다 */
export type Slot =
  | { part: 'header' | 'grid'; key: string }
  | { part: 'row' | 'spare'; key: string; sourceRow: number }
  | { part: 'matrix'; key: string; blockId: string; r: number; c: number };

export interface Issue {
  id: string;
  fileId: string;
  code: IssueCode | InfoCode;
  severity: 'value' | 'info';      // value = 확인할 칸 대상, info = 자동 처리 안내
  sheet: string;
  address?: string;                // 원본 위치 — 수정본 사본에 쓸 때 필요
  location: string;                // 화면용: '목록 7행 수량'
  slot?: Slot;
  fieldLabel?: string;
  raw?: unknown;
  proposal?: CellValue;
  message: string;
}

export interface AutoFix { address: string; slot: Slot; from: unknown; to: CellValue }

/** ③④ 결과: 정리된 값 + 확인할 칸. 결정 전 상태 */
export interface ParsedSubmission extends NormalizedSubmission {
  fileId: string;
  file: IdentifiedFile;
  read: ReadResult;
  issues: Issue[];
  autoFixed: AutoFix[];
  matrices?: Record<string, CellValue[][]>;   // 숫자 표 값: 블록 id → [row][col]
  fromAggregate?: boolean;         // 본부 취합본에서 풀어낸 제출 (②~④ 건너뜀)
}

export interface CellFix { mode: 'proposal' | 'manual' | 'keep'; value?: CellValue }

export interface Decisions {
  cellFix: Record<string, CellFix | undefined>;          // issueId →
  answers: Record<string, string | undefined>;            // questionId →
  excludeFile: Record<string, boolean>;                   // fileId →
  excludeRow: Record<string, boolean>;                    // `${fileId}:${sourceRow}` → [이 줄 빼기]
  duplicateChoice: Record<string, string>;                // org → fileId
  orgLink: Record<string, string>;                        // fileId → org
}

export const emptyDecisions = (): Decisions => ({ cellFix: {}, answers: {}, excludeFile: {}, excludeRow: {}, duplicateChoice: {}, orgLink: {} });
