# 03. 취합 파트 — 검증과 취합 (개발자 2)

> 함께 읽을 문서: `00-overview.md`, `01-contract.md`
> 담당 코드: `src/aggregator/`
> 금지: `src/generator/` import, `src/contract/` 단독 수정
> 개발 첫날부터 `fixtures/`의 샘플 파일로 개발·테스트한다(생성 파트 완성을 기다리지 않는다).

---

## 1. 이 파트가 하는 일

작성자가 돌려준 엑셀 파일(또는 본부 취합본)을 받아 **식별 → 해석 → 검증 → 운영자 결정 → 취합 → 결과 파일 쓰기**를 한다.

하지 않는 일: 양식 만들기·수정. 양식에 대해 아는 정보는 `FileMeta`와 양식 JSON이 전부다.

## 2. 화면

### 2.1 파일 넣기
- xlsx 여러 개 또는 zip을 끌어다 놓기 / 파일 선택. zip은 JSZip으로 풀어 안의 xlsx만 사용(`__MACOSX`, `~$` 임시 파일 무시).
- 이후에도 [파일 더 넣기]로 추가 가능. 같은 파일명·같은 내용이면 무시.
- 메타를 찾을 수 없는 파일이 있으면 "양식 JSON을 넣으면 이 파일도 취합할 수 있어요" 안내와 [양식 JSON 넣기] 버튼.

### 2.2 검토 화면

```
┌ 양식 제목 · v2 · 파일 17개                         [파일 더 넣기] ┐
│ [제출 12/15] [처리 필요 3] [자동 제외 1] [미제출 3]               │
├──────────┬────────────┬───────────────────────┬───────────────┤
│ 지사      │ 상태        │ 내용                   │ 처리           │
│ 서울      │ ✓ 정상      │ 24행                   │                │
│ 부산      │ ⚠ 값 오류 2 │ 이름 빈칸(7행) …       │ [포함] [제외]  │
│ 대구      │ ⧉ 중복 2개  │ 최신 파일(10/13) 사용  │ [파일 바꾸기▼] │
│ '에이지사' │ ? 지사 확인 │ 목록에 없는 지사명      │ [지사 연결▼]   │
│ 광주      │ ⇄ 구조 변경 │ 열 순서 바뀜, 자동 맞춤 │ 자동 처리       │
│ 작년.xlsx │ ⊘ 다른 양식 │ 양식 ID 불일치          │ 자동 제외       │
│ 울산 …    │ ◷ 미제출    │                        │                │
├──────────┴────────────┴───────────────────────┴───────────────┤
│ 결과에 넣을 시트: ☑ 머리정보 붙여 잇기 ☑ 제출 현황표 ☐ 시트 모으기 │
│                                              [취합 파일 받기] │
└──────────────────────────────────────────────────────────────┘
```

- 한 줄 = 한 지사(지사를 모르는 파일은 파일명으로 한 줄).
- **운영자 결정이 필요한 것만 '처리' 칸에 버튼**을 보여준다. 자동 처리된 것은 설명만.
- 행을 펼치면 해당 파일의 오류 목록(위치, 값, 이유)을 보여준다.
- 정렬: 처리 필요 → 정상 → 자동 처리 → 자동 제외 → 미제출.
- 결과 시트 체크박스의 기본값은 `schema.aggregations`. 현재 layout이 지원하는 방식만 표시.
- [취합 파일 받기]를 눌렀을 때 결정이 남아 있으면, 남은 항목 목록을 보여주고 해당 행으로 이동한다(버튼을 비활성화하지 않는다).

### 2.3 결과 받기
- 파일명: `{양식제목}_취합_{YYYYMMDD-HHmm}.xlsx`
- 성공 시 "지사 12곳, 행 284개를 취합했어요" 요약 표시.

## 3. 처리 파이프라인

```
files ─► ① identify ─► ② parse ─► ③ validate ─► ④ resolve(decisions) ─► ⑤ aggregate ─► ⑥ write
```

모든 단계는 화면과 분리된 **순수 함수 또는 비동기 함수**로 만들고, 화면은 결과만 그린다. 결정이 바뀌면 ④부터 다시 계산한다.

### 3.1 내부 데이터 모델

```ts
interface LoadedFile { id: string; fileName: string; bytes: ArrayBuffer; lastModified: number; }

type MetaSource = 'meta-sheet' | 'doc-props' | 'schema-json' | 'none';

interface IdentifiedFile {
  file: LoadedFile;
  source: MetaSource;
  kind: 'submission' | 'aggregate' | 'unknown';
  formId?: string; formVersion?: number;
  meta?: FileMeta;                 // meta-sheet일 때
  orgFromFile?: string;            // 메타 orgName 또는 지사명 칸 값
  savedAt: string;                 // 통합문서 수정 시각(core.modified) → 없으면 file.lastModified
  status: 'ok' | 'other-form' | 'unreadable';
  notes: string[];                 // 예: '메타 변조 감지', '양식 버전 다름(v1)'
}

interface Issue {
  fileId: string;
  code: IssueCode | 'COLUMN_MISSING' | 'COLUMNS_REORDERED' | 'VERSION_MISMATCH' | 'META_TAMPERED' | 'META_MISSING';
  severity: 'value' | 'info';      // value = 운영자 결정 대상, info = 자동 처리 안내
  location?: string;               // 'C12', '목록 7행 이름'
  fieldLabel?: string;
  raw?: unknown;
  message: string;                 // 화면·결과 파일용 한국어 문장
}

interface ParsedSubmission extends NormalizedSubmission { fileId: string; issues: Issue[]; }

interface Decisions {
  includeWithErrors: Record<string /*fileId*/, boolean | undefined>;  // undefined = 미결정
  duplicateChoice: Record<string /*org*/, string /*fileId*/>;
  orgLink: Record<string /*fileId*/, string /*org*/>;
}
```

### 3.2 ① 식별 (identify)

순서대로 시도한다.
1. `contract/metaIO.readMeta()` 성공 + 체크섬 일치 → `source = 'meta-sheet'`
2. 체크섬 불일치 → 메타를 버리고 `META_TAMPERED` 기록 후 3으로
3. `docProps/custom.xml`의 `kdhc.formId` 있음 → `source = 'doc-props'`. 이 경우 셀 위치는 양식 JSON이 있어야 알 수 있다.
4. 둘 다 없음 → `source = 'none'`. 양식 JSON이 로드되어 있으면 머리글 매칭(3.3)으로 시도.

**기준 양식 정하기**: 처음 식별된 파일들 중 가장 많은 `formId`를 기준 양식으로 한다. 기준과 `formId`가 다른 파일은 `other-form`(자동 제외). 같은 `formId`에서 `formVersion`이 다르면 가장 높은 버전의 schema를 기준으로 하고, 낮은 버전 파일은 `VERSION_MISMATCH`(info) 후 머리글 매칭으로 읽는다.

**취합본**: `kind = 'aggregate'`이면 `_records`를 읽어 `NormalizedSubmission[]`으로 풀고, 각각을 지사 하나의 제출본처럼 이후 단계에 넣는다(`sourceFile`은 "취합본파일명 › 원본파일명").

### 3.3 ② 해석 (parse)

- 지사명: preset 파일은 메타 `orgName`. input 파일은 `cellMap.orgCell`의 값.
- fields 블록: `cellMap`의 `valueCell`에서 값을 읽는다. `labelCell`의 글자가 `field.label`과 다르면 **같은 시트에서 그 라벨을 찾아 오른쪽 칸**을 읽는다.
- list 블록: `headerRow`의 각 열 머리글을 읽어 `field.label`과 비교한다.
  - 모두 일치 → `cellMap.columns` 사용
  - 다르면 → 머리글 행(±3행 범위에서 탐색)에서 **라벨 이름으로 열을 다시 찾는다**(앞뒤 공백·`*` 무시). 순서만 바뀌었으면 `COLUMNS_REORDERED`(info), 못 찾은 열은 `COLUMN_MISSING`(info)이고 값은 null.
  - `firstDataRow`부터 아래로 읽되, **모든 칸이 빈 행은 건너뛴다**. `lastDataRow`를 넘는 행도 값이 있으면 읽는다.
- matrix 블록: `cells[r][c]` 주소에서 읽는다. 행·열 제목이 다르면 제목 이름으로 위치를 다시 찾는다.
- 값 변환: `FIELD_TYPES[type].parse()`. `ok = false`면 원래 값을 문자열로 보관하고 ③에서 오류 처리.
- `source = 'none'` 파일: 양식 JSON의 라벨로 시트 전체에서 머리글 행을 찾는다. 찾지 못하면 `unreadable`.

### 3.4 ③ 검증 (validate)

- 필수 항목이 빈칸 → `REQUIRED_EMPTY` (list는 빈 행이 아닌 행에만 적용)
- `FIELD_TYPES[type].validate()` 실패 → 해당 코드
- 모두 `severity: 'value'`

### 3.5 ④ 결정 (resolve) — 정책 표 (`00-overview.md` 5.1)

| 상황 | 판정 | 기본 상태 | 운영자 동작 |
|---|---|---|---|
| value 오류가 있는 파일 | 결정 필요 | 미결정 | [포함]/[제외]. 포함하면 오류 칸을 결과에서 빨갛게 표시 |
| 구조 변경 | 자동 | 포함 | 없음(안내만) |
| 다른 양식 | 자동 | 제외 | 없음 |
| 같은 지사 파일 2개 이상 | 자동 + 변경 가능 | `savedAt`이 가장 늦은 파일 | [파일 바꾸기▼] |
| 지사명이 목록 밖 / 지사 불명 | 결정 필요 | 미결정 | [지사 연결▼] 목록에서 선택 또는 "입력값 그대로 사용" |

- 지사 목록: `schema.org.orgs`. input 모드에 목록이 없으면 "목록 밖" 판정은 하지 않는다(입력값 그대로 사용).
- 지사 연결 후 다른 파일과 같은 지사가 되면 중복 규칙을 다시 적용한다.
- 취합본 안의 지사와 직접 제출된 같은 지사도 중복 규칙을 적용한다.

### 3.6 ⑤ 취합 (aggregate) — 플러그인 구조

```ts
// src/aggregator/methods/types.ts
interface AggregationMethod {
  id: AggregationId;
  label: string;
  supports(schema: FormSchema): boolean;
  run(ctx: AggregateContext): ResultSheet[];
}
interface AggregateContext {
  schema: FormSchema;
  submissions: ParsedSubmission[];      // 결정 반영 후 포함된 것만
  allFiles: IdentifiedFile[];           // 제출 현황용
  decisions: Decisions;
  issues: Issue[];
  sourceWorkbooks: Map<string, ExcelJS.Workbook>;  // 시트 모으기용
}
interface ResultSheet {
  name: string;                          // 31자 이하, 금지문자 제거, 중복 시 (2) 붙임
  columns: { header: string; width?: number; numFmt?: string }[];
  rows: CellValue[][];
  errorCells?: { row: number; col: number; message: string }[];  // 빨간 배경 + 메모
  copyFrom?: { fileId: string; sheetName: string };              // 시트 모으기
}
// src/aggregator/methods/index.ts — 여기에 한 줄 추가하면 화면에 자동 노출
export const METHODS: AggregationMethod[] = [append, headerAppend, spread, collectSheets, submissionStatus];
```

**방식별 결과 시트 명세**

| ID | 시트 이름 | 열 | 행 |
|---|---|---|---|
| `append` | 취합 | `지사`, list 열들 | 지사 순서(목록 순 → 가나다) × 각 지사의 빈 행 제외 행 |
| `header-append` | 취합 | `지사`, fields 항목들, list 열들 | list 행마다 머리정보 값을 반복. list 행이 0개인 지사는 머리정보만 1행 |
| `spread` | 지사별 | `지사`, `{행제목} {열제목}` 모든 조합 | 지사당 1행. `totalRow`면 마지막에 `합계` 행(숫자 합) |
| `collect-sheets` | 지사명 각각 | 원본 그대로 | 원본 입력 시트의 값·서식·병합·열 너비를 복사(보호·유효성 검사·메타 제외). 취합본 입력이면 취합본 안의 지사별 시트를 복사 |
| `submission-status` | 제출 현황 | `지사`, `상태`, `파일명`, `저장 시각`, `행 수`, `오류 수`, `처리` | 지사 목록 전체(+ 목록 밖 지사). 상태: 제출 / 미제출 / 제외(다른 양식·운영자 제외) |

- 결과 값은 타입대로 저장한다: number는 숫자, date는 엑셀 날짜(`numFmt 'yyyy-mm-dd'`).
- 머리글 행 굵게·연회색, 틀 고정, 자동 필터.

### 3.7 ⑥ 결과 파일 쓰기 (write)

시트 순서:
1. 선택한 방식들의 결과 시트 (`METHODS` 순서)
2. `오류 목록` 시트 (항상): `지사 | 파일명 | 위치 | 항목 | 입력값 | 내용 | 처리(포함/제외/자동)` — info 포함 모든 Issue
3. `_records` (veryHidden): 포함된 `NormalizedSubmission[]` (`01-contract.md` 4.5)
4. `_meta` (veryHidden): `kind: 'aggregate'`, `aggregate.includedOrgs`, `methods` — `contract/metaIO.writeMeta()` 사용

- 결과 파일은 보호하지 않는다(운영자가 자유롭게 편집).
- 파일 속성 이중 기록은 `contract/xlsxPatch` 사용(구조 보호는 넣지 않는다).

## 4. 폴더 구조

```
src/aggregator/
  pages/AggregatePage.tsx
  upload/        DropZone.tsx, unzip.ts
  pipeline/      identify.ts, parse.ts, headerMatch.ts, validate.ts, resolve.ts, aggregate.ts, write.ts
  methods/       types.ts, index.ts, append.ts, headerAppend.ts, spread.ts, collectSheets.ts, submissionStatus.ts
  review/        SummaryCards.tsx, ReviewTable.tsx, ReviewRow.tsx, MethodPicker.tsx
  state/         aggregateStore.ts (useReducer)
  __tests__/
```

## 5. 성능 기준
- 지사 100곳 × 각 1,000행 파일을 10초 이내 처리(최신 노트북, Chrome).
- 파일 읽기는 `Promise.all`로 병렬. UI가 멈추지 않도록 파일 단위로 진행률 표시.

## 6. 완료 기준

1. `fixtures/`의 모든 파일을 넣으면 각 파일이 표(01-contract 8절)의 의도대로 분류된다.
2. 오류 정책 5가지가 정책 표대로 동작한다.
3. 취합 방식 5종(+ 다시 취합) 결과가 명세대로 나온다.
4. 본부 취합본 2개를 다시 취합한 결과가, 같은 지사 파일들을 직접 취합한 결과와 같다.
5. 결과 파일을 MS Excel에서 열면 숫자·날짜가 계산 가능한 값이고, 오류 칸이 빨갛게 표시된다.
6. 처리 중 네트워크 요청이 없다.

## 7. 테스트

| 대상 | 내용 |
|---|---|
| identify | 메타 정상 / 변조 / 시트 삭제(속성만) / 모두 없음 / 다른 양식 / 버전 다름 / 취합본 |
| parse | 열 순서 변경, 열 삭제, 빈 행 건너뛰기, `lastDataRow` 초과 행, 날짜 형식 4종 |
| validate | IssueCode 6종 |
| resolve | 중복 기본값(최신), 파일 바꾸기, 지사 연결 후 중복 재판정, 미결정 남음 |
| methods | 방식 5종 각각 입력 → `ResultSheet` 기대값 비교 |
| write | 결과 파일을 다시 열어 시트 순서, `_records`·`_meta` 왕복, 오류 칸 서식 |
| 다시 취합 | 본부 취합본 2개 → 결과 = 직접 취합 결과 |
