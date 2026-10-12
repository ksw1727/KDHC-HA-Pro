# 01. 공통 계약 — 생성 파트와 취합 파트의 약속

> 두 개발자 모두가 읽는 문서다. 코드 위치는 `src/contract/`이며 **두 사람의 공동 소유**다.
> 이 문서와 `src/contract/`의 내용이 다르면 **이 문서가 우선**이다. 계약을 바꾸려면 9절의 절차를 따른다.

---

## 1. 계약이 하는 일

```
 생성 파트 ──(FormSchema대로 엑셀 생성 + FileMeta 기록)──► 엑셀 파일 ──(FileMeta 읽기)──► 취합 파트
```

- 생성 파트는 `FormSchema`로 엑셀을 만들고, 파일 안에 `FileMeta`를 숨겨 넣는다.
- 취합 파트는 돌아온 파일의 `FileMeta`만 읽고도 어디서 무엇을 읽어 어떻게 합칠지 알 수 있다.
- 두 파트는 서로의 코드를 import하지 않는다. **공유하는 것은 `src/contract/`뿐이다.**

## 2. `src/contract/` 구성

```
src/contract/
  schema.ts        FormSchema, Block, Field 타입
  meta.ts          FileMeta, CellMap 타입
  metaIO.ts        writeMeta(workbook, meta) / readMeta(workbook) — _meta 시트와 파일 속성 읽기·쓰기
  xlsxPatch.ts     ExcelJS가 지원하지 않는 부분 후처리 (파일 속성 custom.xml, 통합문서 구조 보호)
  checksum.ts      computeChecksum(meta)
  fieldTypes/      항목 타입 정의 (5절) — index.ts에 레지스트리
  aggregationIds.ts 취합 방식 ID 목록 (6절)
  version.ts       CONTRACT_VERSION = 1
  __tests__/
```

## 3. 양식 정의 `FormSchema`

```ts
export type FieldType = 'text' | 'number' | 'date' | 'select' | 'memo';

export interface Field {
  key: string;            // 내부 식별자. 생성 시 자동 발급(예: "f_8k2m"), 이후 절대 변경하지 않음
  label: string;          // 엑셀 머리글로 보이는 이름. 같은 블록 안에서 중복 불가
  type: FieldType;
  required: boolean;
  help?: string;          // 작성 안내. 엑셀 입력 메시지로 표시
  // 타입별 옵션 (해당 타입에서만 의미 있음)
  maxLength?: number;                    // text
  numberFormat?: 'integer' | 'decimal';  // number (기본 integer)
  min?: number; max?: number;            // number
  minDate?: string; maxDate?: string;    // date, 'YYYY-MM-DD'
  options?: string[];                    // select (1개 이상, 중복 불가)
}

export interface FieldsBlock { kind: 'fields'; id: string; title?: string; fields: Field[]; }
export interface ListBlock   { kind: 'list';   id: string; title?: string; columns: Field[]; maxRows: number; }
export interface MatrixBlock {
  kind: 'matrix'; id: string; title?: string;
  rowLabels: string[];     // 예: ['1학년', '2학년']
  colLabels: string[];     // 예: ['남', '여']
  cell: Field;             // 모든 칸에 적용되는 규칙. type은 반드시 'number'
  totalRow: boolean;       // 취합 결과에 합계 행 추가 여부
}
export type Block = FieldsBlock | ListBlock | MatrixBlock;

export type Layout = 'list' | 'matrix' | 'header-list';

export interface FormSchema {
  contractVersion: 1;
  formId: string;          // UUID v4. 양식 동일성 판별 기준
  formVersion: number;     // 1부터 시작. 양식을 수정해 다시 내보낼 때마다 +1
  title: string;
  guide?: string;          // 작성 안내 문구
  deadline?: string;       // 'YYYY-MM-DD'
  contact?: string;        // 문의처
  layout: Layout;
  blocks: Block[];
  aggregations: AggregationId[];   // 기본 선택된 취합 방식. 1개 이상
  org: {
    mode: 'preset' | 'input';
    orgs?: string[];       // preset: 필수(1개 이상). input: 선택(있으면 지사명 칸이 드롭다운)
  };
  createdAt: string;       // ISO 8601
  updatedAt: string;
}
```

**구조별 블록 규칙 (검증 함수 `validateSchema()`로 강제)**

| layout | blocks |
|---|---|
| `list` | `[ListBlock]` |
| `matrix` | `[MatrixBlock]` |
| `header-list` | `[FieldsBlock, ListBlock]` (이 순서) |

- 블록 `id`는 `b1`, `b2`처럼 순서대로 부여한다.
- 지사명 칸은 블록이 아니다. 생성 파트가 자동으로 넣고 위치를 `CellMap.orgCell`에 적는다.

## 4. 파일 메타 `FileMeta`

```ts
export interface FileMeta {
  contractVersion: 1;
  kind: 'submission' | 'aggregate';
  schema: FormSchema;
  generatedAt: string;          // ISO 8601
  checksum: string;             // 4.4절

  // kind = 'submission'일 때
  orgName?: string;             // preset 모드에서 미리 정해진 지사명. input 모드는 없음
  sheetName?: string;           // 입력 시트 이름
  cellMap?: CellMap;

  // kind = 'aggregate'일 때
  aggregate?: {
    includedOrgs: { org: string; sourceFile: string; savedAt: string }[];
    methods: AggregationId[];
    recordsSheet: '_records';   // 4.5절
  };
}

export interface CellMap {
  orgCell: string;              // 지사명 칸 주소, 예: "C4"
  blocks: Record<string, FieldsBlockMap | ListBlockMap | MatrixBlockMap>;  // key = block.id
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
  columns: Record<string, string>;   // key = field.key, 값 = 열 문자 예: "B"
}
export interface MatrixBlockMap {
  kind: 'matrix';
  rowLabelCells: string[];      // rowLabels와 같은 순서
  colLabelCells: string[];      // colLabels와 같은 순서
  cells: string[][];            // [rowIndex][colIndex] = 칸 주소
}
```

### 4.1 `_meta` 시트 저장 형식
- 시트 이름 `_meta`, 상태 `veryHidden`, 통합문서의 **마지막** 시트.
- `A1`에 문자열 `KDHC-META`, `A2`에 `contractVersion` 숫자.
- `FileMeta`를 `JSON.stringify`한 뒤 **30,000자 단위로 잘라** `B1`, `B2`, `B3` … 에 순서대로 넣는다. (엑셀 셀 최대 32,767자)
- 읽을 때는 `B`열을 빈칸이 나올 때까지 이어 붙여 `JSON.parse`한다.

### 4.2 파일 속성(사용자 지정 문서 속성) 이중 기록
`_meta` 시트가 지워져도 최소 식별이 되도록 `docProps/custom.xml`에 다음을 쓴다.

| 속성 이름 | 값 |
|---|---|
| `kdhc.formId` | `schema.formId` |
| `kdhc.formVersion` | `schema.formVersion` |
| `kdhc.kind` | `submission` / `aggregate` |
| `kdhc.org` | `orgName` (있을 때만) |

ExcelJS는 사용자 지정 속성을 지원하지 않으므로 `xlsxPatch.ts`가 **ExcelJS로 만든 xlsx 바이트를 JSZip으로 열어** `docProps/custom.xml`, `[Content_Types].xml`, `_rels/.rels`를 수정한다. 읽을 때도 JSZip으로 `custom.xml`을 직접 파싱한다.

### 4.3 보호
- 입력 시트: 시트 보호. 입력칸만 `locked = false`. 허용 동작: 셀 선택, 서식 없는 입력.
- 통합문서 구조 보호(`<workbookProtection lockStructure="1"/>`): 시트 추가·삭제·숨기기 해제 차단. `xlsxPatch.ts`가 `xl/workbook.xml`에 삽입.
- 보호 비밀번호: 미결정(D2). 기본안은 앱 고정 비밀번호 상수 `PROTECT_PASSWORD`를 `contract/version.ts`에 둔다.

### 4.4 체크섬
- `computeChecksum(meta)` = `SHA-256( canonicalJSON({ kind, schema, orgName, sheetName, cellMap, aggregate }) )`의 16진수 앞 16자.
- canonicalJSON: 객체 키를 알파벳 순으로 정렬한 JSON. 브라우저 `crypto.subtle.digest` 사용.
- 읽을 때 다시 계산해 다르면 메타 변조로 간주한다(취합 파트 처리: 메타 없음과 같이 취급).

### 4.5 취합본의 `_records` 시트
취합본은 **어떤 취합 방식을 골랐든 상관없이** 다시 취합할 수 있도록, 정규화된 원자료를 숨김 시트에 저장한다.
- 시트 이름 `_records`, `veryHidden`.
- 내용: `NormalizedSubmission[]`를 JSON으로 만든 뒤 4.1과 같은 방식(30,000자 단위, `B`열)으로 저장. `A1`은 `KDHC-RECORDS`.

```ts
export type CellValue = string | number | null;   // 날짜는 'YYYY-MM-DD' 문자열

export interface NormalizedSubmission {
  org: string;
  sourceFile: string;
  savedAt: string;                                  // ISO 8601
  header: Record<string, CellValue>;                // fields 블록 값, key = field.key
  rows: Record<string, CellValue>[];                // list 블록의 빈 행 제외 값
  matrix?: CellValue[][];                           // matrix 블록 값 [row][col]
}
```

시트 모으기 결과는 `_records`로 복원하지 않는다. 취합본을 다시 취합할 때 시트 모으기를 고르면, 취합본 안의 지사별 시트를 그대로 복사한다.

## 5. 항목 타입 정의 (`fieldTypes/`)

항목 타입은 **레지스트리**로 관리한다. 새 타입은 파일 하나를 추가하고 `index.ts`에 등록한다.

```ts
export interface FieldTypeDef {
  type: FieldType;
  label: string;                                    // 빌더에 보이는 이름: '텍스트' 등
  // 생성 파트가 사용
  excelValidation(field: Field): ExcelJS.DataValidation | null;
  excelNumFmt(field: Field): string | undefined;    // 예: 날짜 'yyyy-mm-dd'
  // 취합 파트가 사용
  parse(raw: unknown): { value: CellValue; ok: boolean };   // 엑셀 셀 값 → 정규 값
  validate(value: CellValue, field: Field): IssueCode | null; // 필수 여부 제외 규칙 검사
}
export const FIELD_TYPES: Record<FieldType, FieldTypeDef>;

export type IssueCode =
  | 'REQUIRED_EMPTY' | 'TOO_LONG' | 'NOT_NUMBER' | 'NOT_DATE' | 'OUT_OF_RANGE' | 'NOT_IN_OPTIONS';
```

| type | 엑셀 입력 규칙 | parse | validate 실패 코드 |
|---|---|---|---|
| text | 텍스트 길이 ≤ maxLength | 문자열로 변환, 앞뒤 공백 제거 | `TOO_LONG` |
| number | 정수/소수, min~max | 숫자 또는 숫자 모양 문자열 → number | `NOT_NUMBER`, `OUT_OF_RANGE` |
| date | 날짜, minDate~maxDate, 서식 yyyy-mm-dd | Date 또는 엑셀 일련번호 또는 'YYYY-MM-DD'/'YYYY.MM.DD' 문자열 → 'YYYY-MM-DD' | `NOT_DATE`, `OUT_OF_RANGE` |
| select | 드롭다운(options) | 문자열 | `NOT_IN_OPTIONS` |
| memo | 없음, 줄바꿈 서식 | 문자열 | 없음 |

필수 여부(`required`)는 공통 규칙으로 취합 파트가 검사한다(코드 `REQUIRED_EMPTY`).

## 6. 취합 방식 ID (`aggregationIds.ts`)

```ts
export type AggregationId =
  | 'append'             // 행 이어붙이기          — layout: list
  | 'header-append'      // 머리정보 붙여 잇기     — layout: header-list
  | 'spread'             // 지사별 펼치기          — layout: matrix
  | 'collect-sheets'     // 시트 모으기            — 모든 layout
  | 'submission-status'; // 제출 현황표            — 모든 layout

export const AGGREGATION_SUPPORT: Record<AggregationId, Layout[]>;
```

- 생성 파트는 빌더에서 해당 layout이 지원하는 방식만 보여준다.
- "다시 취합"은 취합 방식이 아니라 취합 파트의 **입력 처리 기능**이다(취합본을 넣으면 `_records`를 풀어 일반 제출본처럼 다룬다).
- 새 취합 방식을 추가할 때 이 목록에 ID를 추가하는 것은 계약 변경이다(9절).

## 7. 셀 배치 규칙 (생성 파트가 지키고, 취합 파트는 `CellMap`으로만 읽는다)

취합 파트는 배치 규칙을 가정하지 말고 **반드시 `CellMap`을 사용**한다. 아래는 생성 파트의 기본 배치이며 참고용이다.

```
1행  제목 (A~마지막 열 병합)
2행  작성 안내 · 제출 기한 · 문의처 (병합)
3행  (빈 행)
4행  A: "지사명"  B: 지사명 값 칸
5행  (빈 행)
6행~ 블록들을 위에서 아래로 배치, 블록 사이 빈 행 1개
     fields: 한 행에 [라벨 | 값] 한 쌍
     list:   머리글 행 + maxRows개 입력 행, A열은 번호(잠금)
     matrix: 첫 행 = [빈칸 | 열 제목들], 이후 행 = [행 제목 | 입력칸들]
```

## 8. 테스트용 샘플 파일 (`fixtures/`)

0단계에서 함께 만들고, 2단계에서 실제 생성 파일로 교체한다. 파일명 규칙: `{layout}__{상황}.xlsx`

| 파일 | 내용 |
|---|---|
| `header-list__ok_seoul.xlsx` 외 지사 3개 | 정상 제출본 |
| `header-list__value-error.xlsx` | 필수 빈칸 1, 날짜칸에 글자 1 |
| `header-list__columns-swapped.xlsx` | 목록 열 순서 바뀜, 1개 열 삭제 |
| `header-list__dup_seoul_newer.xlsx` | 서울 중복 제출(저장 시각이 더 늦음) |
| `header-list__meta-deleted.xlsx` | `_meta` 시트 제거, 파일 속성만 남음 |
| `header-list__meta-and-props-deleted.xlsx` | 메타·속성 모두 없음(복사·붙여넣기 상황) |
| `header-list__meta-tampered.xlsx` | 메타 JSON 수정됨(체크섬 불일치) |
| `other-form.xlsx` | 다른 formId |
| `input-mode__unknown-org.xlsx` | input 모드, 목록에 없는 지사명 |
| `list__ok_*.xlsx`, `matrix__ok_*.xlsx` | 구조별 정상본 |
| `aggregate__north.xlsx`, `aggregate__south.xlsx` | 본부 취합본(다시 취합 테스트) |
| `schema__header-list.json` | 위 파일들의 양식 JSON |

## 9. 계약 변경 절차

1. 변경이 필요한 사람이 상대에게 알리고 합의한다.
2. 이 문서를 먼저 고친다.
3. `src/contract/`를 고치고, 하위 호환이 깨지면 `CONTRACT_VERSION`을 올린다.
4. `fixtures/`와 계약 테스트를 함께 갱신한다.
5. 두 사람 모두 확인한 뒤 병합한다.

**LLM 규칙**: 각자의 LLM은 `src/contract/`를 수정하지 않는다. 계약에 없는 정보가 필요하면 작업을 멈추고 사람에게 알린다.

## 10. 0단계 호환성 테스트 체크리스트 (D1)

생성한 파일을 각 프로그램에서 열어 작성·저장한 뒤 다시 읽어 확인한다.

| 확인 항목 | MS Excel | 한셀 | 구글 시트(다운로드) |
|---|---|---|---|
| `_meta` 시트 유지 | | | |
| veryHidden 유지 | | | |
| 사용자 지정 속성 유지 | | | |
| 데이터 유효성 검사 동작 | | | |
| 시트 보호 유지 | | | |
| 날짜 값이 날짜로 저장 | | | |

결과를 이 표에 기록하고, 유지되지 않는 항목은 대응 방안(예: 메타를 숨김 이름 정의에 추가 저장)을 정한다.
