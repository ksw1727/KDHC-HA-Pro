# 01. 공통 계약 — 생성 파트와 취합 파트의 약속

> 두 개발자 모두가 읽는 문서다. 코드 위치는 `src/contract/`이며 **두 사람의 공동 소유**다.
> 이 문서와 `src/contract/`의 내용이 다르면 **이 문서가 우선**이다. 계약을 바꾸려면 10절의 절차를 따른다.

---

## 1. 계약이 하는 일

```
 생성 파트 ──(FormSchema대로 엑셀 생성 + FileMeta 기록)──► 엑셀 파일 ──(FileMeta 읽기)──► 취합 파트
      └──────────── 같은 틀 레이아웃(src/contract/layout) 공유 ────────────┘
```

- 생성 파트는 `FormSchema`로 엑셀을 만들고, 파일 안에 `FileMeta`를 숨겨 넣는다.
- 취합 파트는 돌아온 파일의 `FileMeta`만 읽고도 어디서 무엇을 읽어 어떻게 합칠지 알 수 있다. **생성 화면 상태에 의존하지 않는다** → 다른 PC·다른 날에도 회신 파일만 있으면 취합할 수 있다.
- **빈 양식과 취합본 첫 시트는 같은 틀**이어야 하므로, 시트 배치·서식을 만드는 레이아웃 엔진을 계약에 두고 두 파트가 함께 쓴다(7절).
- 두 파트는 서로의 코드를 import하지 않는다. **공유하는 것은 `src/contract/`뿐이다.**

## 2. `src/contract/` 구성

```
src/contract/
  schema.ts        FormSchema, Block, Field 타입, validateSchema()
  meta.ts          FileMeta, CellMap, NormalizedSubmission 타입
  metaIO.ts        writeMeta(workbook, meta) / readMeta(workbook) — _meta 시트와 파일 속성 읽기·쓰기
  recordsIO.ts     writeRecords / readRecords — _records 시트
  xlsxPatch.ts     ExcelJS가 지원하지 않는 부분 후처리 (파일 속성 custom.xml)
  checksum.ts      computeChecksum(meta)
  fieldTypes/      항목 타입 정의 (5절) — index.ts에 레지스트리
  layout/          같은 틀 레이아웃 엔진 (7절) — layoutEngine.ts, sheetModel.ts, styles.ts
  aggregationIds.ts 취합 방식 ID 목록 (6절)
  version.ts       CONTRACT_VERSION = 1, PROTECT_PASSWORD
  __tests__/
```

`layout/`은 개발자1이 1단계에서 작성하고, 이후 변경은 계약 변경 절차(10절)를 따른다.

## 3. 양식 정의 `FormSchema`

```ts
export type FieldType = 'text' | 'number' | 'date' | 'select' | 'memo' | 'pattern' | 'calc';

export interface Field {
  key: string;            // 내부 식별자. 생성 시 자동 발급(예: "f_8k2m"), 이후 절대 변경하지 않음
  label: string;          // 엑셀 머리글로 보이는 이름. 같은 블록 안에서 중복 불가
  type: FieldType;
  required: boolean;
  help?: string;          // 작성 안내. 엑셀 입력 메시지로 표시

  // ── 서식 (해당 타입에서만 의미 있음) ──
  maxLength?: number;                         // text
  decimals?: number;                          // number. 0 = 정수(기본), 1~4 = 소수 자릿수
  thousands?: boolean;                        // number. 천 단위 쉼표 표시 (기본 true)
  unit?: string;                              // number. 표시 단위, 예: '개', '원', '명', '%'
  min?: number; max?: number;                 // number
  dateFormat?: 'yyyy-mm-dd' | 'yyyy.mm.dd' | 'yyyy-mm' | 'yyyy';   // date (기본 yyyy-mm-dd). 'yyyy' = 연도
  minDate?: string; maxDate?: string;         // date. 'YYYY-MM-DD' 또는 상대값 'today', 'today+30', 'today-7'
  options?: string[];                         // select (1개 이상, 중복 불가)
  pattern?: 'phone' | 'mobile' | 'email' | 'bizno';   // pattern (필수)
  formula?: string;                           // calc (필수). 칸 이름으로 쓴 계산식 (3.1절)
}

export interface FieldsBlock { kind: 'fields'; id: string; title?: string; fields: Field[]; }

export interface ListBlock {
  kind: 'list'; id: string; title?: string;
  columns: Field[];
  maxRows: number;               // 입력 줄 수 (기본 100, D3)
  exampleRow?: Record<string, string | number>;   // 첫 줄 회색 예시(선택). key = field.key
}

export interface MatrixBlock {
  kind: 'matrix'; id: string; title?: string;
  rowLabels: string[];     // 예: ['1학년', '2학년']
  colLabels: string[];     // 예: ['남', '여']
  cell: Field;             // 모든 칸에 적용되는 규칙. type은 반드시 'number'
  totalRow: boolean;       // 합계 행 표시 여부 (빈 양식에는 수식, 취합본에는 값)
  totalCol: boolean;       // 합계 열(계) 표시 여부
  calcRows?: Field[];      // 계산 행 (type 'calc'). 표 아래, 합계 행 다음
  calcCols?: Field[];      // 계산 열 (type 'calc'). 표 오른쪽, 계 열 다음
}

/** 빈칸채우기형: 본사가 채운 표 + 빈 입력칸. 모두에게 같은 표를 보내고 채운 칸을 겹쳐 합친다. */
export type GridCell =
  | { kind: 'fixed'; value: string | number }   // 본사가 미리 채운 고정 내용 (잠금)
  | { kind: 'input'; field: Field }             // 작성자가 채우는 칸 (field.key는 블록 안에서 유일)
  | { kind: 'calc'; field: Field }              // 계산 칸 (type 'calc', 잠금)
  | { kind: 'blank' };                          // 아무것도 아닌 빈칸 (잠금)

export interface GridBlock {
  kind: 'grid'; id: string; title?: string;
  colLabels: string[];        // 머리글 행. 빈 문자열 허용
  rows: GridCell[][];         // [row][col], 길이 = colLabels.length
  spareRows: number;          // 표 아래 여유 줄 수. 0이면 줄 추가 불가
  spareColumns?: Field[];     // 여유 줄의 열 규칙. spareRows > 0이면 필수, 길이 = colLabels.length
}

export type Block = FieldsBlock | ListBlock | MatrixBlock | GridBlock;

export type Layout = 'list' | 'matrix' | 'header-list' | 'fill-in' | 'collect' | 'free';

/** 자유 제작형 그리는 판 (3.2절). layout = 'free'일 때만 쓴다. 판 주소는 판 왼쪽 위가 A1 */
export interface FreeSpec {
  rows: number; cols: number;           // 판 크기 (영역이 더 크면 영역 끝까지)
  texts: Record<string, string>;        // 판 주소 → 글자 칸 (잠김)
  merges: string[];                     // 판 범위, 글자 칸끼리만 합친다
  places: Record<string, string>;       // 놓인 자리: fields 항목 key → 판 주소, list·matrix 블록 id → 왼쪽 위 판 주소
}

/** 시트 모으기형 설정. layout = 'collect'일 때만 쓴다. */
export interface CollectSpec {
  scope: 'report' | 'all';          // 취합 때 모을 시트. 'report'(기본) = 보고서 시트만, 'all' = 파일 안의 보이는 시트 전부
  starter?: (string | number | null)[][];   // 시트 시작 모양: 4행부터 넣을 제작한 양식(빌더에서 그린 표). 없으면 빈 시트. 글자 칸 = 제목 칸, null = 작성 자리
}

export interface FormSchema {
  contractVersion: 1;
  formId: string;          // UUID v4. 양식 동일성 판별 기준
  formVersion: number;     // 1부터 시작. 칸 구조를 바꿔 다시 내보낼 때마다 +1
  title: string;
  guide?: string;          // 작성 안내 문구 (예: "11월 5일까지 회신")
  deadline?: string;       // 'YYYY-MM-DD'
  contact?: string;        // 문의처
  layout: Layout;
  blocks: Block[];                 // collect는 빈 배열
  collect?: CollectSpec;           // layout = 'collect'일 때 필수
  free?: FreeSpec;                 // layout = 'free'일 때 필수
  aggregations: AggregationId[];   // 기본 선택된 취합 방식. 필수 방식(requiredAggregations)은 항상 포함
  org: {
    mode: 'preset' | 'input' | 'none';
    orgs?: string[];       // preset: 필수(1개 이상). input: 선택(있으면 지사명 칸이 드롭다운). none: 사용 안 함
    label?: string;        // 제출처를 부르는 말. 기본 '지사'. 예: '부서', '기관'. 엑셀 칸 이름("부서명")·화면·결과 시트 머리글에 쓴다
  };
  createdAt: string;       // ISO 8601
  updatedAt: string;
}
```

**구조별 블록 규칙 (검증 함수 `validateSchema()`로 강제)**

| layout | 이름 | blocks |
|---|---|---|
| `list` | 목록형 | `[ListBlock]` |
| `matrix` | 표형 | `[MatrixBlock]` |
| `header-list` | 혼합형 | `[FieldsBlock, ListBlock]` (이 순서) |
| `fill-in` | 빈칸채우기형 | `[GridBlock]` |
| `collect` | 시트 모으기형 | `[]` (블록 없음, `collect` 설정 사용) |
| `free` | 자유 제작형 | `fields`(0~1개, 맨 앞)·`list`·`matrix`를 개수 제한 없이. `free` 설정 필수, 모든 항목·블록에 놓인 자리(`places`) 필요 |

- 블록 `id`는 `b1`, `b2`처럼 순서대로 부여한다.
- `collect`는 `org.mode`로 `preset`·`none`만 쓸 수 있다(`input`은 지사명 칸을 읽어야 하는데 자유 서식이라 칸 위치가 보장되지 않음). `collect` 설정은 필수다.
- `collect`는 칸 규칙이 없는 자유 서식이다. 제출처마다 시트 모양이 달라도 되며, 취합은 시트를 그대로 복사해 한 파일에 모은다. 칸 단위 검증·값 정리·검산을 하지 않는다.
- 이 문서와 화면의 "지사"는 `org.label`로 바뀌어 보인다(예: "부서명", "부서별 시트").
- 지사명 칸은 블록이 아니다. `org.mode`가 `preset`·`input`이면 생성 파트가 자동으로 넣고 위치를 `CellMap.orgCell`에 적는다. `none`이면 지사명 칸이 없다(파일 하나 = 응답 하나).
- `fill-in`의 `input` 칸이 1개 이상이거나 `spareRows > 0`이어야 한다.

### 3.2 자유 제작형 (`free.ts`)

운영자가 판에 표 모양을 직접 그리고(글자 칸·합친 칸), 작성자가 채울 곳을 세 가지로 지정한다. **입력 영역은 기존 블록으로 저장**하므로 셀 지도(`CellMap`)는 다른 구조와 같은 모양이고, 취합 파트의 값 읽기·검산은 그대로 쓴다.

| 판에서 지정 | 저장 | 셀 지도 | 판 위 크기 |
|---|---|---|---|
| 입력 칸 (한 칸에 값 하나) | `fields` 블록의 항목 | `FieldsBlockMap` (labelCell = 왼쪽 글자 칸, 없으면 위쪽, 없으면 값 칸) | 1칸 |
| 입력 줄 영역 (머리글 + 여러 줄) | `list` 블록 (번호 열 없음) | `ListBlockMap` | 머리글 1행 + `maxRows`행 × 칸 수 |
| 숫자 표 (열 제목 × 행 제목) | `matrix` 블록 | `MatrixBlockMap` | 기존 표형과 같음 (왼쪽 위 = 빈칸) |

- **엑셀 배치**: 1~2행 제목·안내, 4행 제출처 줄은 다른 구조와 같다. 판 A1은 제출처 줄이 있으면 **6행**, 없으면 **4행**(`freeTop`)의 A열에 놓인다. 글자 칸은 `label` 스타일로 잠긴다. 판 영역 전체가 인쇄영역이다.
- **영역 계산**: `freeRegions(schema)`가 영역마다 판 좌표 사각형을 돌려준다. 공통 문제(`freeProblems`): 영역 없음, 영역끼리 겹침, 영역 안 글자 칸, 영역에 걸친 합친 칸.
- **취합 검사** (`freeAggregationChecks`, 화면 ④와 내보내기 전 검사가 같이 쓴다):

| 방식 | 가능 조건 | 결과 모양 |
|---|---|---|
| 같은 틀 시트 (필수) | 입력 줄 영역 **0~1개**, 줄 영역의 **아래와 오른쪽**(머리글·입력 줄 행)에는 다른 영역·글자 칸이 없음 (늘어나는 줄·자동 칸이 덮어쓰기 때문) | 줄 영역이 있으면 혼합형 규칙: 줄이 이어지고 입력 칸 값·`지사`·출처가 줄마다 오른쪽 자동 칸. 없으면 입력 칸 자리에 "(지사별 시트 참고)"(흐리게). 숫자 표는 칸끼리 합계 |
| 지사별 펼치기 | 입력 칸이나 숫자 표가 있음 | 제출당 1행: 입력 칸들 + 숫자 표 `{행제목} {열제목}` + (줄 영역 있으면) `목록 행 수` |
| 시트 모으기·제출 현황표 | 항상 (현황표는 지사를 식별할 때) | 다른 구조와 같음 |

- **필수 방식** (`requiredAggregations`): `same-frame` + 줄 영역이 없는데 입력 칸이나 숫자 표가 있으면 `spread`(입력 칸 값이 모이는 곳).
- 숫자 표가 여러 개일 수 있으므로 `AggregateFill.matrixSumsBy`(블록 id → 칸별 합)를 쓴다. 없으면 `matrixSums`.
- 버전: 놓인 자리·합친 칸이 바뀌면 칸 구조 변경으로 보고 `formVersion`을 올린다(셀 지도가 달라지므로). 글자 칸 내용만 바뀌면 유지.

### 3.1 계산 칸 (`formula/`)

계산 칸(`type: 'calc'`)은 작성자가 입력하지 않고 **엑셀 수식으로 계산**되는 잠긴 칸이다. 계산식 엔진은 `src/contract/formula/` 하나를 두 파트가 함께 쓴다.

**계산식 문법** — 칸은 이름으로 쓴다: `[여] ÷ ([남] + [여]) × 100`
- 연산: `+ - × ÷ ( )` (`* /`도 됨), 비교 `>= > <= < = <>`, 숫자, 글자 `"적합"`. 계산식 안에서는 천 단위 쉼표를 쓰지 않는다.
- 함수(한글·영문 둘 다): `합계/SUM`, `평균/AVERAGE`, `최소/MIN`, `최대/MAX`(여러 값, 빈칸 건너뜀), `반올림/ROUND(값, 자릿수)`(엑셀처럼 0에서 먼 쪽), `조건/IF(비교, 맞을 때, 아닐 때)`
- 저장은 사람이 읽는 글자 그대로. 항목 이름을 바꾸면 빌더가 계산식 안의 이름도 바꾼다.

**쓸 수 있는 이름 (`scopeFor`)**

| 계산 칸 위치 | 쓸 수 있는 이름 | 엑셀 수식 |
|---|---|---|
| 목록 열 | 같은 목록의 다른 칸(같은 줄), 위쪽 정보 항목(고정 칸) | 같은 줄 주소, 위쪽 정보는 `$B$6` |
| 위쪽 정보 항목 | 다른 위쪽 정보 항목, 목록 칸(**합계·평균·최소·최대 안에서만**, 열 전체) | 목록 칸은 `D10:D109` 범위 |
| 표형 계산 열 | 열 제목, `계`(합계 열), 다른 계산 열 | 행마다 같은 행 주소. 합계 행·계산 행에도 같은 식 |
| 표형 계산 행 | 행 제목, `합계`(합계 행), 다른 계산 행 | 열마다 같은 열 주소 |
| 빈칸채우기 계산 칸 | 입력·계산 칸 이름, 숫자 고정 칸 `{행 첫 칸} · {열 머리글}` | 그 칸 주소 |
| 빈칸채우기 여유 줄 계산 열 | 다른 여유 줄 열 이름(같은 줄) | 같은 줄 주소 |

- 엑셀 수식은 `IFERROR(…,"")`로 감싼다(0으로 나누기·빈칸이면 빈칸). 셀 메모에 `계산: {계산식}`을 단다.
- 검사(`validateSchema`·`formulaErrors`): 문법, 없는 이름, 자기 자신, 계산 칸끼리 순환, 합계 안에서만 쓸 목록 칸.
- **취합본은 계산 칸을 읽지 않고, 합친 입력값으로 다시 계산한다**(`computeListRow`, `computeHeader`, `computeMatrix`, `computeGrid`, `computeSpareRow`). 비율처럼 지사 값을 더하면 틀리는 값이 있기 때문이다. 표형 합계 행의 계산 열 값은 합계 행 값으로 다시 계산한다.

## 4. 파일 메타 `FileMeta`

```ts
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
  rowLabelCells: string[];      // rowLabels와 같은 순서
  colLabelCells: string[];      // colLabels와 같은 순서
  cells: string[][];            // [rowIndex][colIndex] = 칸 주소
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
```

### 4.1 `_meta` 시트 저장 형식
- 시트 이름 `_meta`, 상태 `veryHidden`, 통합문서의 **마지막** 시트.
- `A1`에 문자열 `KDHC-META`, `A2`에 `contractVersion` 숫자.
- `FileMeta`를 `JSON.stringify`한 뒤 **30,000자 단위로 잘라** `B1`, `B2`, `B3` … 에 순서대로 넣는다. (엑셀 셀 최대 32,767자)
- 읽을 때는 `B`열을 빈칸이 나올 때까지 이어 붙여 `JSON.parse`한다.
- 빈 양식·회신 파일·취합본 모두 `_meta`를 가진다. 생성 파트는 **빈 양식이나 취합본을 올리면 `_meta`로 양식 정의를 복원**할 수 있다.

### 4.2 파일 속성(사용자 지정 문서 속성) 이중 기록
`_meta` 시트가 지워져도 최소 식별이 되도록 `docProps/custom.xml`에 다음을 쓴다.

| 속성 이름 | 값 |
|---|---|
| `kdhc.formId` | `schema.formId` |
| `kdhc.formVersion` | `schema.formVersion` |
| `kdhc.kind` | `submission` / `aggregate` |
| `kdhc.org` | `orgName` (있을 때만) |

ExcelJS는 사용자 지정 속성을 지원하지 않으므로 `xlsxPatch.ts`가 **ExcelJS로 만든 xlsx 바이트를 JSZip으로 열어** `docProps/custom.xml`, `[Content_Types].xml`, `_rels/.rels`를 수정한다. 읽을 때도 JSZip으로 `custom.xml`을 직접 파싱한다.

> 참고: 문서 속성 `created`(생성 시각)는 템플릿 생성 시각이 복사되어 모든 회신이 같으므로 최신 판단에 쓰지 않는다. **`modified`(마지막 저장 시각)**를 쓴다.

### 4.3 보호
- 입력 시트: 시트 보호. 입력칸(목록 입력 줄, 값 칸, 표 칸, 빈칸채우기 입력칸·여유 줄)만 `locked = false`. 허용 동작: 셀 선택, 서식 없는 입력.
- **통합문서 구조 보호는 넣지 않는다**(모든 구조, 2026-10-13 개발자 2 의견으로 결정). 작성자가 계산이 필요하면 새 시트를 추가해 쓸 수 있어야 하기 때문이다. 그래서 생기는 일은 취합 파트가 처리한다: 양식 시트 이름이 바뀌면 `_meta.sheetName` → 머리글 일치율 순으로 찾고, 추가한 시트는 "읽지 않은 시트"로 기록하며, 양식 시트를 지운 파일은 "양식 시트가 없어요"로 제외한다. `_meta`는 veryHidden이라 엑셀 메뉴로 숨김 해제가 안 된다. (`xlsxPatch.ts`의 `lockStructure` 옵션은 남겨 두되 쓰지 않는다.)
- 칸 안에 글로 적는 메모는 받지 않는다. 작성자 메모는 **엑셀 메모(말풍선)만** 받는다(`00-overview.md` M20). 입력칸 밖(인쇄영역 밖 포함)은 모두 잠겨 있다.
- 시트 보호에서 `objects`(메모 등 개체)는 잠그지 않는다. 작성자가 입력칸에 엑셀 메모를 달 수 있어야 한다.
- 보호 비밀번호: 미결정(D2). 기본안은 앱 고정 비밀번호 상수 `PROTECT_PASSWORD`를 `contract/version.ts`에 둔다.
- **`collect`(시트 모으기형)는 시트 보호도 넣지 않는다.** 엑셀은 보호된 시트에서 셀 합치기를 막기 때문이다(`scope: 'all'`이면 제출처가 시트를 추가해 쓴다). 제출처 식별은 `_meta`(veryHidden이라 엑셀 메뉴에 보이지 않음)와 파일 속성으로만 한다. 1~2행의 제목·제출처명은 안내용이며 고쳐도 취합에 영향이 없다.

### 4.4 체크섬
- `computeChecksum(meta)` = `SHA-256( canonicalJSON({ kind, schema, orgName, sheetName, cellMap, aggregate }) )`의 16진수 앞 16자.
- canonicalJSON: 객체 키를 알파벳 순으로 정렬한 JSON. 브라우저 `crypto.subtle.digest` 사용.
- 읽을 때 다시 계산해 다르면 메타 변조로 간주한다(취합 파트 처리: 메타 없음과 같이 취급).

### 4.5 취합본의 `_records` 시트
취합본은 **어떤 취합 방식을 골랐든 상관없이** 다시 취합할 수 있도록, 정규화된 원자료(수정 반영 후)를 숨김 시트에 저장한다.
- 시트 이름 `_records`, `veryHidden`.
- 내용: `NormalizedSubmission[]`를 JSON으로 만든 뒤 4.1과 같은 방식(30,000자 단위, `B`열)으로 저장. `A1`은 `KDHC-RECORDS`.

```ts
export type CellValue = string | number | null;   // 날짜는 'YYYY-MM-DD' / 'YYYY-MM' / 'YYYY' 문자열

export type RowFlag = 'hidden' | 'strike';          // 숨긴 줄(필터 포함) / 취소선

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
```

시트 모으기 결과는 `_records`로 복원하지 않는다. 취합본을 다시 취합할 때 시트 모으기를 고르면, 취합본 안의 지사별 시트를 그대로 복사한다. `collect` 양식의 취합본은 `_records`가 비어 있고(`[]`), 다시 취합하면 취합본 안의 제출처별 시트를 `aggregate.includedSources` 순서대로 복사한다.

## 5. 항목 타입과 서식 (`fieldTypes/`)

항목 타입은 **레지스트리**로 관리한다. 새 타입은 파일 하나를 추가하고 `index.ts`에 등록한다.
**생성 시 정한 서식이 곧 취합 시 정리 기준이다.** 엑셀 입력 규칙(생성)과 값 정리(취합)를 같은 파일에 둬서 둘이 어긋나지 않게 한다.

```ts
export interface FieldTypeDef {
  type: FieldType;
  label: string;                                    // 빌더에 보이는 이름: '텍스트' 등
  // 생성 파트가 사용
  excelValidation(field: Field, today: Date): ExcelJS.DataValidation | null;
  excelNumFmt(field: Field): string | undefined;    // 예: '#,##0"개"', 'yyyy-mm-dd', '0'
  // 취합 파트가 사용
  normalize(raw: unknown, field: Field, ctx: { year: number; today: Date }): NormalizeResult;
}

export interface NormalizeResult {
  status: 'ok' | 'auto' | 'proposal' | 'invalid';
  value: CellValue;          // ok·auto: 정리된 값. proposal·invalid: 원래 값(문자열)
  proposal?: CellValue;      // proposal일 때 자동 수정안
  issue?: IssueCode;         // proposal·invalid일 때
}
// ok       = 그대로 맞음
// auto     = 확실한 정리 (원래 값은 셀 메모로 남김, 연한 파란색)
// proposal = 애매함 → 오류로 보고하고 자동 수정안 제시
// invalid  = 수정안 없음 → 오류, 운영자가 직접 수정하거나 그대로 둠

export const FIELD_TYPES: Record<FieldType, FieldTypeDef>;

export type IssueCode =
  | 'REQUIRED_EMPTY' | 'TOO_LONG' | 'NOT_NUMBER' | 'NOT_DATE' | 'OUT_OF_RANGE'
  | 'NOT_IN_OPTIONS' | 'BAD_PATTERN' | 'FORMULA_ERROR';
```

**타입별 엑셀 입력 규칙과 값 정리 규칙**

| type | 서식 옵션 | 엑셀 입력 규칙 (생성) | auto (확실) | proposal (수정안) | invalid |
|---|---|---|---|---|---|
| text | maxLength | 텍스트 길이 ≤ maxLength | 앞뒤 공백·줄바꿈 제거 | — | `TOO_LONG` |
| number | decimals, thousands, unit, min, max | 정수/소수, min~max, 표시 서식 `#,##0.00"단위"` | `1,000개`→1000, `₩5,000`→5000, `15%`→15, 숫자 모양 문자열 | `약 10`→10, `다섯`→5, 자릿수 초과(`3.456`, decimals 2)→3.46 | `10~20` 등 (`NOT_NUMBER`), 범위 밖 (`OUT_OF_RANGE`) |
| date | dateFormat, minDate, maxDate | 날짜, 범위, 표시 서식 | `2026.11.1`, `2026/11/01`, `11월 1일`, `11/1`(연도 없으면 취합 연도), 엑셀 날짜 숫자 → 형식대로. 연도형: `2026년`→2026 | 연도형 `26`→2026 | 해석 불가 (`NOT_DATE`), 범위 밖 (`OUT_OF_RANGE`) |
| select | options | 드롭다운 | 공백·대소문자 차이 → 목록 값 | 목록에 없는 비슷한 값(`notebook`→`노트북` 등 편집거리·포함관계) → 후보 | 그 외 (`NOT_IN_OPTIONS`) |
| memo | — | 없음, 줄바꿈 서식 | 앞뒤 공백 제거 | — | — |
| pattern | pattern | 텍스트 길이 제한 + 입력 메시지 | 전화 `0212345678`→`02-1234-5678`, 휴대폰 `01012345678`→`010-1234-5678`, 사업자 `1234567890`→`123-45-67890`, 이메일 앞뒤 공백·도메인 소문자 | — | 자릿수·형식·사업자번호 검증 실패 (`BAD_PATTERN`) |

- 공통: 엑셀 오류 값(`#N/A`, `#REF!` 등) → `invalid`, `FORMULA_ERROR`, 값은 빈칸 처리. 수식 칸은 결과 값을 사용한다.
- 필수 여부(`required`)는 공통 규칙으로 취합 파트가 검사한다(코드 `REQUIRED_EMPTY`). 수정안 없음.
- 상대 날짜(`today+30`)는 생성 시점 기준으로 엑셀 입력 규칙을 만들고, 취합 시에는 취합 시점 기준으로 검사한다.

## 6. 취합 방식 ID (`aggregationIds.ts`)

```ts
export type AggregationId =
  | 'same-frame'         // 같은 틀 시트        — collect를 뺀 모든 layout, 항상 포함
  | 'spread'             // 지사별 펼치기       — matrix(항상 포함), header-list, fill-in, free(조건부 필수, 3.2)
  | 'collect-sheets'     // 시트 모으기         — 모든 layout. collect는 항상 포함(목차 시트 포함)
  | 'submission-status'; // 제출 현황표         — org.mode가 preset·input일 때

export const AGGREGATION_SUPPORT: Record<AggregationId, Layout[]>;
export const AGGREGATION_REQUIRED: Record<Layout, AggregationId[]>;
// list·header-list·fill-in: ['same-frame'] / matrix: ['same-frame', 'spread'] / collect: ['collect-sheets'] / free: ['same-frame']
export function requiredAggregations(schema): AggregationId[];   // free는 모양에 따라 spread 추가 (3.2). 필수 판단은 이 함수로 한다
```

- 생성 파트는 빌더에서 해당 layout이 지원하는 방식만 보여주고, 필수 방식은 체크 해제할 수 없게 한다.
- "다시 취합"은 취합 방식이 아니라 취합 파트의 **입력 처리 기능**이다(취합본을 넣으면 `_records`를 풀어 일반 제출본처럼 다룬다).
- 새 취합 방식을 추가할 때 이 목록에 ID를 추가하는 것은 계약 변경이다(10절).

## 7. 같은 틀 레이아웃 (`layout/`)

빈 양식과 취합본 첫 시트(같은 틀 시트)를 **같은 엔진**으로 만든다. 따로 만들면 모양이 어긋난다.

```ts
// src/contract/layout/layoutEngine.ts — 순수 함수
export function layoutSheet(schema: FormSchema, input: LayoutInput, opts: { today: Date }): SheetModel;   // today: 상대 날짜 입력 규칙용

type LayoutInput =
  | { mode: 'template'; orgName?: string }                    // 빈 양식
  | { mode: 'aggregate'; info: string; data: AggregateFill }; // 같은 틀 시트 (취합 파트가 data를 채워 호출)

interface SheetModel {
  sheetName: string;
  columns: { width: number }[];
  cells: ModelCell[];                // 값이 있거나 서식이 있는 칸만
  merges: string[];                  // 예: 'A1:E1'
  validations: { address: string; rule: ExcelJS.DataValidation }[];  // template에서만
  printArea: string;
  freeze?: { row: number };
  cellMap: CellMap;
}
interface ModelCell {
  address: string;
  value?: string | number;
  formula?: string;                  // 합계 행·열 등
  role: 'title' | 'guide' | 'label' | 'header' | 'input' | 'locked-value' | 'row-number'
      | 'example' | 'fixed' | 'auto-header' | 'auto-value' | 'calc';
  required?: boolean;
  numFmt?: string;
  wrap?: boolean;
  mark?: 'auto-fixed' | 'error' | 'muted' | 'strike';   // aggregate에서 연한 파랑 / 노랑 / 흐리게 / 취소선
  note?: string;                     // 셀 메모 (원래 값, 오류 내용, 출처 등)
}
```

- `role`별 스타일 표(`styles.ts`) 하나를 생성 미리보기·빈 양식·같은 틀 시트가 공유한다.
- `AggregateFill`의 구체 모양(행 목록, 합계 값, 자동 칸 값)은 `03-aggregator.md` 3.7과 맞춰 `layout/sheetModel.ts`에 정의한다.

### 7.1 기본 배치 (생성 파트가 지키고, 취합 파트는 `CellMap`으로만 읽는다)

취합 파트는 배치 규칙을 가정하지 말고 **반드시 `CellMap`을 사용**한다. 아래는 참고용이다.

```
1행  제목 (A~마지막 열 병합)                         ← 시트 이름 = 양식 제목
2행  정보칸 (병합)   빈 양식: 작성 안내 · 제출 기한 · 문의처
                    같은 틀 시트: 취합일 · 파일 수 · 오류 수 · 검산 결과
3행  (빈 행)
4행  A: "지사명"  B: 지사명 값 칸                    ← org.mode = 'none'이면 4~5행 없음
5행  (빈 행)
6행~ 블록들을 위에서 아래로 배치, 블록 사이 빈 행 1개
     fields: 한 행에 [라벨 | 값] 한 쌍
     list:   머리글 행 + (예시 줄) + maxRows개 입력 행, A열은 번호(잠금)
     matrix: 첫 행 = [빈칸 | 열 제목들 (| 계)], 이후 행 = [행 제목 | 입력칸들 (| 계)], (합계 행)
     grid:   머리글 행 + 본문 행(고정/입력/빈칸) + spareRows개 여유 줄
인쇄영역 = 1행 ~ 입력 영역 마지막 행, A ~ 마지막 열. 입력칸 밖(인쇄영역 밖 포함)은 잠겨 있어 작성자가 글을 적을 수 없다. 작성자 메모는 엑셀 메모로만 받는다.
```

### 7.2 같은 틀 시트 규칙 (구조별)

| layout | 같은 틀 시트 모양 | 오른쪽 끝 자동 칸 |
|---|---|---|
| list | 양식과 같은 머리글, 입력 줄 자리에 모든 반영 행 | `지사`(org 사용 시), `출처 파일`, `원본 줄`, `상태` |
| header-list | 위쪽 머리정보 칸은 비우고 "(줄별 자동 칸 참고)", 목록 칸 위치는 양식 그대로 | `지사`, **머리정보 항목들**(줄마다 반복), `출처 파일`, `원본 줄`, `상태` |
| matrix | 양식과 같은 표에 **모든 제출의 합계** | 없음 (지사별 값은 `spread` 시트, 항상 포함) |
| fill-in | 양식과 같은 표에 **모든 제출을 겹쳐 채움**, 여유 줄 자리에 추가된 행 전부 | 여유 줄에만 `지사`, `출처 파일`, `원본 줄`. 입력칸 출처는 셀 메모 |
| collect | 같은 틀 시트 없음. 첫 시트는 **목차**(`03-aggregator.md` 3.7) | — |
| free | 판 모양 그대로. 줄 영역 자리에 모든 반영 행, 숫자 표는 합계, 입력 칸은 줄 영역이 있으면 "(줄별 자동 칸 참고)", 없으면 "(지사별 시트 참고)" (3.2) | 줄 영역이 있을 때만, **줄 영역 오른쪽**에: `지사`, 입력 칸 항목들, `출처 파일`, `원본 줄`, `상태` |

**`collect` 빈 양식 배치**: 1행 제목, 2행 `{org.label}명`(값)·작성 안내·기한·문의처(org.mode = 'none'이면 제출처명 없이 안내만), 3행 빈 행, 4행부터 `starter` 표(없으면 빈칸). 잠금·입력 규칙·인쇄영역 없음. `layoutSheet(schema, { mode: 'template' })`가 이 모양을 돌려준다.

- 자동 칸은 **양식 칸 오른쪽 끝**에 붙여 원래 열 위치를 유지한다. 머리글 색으로 자동 칸임을 구분한다(`auto-header`).
- 같은 틀 시트는 시트 보호·입력 규칙을 넣지 않는다. 인쇄영역 = 제목 ~ 마지막 줄.

## 8. 테스트용 샘플 파일 (`fixtures/`)

0단계에서 함께 만들고, 2단계에서 실제 생성 파일로 교체한다. 파일명 규칙: `{layout}__{상황}.xlsx`
개발자2 프로토타입의 `selfcheck.js` 회신 세트를 옮겨 `messy__*`로 둔다.

| 파일 | 내용 |
|---|---|
| `header-list__ok_seoul.xlsx` 외 지사 3개 | 정상 제출본 |
| `header-list__value-error.xlsx` | 필수 빈칸 1, 날짜칸에 글자 1 |
| `header-list__columns-swapped.xlsx` | 목록 열 순서 바뀜, 1개 열 삭제 |
| `header-list__dup_seoul_newer.xlsx` | 서울 중복 제출(저장 시각이 더 늦음) |
| `header-list__meta-deleted.xlsx` | `_meta` 시트 제거, 파일 속성만 남음 |
| `header-list__meta-and-props-deleted.xlsx` | 메타·속성 모두 없음(새 파일에 복사·붙여넣기) |
| `header-list__meta-tampered.xlsx` | 메타 JSON 수정됨(체크섬 불일치) |
| `other-form.xlsx` | 다른 formId |
| `input-mode__unknown-org.xlsx` | input 모드, 목록에 없는 지사명 |
| `none-mode__a.xlsx`, `none-mode__a_copy.xlsx`, `none-mode__b.xlsx` | 식별 안 함 모드, 내용 완전 동일 파일 포함 |
| `list__ok_*.xlsx`, `matrix__ok_*.xlsx` | 구조별 정상본 |
| `fill-in__ok_*.xlsx` 3개 | 빈칸채우기형, 서로 다른 칸을 채움 + 여유 줄 추가 |
| `fill-in__conflict.xlsx` | 다른 파일과 같은 칸에 다른 값, 고정 칸 수정 |
| `messy__hidden-strike-merge.xlsx` | 숨긴 줄, 필터로 가린 줄, 취소선, 합친 셀, `〃` |
| `messy__units-dates.xlsx` | `1,000개`, `₩5,000`, `2026.11.1`, `11/1`, `약 10`, `#REF!` |
| `messy__total-example.xlsx` | 예시 줄 미삭제, 합계 줄, **입력칸에 메모처럼 적은 줄**(데이터로 읽히고 필수 빈칸으로 확인할 칸에 떠야 함) |
| `messy__notes-extra-sheet.xlsx` | 입력칸에 단 **엑셀 메모** 2개(취합본 같은 칸과 `메모` 시트에 옮겨져야 함), 작성자가 추가한 **계산용 시트**(읽지 않고 파일목록에 기록), 양식 시트 이름 변경 |
| `messy__unprotected-copy.xlsx` | 메타 없이 새 파일에 복사(보호 없음), 표 아래·오른쪽에 적은 글(데이터로 섞이지 않고 `info`로 기록) |
| `messy__extra-column.xlsx` | 양식에 없는 칸 추가, 칸 이름 공백 차이 |
| `aggregate__north.xlsx`, `aggregate__south.xlsx` | 본부 취합본(다시 취합 테스트) |
| `collect__ok_seoul.xlsx` 외 2개 | 시트 모으기형. 서로 다른 모양: 기본 틀에 줄 추가 / 셀 합치기·줄바꿈 문단 / 시트 추가("사진") + 파일 이름 변경 |
| `collect__meta-deleted.xlsx` | 시트 모으기형, 새 파일에 복사(메타·속성 없음) → 제외되어야 함 |
| `collect__not-moa.xlsx` | 한난MOA로 만들지 않은 일반 엑셀 → 제외되어야 함 |
| `schema__header-list.json` 외 구조별 | 위 파일들의 양식 JSON |

## 9. 0단계 호환성 테스트 체크리스트 (D1)

생성한 파일을 각 프로그램에서 열어 작성·저장한 뒤 다시 읽어 확인한다.

| 확인 항목 | MS Excel | 한셀 | 구글 시트(다운로드) |
|---|---|---|---|
| `_meta` 시트 유지 | | | |
| veryHidden 유지 | | | |
| 사용자 지정 속성 유지 | | | |
| 문서 속성 `modified` 갱신 | | | |
| 인쇄영역 유지 | | | |
| 데이터 유효성 검사 동작 | | | |
| 시트 보호 유지 | | | |
| 보호된 양식 시트에서 엑셀 메모 넣기 (엑셀: 새 메모 / 메모) | | | |
| 넣은 엑셀 메모가 저장 후 남아 있음 (ExcelJS로 읽힘) | | | |
| 새 시트 추가 가능 | | | |
| 날짜 값이 날짜로 저장 | | | |
| 숫자 표시 서식(단위·쉼표) 유지 | | | |

결과를 이 표에 기록하고, 유지되지 않는 항목은 대응 방안(예: 메타를 숨김 이름 정의에 추가 저장, 인쇄영역 없으면 `CellMap` 범위 사용)을 정한다.

## 10. 계약 변경 절차

1. 변경이 필요한 사람이 상대에게 알리고 합의한다.
2. 이 문서를 먼저 고친다.
3. `src/contract/`를 고치고, 하위 호환이 깨지면 `CONTRACT_VERSION`을 올린다.
4. `fixtures/`와 계약 테스트를 함께 갱신한다.
5. 두 사람 모두 확인한 뒤 병합한다.

**LLM 규칙**: 각자의 LLM은 `src/contract/`를 수정하지 않는다. 계약에 없는 정보가 필요하면 작업을 멈추고 사람에게 알린다.
