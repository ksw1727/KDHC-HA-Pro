# 빌더 화면 구현 계획 (생성 파트 · 개발자 1)

> 기준 문서: `docs/prd/00-overview.md`, `01-contract.md`, `02-generator.md` (2.2~2.5, 3절)
> 목업: `docs/mockups/generator-themes.html` 시안 1 공공 블루, `generator-mockups.html` 시안 1
> 작성일: 2026-10-13

---

## 0. 목표와 범위

**목표**: 운영자가 빌더 화면에서 양식을 정의하면, 오른쪽 미리보기가 **실제 엑셀과 같은 배치**로 즉시 바뀌는 화면을 만든다. 미리보기 머리글을 누르면 왼쪽 항목이 선택된다.

**이 계획에 포함**
- 프로젝트 세팅(공동 바탕), 공통 계약 중 빌더가 쓰는 부분(타입, 항목 타입의 엑셀 서식, 취합 방식 목록)
- 레이아웃 엔진 `contract/layout` (빈 양식 + 취합본 미리보기)
- 빌더 상태(양식 정의 편집), 내보내기 전 검사, 버전 판단
- 빌더 화면: ①~⑤ 패널, 항목·서식 편집, 미리보기, 머리글 클릭 연동, 빈칸채우기 표 편집기, 시트 모으기형 설정
- [양식 파일 저장] 버튼(`.form.json` 내려받기)

**다른 계획으로 분리** (빌더가 끝난 뒤)
- 첫 화면(랜딩·구조 고르기 애니메이션·최근 양식) → `landing` 계획
- 엑셀 파일 쓰기(`writeWorkbook`, 보호·유효성 검사·메타·zip), 내보내기 확인·완료 화면, 안내문 복사 → `export` 계획
- 이 계획에서 [엑셀 내보내기] 버튼은 **검사 창까지만** 동작하고, 통과하면 "내보내기는 다음 단계에서 연결됩니다" 안내를 띄운다.

**완료 모습**: 목업 `generator-themes.html` 시안 1처럼 동작하는 빌더. 구조 5종 모두 만들고, 미리보기 [빈 양식 | 취합본] 전환, 머리글 클릭 연동, 검사 창, 양식 파일 저장이 된다.

---

## 1. 개발자 2와 맞출 것 (먼저 확인)

| # | 내용 | 언제 |
|---|---|---|
| K1 | **프로젝트 세팅(A1)은 한 사람만** 한다. 개발자 1이 하고 PR로 올리면, 개발자 2는 그 위에서 시작 | 시작 전 |
| K2 | `src/contract/` 타입(A2)은 0단계 공동 작업. 개발자 1이 초안 PR, 개발자 2 승인 후 병합 | A2 |
| K3 | `fieldTypes/`는 반씩 나눈다. **엑셀 쪽(`excelValidation`, `excelNumFmt`)은 개발자 1**, **값 정리(`normalize`)는 개발자 2**. 파일은 타입별로 하나씩 두고 함수만 나눠 채운다 | A3 |
| K4 | `layout/sheetModel.ts`의 **`AggregateFill`(취합본 채우기 데이터) 모양**은 개발자 2의 같은 틀 시트와 직결된다. B8 전에 이 계획 B8의 초안을 보여주고 합의 | B8 전 |
| K5 | 계약 파일(`src/contract/`)을 고치는 PR은 상대 승인 필수(`01-contract.md` 10절) | 계속 |

---

## 2. 작업 순서 한눈에

```
A 바탕 ──► B 레이아웃 엔진 ──► C 상태 ──► D 화면 ──► E 마무리
 A1 세팅     B1 모델·스타일     C1 새 양식    D1 껍데기·머리줄
 A2 타입     B2 공통 머리       C2 편집 동작   D2 ①②④⑤ 패널
 A3 서식     B3 목록            C3 버전       D3 ③ 항목·서식
             B4 혼합            C4 검사       D4 미리보기
             B5 표              C5 자동 저장   D5 머리글 연동
             B6 빈칸채우기                      D6 구조 바꾸기 확인
             B7 시트 모으기                     D7 빈칸채우기 편집기
             B8 취합본 모드                     D8 시트 모으기 설정
             B9 불변 조건 검사                  D9 검사 창
```

- **PR 단위**: A(1개) → B(B1~B5 1개, B6~B9 1개) → C(1개) → D(D1~D5 1개, D6~D9 1개) → E. 각 PR은 README 규칙(브랜치 `feat/…`, 상대 확인 후 Squash merge).
- PRD 마일스톤과의 관계: A·B·C·D1~D6·D8 = **1단계**, D7(빈칸채우기 표 편집기) = PRD상 **3단계**지만 B6과 함께 묶여 있어 이 계획에서는 뒤쪽에 둔다. 일정이 빠듯하면 D7을 다음 계획으로 미룬다.

---

## 3. AI(LLM)에게 일 맡기는 법

각 작업을 맡길 때 **항상 같이 주는 것**: `00-overview.md`, `01-contract.md`, `02-generator.md`, 이 계획 파일, 그리고 해당 작업 번호.

권장 지시 틀:
```
이 계획의 [작업 번호]를 진행해 줘.
1. "먼저 쓸 테스트"를 먼저 작성하고 실패하는 것을 확인해.
2. 테스트가 통과하도록 구현해.
3. npm test, npm run typecheck가 통과하는지 보여 줘.
4. src/contract/를 고쳐야 하면 멈추고 나에게 알려 줘.
```

- 화면 작업(D)은 구현 후 `npm run dev`로 띄워 목업과 나란히 비교한다.
- 한 번에 한 작업만 맡긴다. 끝나면 커밋하고 다음 작업으로.

---

## A. 바탕

### A1. 프로젝트 세팅 (공동 바탕, 개발자 1이 진행)

**만들 것**
```
package.json            scripts: dev, build, test, typecheck, lint
vite.config.ts          React 플러그인 + vite-plugin-singlefile(빌드 시 index.html 한 파일)
tsconfig.json           strict: true, 경로 별칭 @contract → src/contract, @gen → src/generator, @agg → src/aggregator
tailwind.config.ts      공공 블루 색 토큰 (아래)
src/main.tsx, src/app/App.tsx   상단 탭 [양식 만들기 | 취합하기] 껍데기
src/contract/  src/generator/  src/aggregator/   빈 폴더 + index.ts
vitest.config.ts        jsdom 환경
```

**의존성**: react, react-dom, typescript, vite, @vitejs/plugin-react, vite-plugin-singlefile, tailwindcss, vitest, @testing-library/react, jsdom, exceljs(4.4.0, 프로토타입과 같은 버전), jszip, @dnd-kit/core, @dnd-kit/sortable

**공공 블루 토큰** (`generator-themes.html` 시안 1과 같은 값)
```ts
colors: {
  pri: { DEFAULT: '#1f5fbf', ink: '#174a96', bg: '#e8f0fc', line: '#b9cff2' },
  ink: '#18202b', sub: '#56616e', muted: '#8a95a2',
  line: { DEFAULT: '#e2e7ee', strong: '#cbd3dd' },
  panel: '#f6f8fb', chip: '#f1f4f8',
  req: '#fff5d1', auto: { bg: '#e5f4ee', head: '#cfeadf', ink: '#0f6e56' },
  warn: { bg: '#fdf1e3', ink: '#9a4a07' }, err: { bg: '#fdecea', ink: '#b42318' },
},
borderRadius: { DEFAULT: '8px', btn: '7px', card: '10px' },
```

**완료 확인**: `npm run dev`로 탭 두 개가 보임, `npm test`(빈 테스트 1개) 통과, `npm run build` 결과가 `dist/index.html` 한 파일이고 더블클릭으로 열림.
**PR**: `chore/project-setup` → 개발자 2 확인.

### A2. 계약 타입 (0단계 공동, 개발자 1 초안)

**만들 것**: `src/contract/schema.ts`, `meta.ts`(타입만), `aggregationIds.ts`, `version.ts`
- `01-contract.md` 3·4·6절의 타입을 **글자 그대로** 옮긴다(이름·주석 포함).
- `validateSchema(x: unknown): { ok: true; schema: FormSchema } | { ok: false; errors: string[] }` — 3절 "구조별 블록 규칙" 표와 bullet 조건 전부 검사.
- `AGGREGATION_SUPPORT`, `AGGREGATION_REQUIRED` 값 채우기:
  ```ts
  AGGREGATION_REQUIRED = { list: ['same-frame'], 'header-list': ['same-frame'], 'fill-in': ['same-frame'],
                           matrix: ['same-frame', 'spread'], collect: ['collect-sheets'] };
  AGGREGATION_SUPPORT = { 'same-frame': ['list','header-list','matrix','fill-in'],
                          spread: ['matrix','header-list','fill-in'],
                          'collect-sheets': ['list','header-list','matrix','fill-in','collect'],
                          'submission-status': ['list','header-list','matrix','fill-in','collect'] };
  // submission-status는 org.mode가 preset·input일 때만 — 함수 availableAggregations(schema)로 판단
  ```
- `availableAggregations(schema): AggregationId[]` 도우미 추가.

**먼저 쓸 테스트** (`src/contract/__tests__/schema.test.ts`)
- 구조 5종 올바른 예시 → ok
- `header-list`인데 블록 순서가 [List, Fields] → 오류
- `collect`인데 `collect` 설정 없음 / `org.mode = 'input'` → 오류
- `fill-in` 입력칸 0개이고 `spareRows` 0 → 오류
- `availableAggregations`: none 모드면 submission-status 없음, collect면 same-frame 없음

**PR**: `feat/contract-types` → **개발자 2 승인 필수**.

### A3. 항목 타입의 엑셀 쪽 (`fieldTypes/`, 개발자 1 몫)

**만들 것**: `src/contract/fieldTypes/{text,number,date,select,memo,pattern}.ts`, `index.ts`
- 각 파일에 `type`, `label`, `excelNumFmt(field)`, `excelValidation(field, today)`를 채우고, `normalize`는 `throw new Error('개발자 2 구현 예정')`으로 둔다(K3).
- `excelNumFmt` 규칙: 숫자 `decimals`·`thousands`·`unit` 조합 → 예 `#,##0"원"`, `0.00`, `#,##0.0"%"`. 날짜 `dateFormat` 그대로(`yyyy.mm.dd` 등), 연도형은 `0`.
- `excelValidation`: `01-contract.md` 5절 표 "엑셀 입력 규칙" 열. 상대 날짜 `today+30`은 `today` 인자로 계산.
- 빌더 표시용 도우미 `src/generator/preview/formatSample.ts`: `formatSample(field): string` → 미리보기·서식 패널에 보일 예시(`120,000원`, `2026.11.01`, `010-1234-5678`). 계약 밖(생성 파트 전용)에 둔다.

**먼저 쓸 테스트**: 숫자 서식 조합 8가지, 날짜 형식 4가지, 상대 날짜(고정된 today로), select 드롭다운 목록 문자열, pattern 길이 제한, `formatSample` 예시.

---

## B. 레이아웃 엔진 (`src/contract/layout/`, 순수 함수 · 테스트 중심)

> 입력이 같으면 출력이 같아야 한다. 화면·파일·날짜·난수에 접근하지 않는다(날짜가 필요하면 인자로 받는다).

### B1. 모델과 스타일 표

**만들 것**: `sheetModel.ts`(`01-contract.md` 7절 `SheetModel`, `ModelCell`, `LayoutInput` 그대로 + 4절 `AggregateFill` 초안), `styles.ts`
- `styles.ts`: role별 스타일 하나의 표. 미리보기(CSS 값)와 엑셀(ExcelJS 스타일) 둘 다 이 표에서 만든다.
  ```ts
  export const ROLE_STYLES: Record<Role, { bold?: boolean; size?: number; fill?: string; color?: string;
    italic?: boolean; align?: 'left'|'center'|'right'; border?: 'thin'|'none'; locked: boolean }>;
  export const REQUIRED_FILL = '#FFF5D1'; export const REQUIRED_HEADER_FILL = '#E3EBFA';
  ```
  값은 `02-generator.md` 4절 표를 따른다.
- 주소 도우미 `address.ts`: `colLetter(1)='A'`, `addr(col,row)='B7'`, `range(c1,r1,c2,r2)='B7:B106'`.

**먼저 쓸 테스트**: `colLetter` 1·26·27·52, `range` 모양, role 표에 모든 role이 있음.

### B2. 공통 머리 (제목·안내·제출처 줄)

**만들 것**: `layoutEngine.ts`의 `layoutSheet` 뼈대 + 머리 부분
- 마지막 열 `lastCol` = 블록들이 필요한 열 수의 최댓값(최소 2). 목록 = 1(번호) + 열 수, 표 = 1 + 열 제목 수(+1 합계 열), 빈칸채우기 = 열 제목 수, 항목:값 = 2.
- 1행 제목(`title`, A1:{last}1 병합), 2행 정보칸(`guide`, 병합): 빈 양식은 `작성 안내 · 제출 기한 M월 D일 · 문의처`(빈 값은 뺌), 취합본은 `input.info`.
- 4행 제출처 줄(org.mode ≠ none): A4 `label`(`{org.label ?? '지사'}명`), B4 값 칸
  - preset: `locked-value`, 값 = `orgName`
  - input: `input`, 필수, `orgs`가 있으면 드롭다운 유효성 검사
  - `cellMap.orgCell = 'B4'`
- 블록 시작 행: 제출처 줄이 있으면 6행, 없으면 4행. 블록 사이 빈 행 1개. 블록에 `title`이 있으면 블록 위에 `label` 한 줄.
- 시트 이름: 양식 제목을 31자로 자르고 `\ / ? * [ ] :`를 `_`로.

**먼저 쓸 테스트**: preset·input·none 각각 4행 모양과 `orgCell`, 정보칸 문구 조합(기한·문의처 있음/없음), 시트 이름 규칙, `org.label = '부서'`면 A4가 `부서명`.

### B3. 목록 블록 (`list`)
- 머리글 행: A `번호`(header), B부터 항목 이름(필수면 ` *`, `required: true`).
- 예시 줄(`exampleRow` 있을 때): 머리글 바로 아래 한 줄, role `example`, `cellMap.blocks[id].exampleRow`.
- 입력 줄 `maxRows`개: A열 `row-number`(1, 2, …), 나머지 `input`(필수 표시, `numFmt` = `excelNumFmt`).
- 유효성 검사는 **열 단위 범위 하나**(`B8:B107`)로 넣는다(칸마다 넣지 않음, 파일 크기·속도).
- 틀 고정: 머리글 행 아래. `printArea` = A1 ~ 마지막 입력 줄.
- `cellMap`: `headerRow`, `firstDataRow`, `lastDataRow`, `columns{key: 'B'}`.

**먼저 쓸 테스트**: 열 3개 × 100줄 → `cells` 수, `validations` 3개 범위, 예시 줄 있을 때 첫 입력 행이 한 칸 내려감, `printArea`, `freeze`.

### B4. 혼합형 (`fields` + `list`)
- 항목:값 한 줄씩: A `label`, B `input`(B부터 마지막 열까지 병합). `cellMap.cells[key] = { labelCell: 'A6', valueCell: 'B6' }`.
- 이어서 빈 행 1개 후 목록 블록(B3 재사용).

**먼저 쓸 테스트**: 머리정보 2개 + 목록 → 목록 머리글 행 번호, 값 칸 병합 범위, cellMap.

### B5. 표형 (`matrix`)
- 첫 행: A 빈 `header`, B부터 열 제목, `totalCol`이면 마지막 `계`.
- 이후 행: A 행 제목(`header`), 입력칸(`input`, 숫자 서식). `totalCol`이면 행 끝에 `SUM` 수식 칸(잠금).
- `totalRow`면 마지막에 `합계` 행, 열마다 `SUM`. 둘 다면 오른쪽 아래 칸은 전체 합.
- `cellMap`: `rowLabelCells`, `colLabelCells`, `cells[r][c]`.

**먼저 쓸 테스트**: 2×2 + 합계 행·열 → 수식 문자열(`SUM(B7:C7)`), cellMap 주소, 합계 칸은 잠금 role.

### B6. 빈칸채우기형 (`grid`)
- 머리글 행: `colLabels`(header). 본문: `fixed` → role `fixed`, `input` → role `input`(필드 서식·필수), `blank` → 빈 잠금 칸.
- 여유 줄 `spareRows`개: 열마다 `spareColumns[i]` 규칙의 `input`. 유효성 검사는 열 범위.
- `cellMap`: `headerRow`, `firstRow`, `columns`, `inputCells`, `fixedCells`, `spare`.

**먼저 쓸 테스트**: 고정·입력·빈칸 섞인 2×5 표, 여유 줄 3, `fixedCells` 값, 입력칸 유효성 검사.

### B7. 시트 모으기형 (`collect`)
- 1행 제목, 2행 `{label}명`(A2) · 값(B2) · 안내(C2부터 병합). none이면 2행은 안내만.
- 4행부터 `starter` 표를 role `fixed`로(값만). 없으면 아무것도 없음.
- 잠금 개념 없음: 모든 칸 `locked: false`로 표시하는 플래그 `SheetModel.unprotected = true` 추가가 필요하면 **K5에 따라 개발자 2와 합의**(계약 변경). 대안: 엑셀 쓰기 쪽에서 `schema.layout === 'collect'`면 보호를 생략(계약 변경 없음) → **대안을 기본으로**.
- `validations` 없음, `printArea = ''`, `cellMap` 없음(빈 객체가 아니라 `undefined`가 되도록 반환 타입 처리).

**먼저 쓸 테스트**: starter 있음/없음, preset/none의 2행 모양.

### B8. 취합본 모드 (`mode: 'aggregate'`) — 미리보기 [취합본]용

`01-contract.md` 7.2 표대로 만든다. **`AggregateFill` 모양은 K4 합의 대상**이며 초안은 다음과 같다.
```ts
export interface AggregateFill {
  autoColumns: string[];                 // 오른쪽 자동 칸 이름 순서, 예 ['지사','담당자','출처 파일','원본 줄','상태']
  rows?: { values: Record<string, CellValue>; auto: CellValue[];
           marks?: { key: string; mark: ModelCell['mark']; note?: string }[]; muted?: boolean; strike?: boolean }[];
  matrixSums?: CellValue[][];            // matrix: 칸별 합
  grid?: Record<string, { value: CellValue; note?: string }>;   // fill-in 입력칸 겹친 값
  gridSpare?: { values: CellValue[]; auto: CellValue[] }[];
  collectSheets?: string[];              // collect: 미리보기용 시트 탭 이름
}
```
- list/header-list: 입력 줄 자리에 `rows`, 오른쪽 끝에 `auto-header`/`auto-value` 칸. 머리정보 칸은 비우고 "(줄별 자동 칸 참고)".
- matrix: 같은 표에 `matrixSums`, 합계 다시 계산.
- fill-in: 입력칸에 `grid` 값, 여유 줄 자리에 `gridSpare`.
- collect: 같은 틀 시트 없음 → 미리보기는 D4에서 시트 탭 모양으로 따로 그린다(엔진은 호출하지 않음).
- 생성 파트 미리보기용 가짜 데이터: `src/generator/preview/sampleAggregate.ts`가 스키마를 보고 지사 3곳 × 1~2줄을 만든다(`formatSample` 값 사용).

**먼저 쓸 테스트**: 구조 4종 aggregate 스냅샷, 자동 칸이 양식 칸 **오른쪽 끝**에 붙어 원래 열 위치가 그대로인지.

### B9. 불변 조건 검사 (모든 구조 공통)
`src/contract/layout/__tests__/invariants.test.ts`
- `cellMap`의 모든 주소가 `cells`에 있다.
- 두 칸이 같은 주소를 갖지 않는다. 병합 범위가 서로 겹치지 않는다.
- `printArea`가 모든 `input` 칸을 포함한다(collect 제외).
- 같은 스키마로 두 번 호출하면 결과가 같다(순수 함수).

---

## C. 빌더 상태 (`src/generator/state/`)

### C1. 새 양식 만들기 (`newSchema.ts`)
- `newSchema(layout: Layout, now: Date, id: string): FormSchema` — 구조별 기본 블록:
  - list: 목록 1개(항목 `이름` 텍스트 필수 1개, `maxRows` 100)
  - header-list: 항목:값(`담당자`) + 목록(`이름`)
  - matrix: 행 `['1행','2행']`, 열 `['1열','2열']`, 숫자, 합계 행 켬
  - fill-in: 2×3 빈 표
  - collect: `blocks: []`, `collect: { scope: 'report' }`, `org.mode: 'preset'`
- `aggregations` 기본값 = 필수 + (지사 사용 시) `submission-status`. `org.label` 기본 `'지사'`.
- 항목 `key`는 `f_` + 4자리 무작위(인자로 받는 `idGen` 사용, 테스트에서 고정).

### C2. 편집 동작 (`formReducer.ts`, `actions.ts`)
`useReducer`용 순수 함수. 동작 목록:
```ts
type Action =
  | { type: 'meta/set'; patch: Partial<Pick<FormSchema,'title'|'guide'|'deadline'|'contact'>> }
  | { type: 'layout/change'; layout: Layout }                 // C2-1 재구성 규칙
  | { type: 'field/add'; blockId: string; fieldType: FieldType; after?: string }
  | { type: 'field/update'; blockId: string; key: string; patch: Partial<Field> }
  | { type: 'field/remove'; blockId: string; key: string }
  | { type: 'field/move'; blockId: string; from: number; to: number }
  | { type: 'list/set'; blockId: string; patch: { maxRows?: number; exampleRow?: Record<string,string|number> | null } }
  | { type: 'matrix/set'; blockId: string; patch: Partial<Pick<MatrixBlock,'rowLabels'|'colLabels'|'totalRow'|'totalCol'>> & { cell?: Partial<Field> } }
  | { type: 'grid/…' }                                         // D7에서 추가
  | { type: 'collect/set'; patch: Partial<CollectSpec> }
  | { type: 'org/set'; patch: Partial<FormSchema['org']> }
  | { type: 'agg/toggle'; id: AggregationId }                  // 필수는 무시
  | { type: 'schema/load'; schema: FormSchema };
```
- **C2-1 구조 바꾸기 규칙** `changeLayout(schema, to): { schema; lost: Field[] }`: 목록 칸은 목록 칸으로, 항목:값은 항목:값으로 옮기고, 옮길 곳이 없는 항목은 `lost`로 돌려준다(D6 확인 창에 사용). 표형 → 다른 구조는 행·열 제목을 잃는다고 알린다.
- 타입을 바꾸면 그 타입에 없는 서식 값(`decimals`, `options` 등)을 지운다.
- `updatedAt`은 동작마다 갱신(시간은 리듀서 밖에서 주입).

**먼저 쓸 테스트**: 동작마다 1개 이상. 특히 같은 블록 이름 중복 허용(검사는 C4가 함), 필수 취합 방식 토글 무시, 혼합형 → 목록형 시 머리정보가 `lost`, collect로 바꾸면 org.mode input → preset.

### C3. 버전 (`versioning.ts`)
- `structureKey(schema)`: 칸 구조에 해당하는 값만 뽑아 정렬된 JSON(항목 key·순서·타입·서식·선택지, 블록 구조, 표 칸 종류, collect 설정). 제목·안내·기한·문의처·지사 목록은 제외.
- `nextVersion(current, lastExported?)`: 마지막 내보낸 `structureKey`와 다르면 `formVersion + 1`, 같으면 그대로. 바뀐 점 요약 `diffSummary()` → ["교육비 항목 추가", "직급 선택지 변경"] (내보내기 확인 창에서 사용).

**먼저 쓸 테스트**: 제목만 바꿈 → 버전 유지, 항목 추가 → +1, 선택지만 바꿈 → +1, 지사 목록만 바꿈 → 유지.

### C4. 내보내기 전 검사 (`validateForExport.ts`)
- 반환: `{ where: 'meta'|'layout'|'fields'|'aggregations'|'org'; blockId?; key?; message: string }[]`
- 조건(`02-generator.md` 2.2): 제목 없음, 항목 0개, 같은 블록 이름 중복, 선택지 없음, 패턴 종류 없음, min > max, preset인데 지사 0개, 표 행·열 제목 없음, 빈칸채우기 입력칸 0개이고 여유 줄 0, + `validateSchema` 실패 내용.
- 메시지는 화면 문구 그대로(예: "직급: 선택지가 비어 있어요. 1개 이상 넣어 주세요.").

**먼저 쓸 테스트**: 조건마다 1개, 정상 양식은 빈 배열.

### C5. 자동 저장 (`storage/localForms.ts`)
- 편집 중인 양식을 500ms 지연 후 `localStorage['hanan-moa:forms:{formId}']`에 저장. `lastExportedKey`도 함께 저장(버전 판단용).
- 저장 실패(용량·사생활 모드)해도 화면은 계속 동작하고, 상단에 "이 브라우저에 자동 저장되지 않아요"만 표시.
- 최근 양식 목록 UI는 landing 계획에서.

---

## D. 빌더 화면 (`src/generator/builder/`, `preview/`, `pages/BuilderPage.tsx`)

> 각 작업 끝에 목업과 나란히 놓고 비교한다. 문구는 PRD·목업 문구를 그대로 쓴다.

### D1. 화면 뼈대와 머리줄
- `BuilderPage`: 2단(왼쪽 400px 설정, 오른쪽 미리보기), 상단 머리줄: 로고 `한난MOA`, 탭, 양식 제목, `v{버전} · 자동 저장됨`, [양식 파일 저장], [엑셀 내보내기].
- [양식 파일 저장] = `exportJson.ts`: `{제목}.form.json` 내려받기(`Blob` + `a[download]`).
- 상태: `useReducer(formReducer)` + `selectedField: { blockId, key } | null` + `previewMode: 'template'|'aggregate'` + `previewOrg`.

### D2. ①②④⑤ 패널
- 접었다 펴는 패널(한 번에 하나만 펼침, 접힌 패널 오른쪽에 요약 "혼합형", "목록 있음 · 15곳").
- ① 기본 정보: 제목(필수), 작성 안내, 제출 기한(날짜 입력), 문의처.
- ② 양식 구조: 5개 버튼 묶음. 바꾸면 D6 확인.
- ④ 취합 방식: `availableAggregations` 체크박스, 필수는 🔒 체크 고정.
- ⑤ 제출처: 부르는 말(지사/부서/기관/직접), [목록 있음 | 지사명 입력 | 식별 안 함](collect는 가운데 숨김), 목록 붙여넣기 칸(줄바꿈·탭 구분, 중복·빈 줄 제거, "15곳"), xlsx/csv 첫 열 불러오기(ExcelJS로 첫 시트 A열 읽기).

### D3. ③ 항목·서식
- 블록별 목록(블록 이름 줄 + 항목 줄), dnd-kit으로 끌어서 순서 변경, [+ 항목 추가](타입 고르기 → 기본 이름 `항목 n`).
- 항목을 누르면 그 아래에 편집 칸 펼침(목업 시안 1): 이름, 타입, 타입별 서식(`02-generator.md` 2.3 표), 필수, 작성 안내, 그리고 초록 한 줄 안내("취합할 때 '₩1000', '1,000원'처럼 들어와도 숫자 1000으로 정리돼요").
- 목록 블록 설정: 입력 줄 수, 예시 줄 켜기(켜면 각 항목 예시값 입력칸).
- 표형: 행 제목·열 제목 목록 편집(줄마다 하나), 합계 행·합계 열 스위치, 칸 서식(숫자) 편집.
- 컴포넌트: `FieldList.tsx`, `FieldEditor.tsx`, `FormatEditor.tsx`(타입별 하위 컴포넌트), `MatrixEditor.tsx`.

### D4. 미리보기 (`PreviewGrid.tsx`)
- 입력: `SheetModel` 하나. 출력: 엑셀처럼 생긴 표(열 문자 머리 A·B·C…, 행 번호, 병합, role 색).
- role → CSS는 `styles.ts`에서 만든다(직접 색을 쓰지 않는다).
- 목록 입력 줄은 처음 5줄 + "… (총 100줄)" 한 줄로 줄인다(엔진 결과는 그대로, 그리는 쪽에서만 줄임).
- 위쪽: [빈 양식 | 취합본] 전환, 빈 양식일 때 `지사: [서울 ▾]`(preset 목록), 취합본일 때 "가짜 데이터 3곳으로 그린 모양".
- 아래쪽: 범례(필수 입력칸, 잠긴 칸, 자동 칸, 선택한 항목), 구조가 바뀌어 다음 내보내기 때 버전이 오르면 "칸 구조를 바꿨어요. 내보내면 버전 n이 됩니다" 노란 줄(C3).
- collect: 빈 양식은 엔진 결과 + "여기부터 자유롭게 작성" 영역, 취합본은 `목차 · 서울 · 부산 · 대구` 시트 탭 그림.
- 성능: 스키마가 바뀔 때만 `layoutSheet` 다시 계산(`useMemo`).

### D5. 머리글 클릭 연동
- 미리보기의 항목 머리글·항목:값 라벨 칸에 `data-field-key`를 단다(엔진 결과의 `cellMap`으로 주소 → key를 찾는다).
- 머리글을 누르면 `selectedField` 변경 → 왼쪽 ③ 패널을 펼치고 해당 항목 편집 칸을 열고 스크롤.
- 선택한 항목의 열 전체(머리글~입력 줄)를 파란 테두리로 강조. 왼쪽에서 골라도 똑같이 강조.
- 마우스를 올리면 점선 테두리 + 안내 "머리글을 누르면 왼쪽에서 서식을 고칠 수 있어요".

### D6. 구조 바꾸기 확인 창
- ②에서 다른 구조를 누르면 `changeLayout` 결과의 `lost`가 있을 때만 확인 창: "표형으로 바꿀까요? 목록 칸 4개는 옮길 수 없어서 지워져요." [취소] / [바꾸기].
- 구조 애니메이션(`StructureStory`)은 landing 계획에서 만든 뒤 이 창에 붙인다(지금은 글만).

### D7. 빈칸채우기 표 편집기 (`GridEditor.tsx`)
- `02-generator.md` 2.4: 행·열 추가·삭제, 칸에 값 입력 → 고정 칸, 범위 선택 후 [입력칸으로](같은 항목 설정 일괄), [빈칸으로], 입력칸 이름 자동 `{행 첫 칸} · {열 머리글}`.
- 붙여넣기: 클립보드 탭·줄바꿈 텍스트를 표로(`parsePastedTable.ts`, 순수 함수).
- 여유 줄 수와 열별 규칙(`spareColumns`).
- grid용 리듀서 동작(`grid/setCell`, `grid/setRange`, `grid/addRow` …)을 C2에 추가.

**먼저 쓸 테스트**: `parsePastedTable`(탭, 줄바꿈, 빈 칸, 마지막 줄바꿈, `\r\n`), 범위 입력칸 지정 시 key 유일성.

### D8. 시트 모으기형 설정 (`CollectSettings.tsx`)
- ③ 자리에: 시트 시작 모양 [빈 시트로 보내기 | 기본 틀 넣기(붙여넣기 칸, D7의 `parsePastedTable` 재사용)], 모을 시트 [보고서 시트만(기본) | 모든 시트].
- 안내 문구 2줄(`02-generator.md` 2.5).

### D9. 검사 창 (`CheckDialog.tsx`)
- [엑셀 내보내기] → `validateForExport` → 문제가 있으면 창: "내보내기 전에 n가지를 고쳐 주세요", 줄마다 위치 · 내용 · [고치러 가기].
- [고치러 가기] → 해당 패널 펼치기 + 항목 빨간 표시(패널 머리에 "고칠 것 n"). 버튼은 막지 않는다.
- 문제가 없으면 이번 계획에서는 "검사를 통과했어요. 엑셀 만들기는 다음 단계에서 연결됩니다." 안내(export 계획에서 확인 창으로 교체).

---

## E. 마무리

### E1. 키보드·접근성 기본
- 모든 버튼·패널은 키보드로 열고 닫힘, 포커스 테두리(공공 블루 3px 연한 테두리), 색만으로 구분하지 않기(필수는 `*`도 표시), 미리보기 표에 `role="grid"`와 머리글 연결.

### E2. 손으로 확인할 목록 (PR 설명에 체크)
- [ ] 구조 5종 새로 만들기 → 미리보기 모양이 목업과 같은가
- [ ] 항목 추가·삭제·순서 변경·타입 변경이 미리보기에 즉시 반영
- [ ] 숫자 서식(정수/소수, 쉼표, 단위) 바꾸면 서식 예시와 미리보기 예시 값이 바뀜
- [ ] 미리보기 머리글 클릭 ↔ 왼쪽 선택이 양쪽으로 연동
- [ ] [빈 양식 | 취합본] 전환: 자동 칸이 오른쪽 끝에, 표형은 합계
- [ ] 지사 15곳 붙여넣기 → "15곳", 미리보기 지사 선택에 15곳
- [ ] 제출처 "부서"로 바꾸면 4행이 "부서명"
- [ ] 혼합형 → 표형 바꾸기 시 확인 창
- [ ] 검사 창 [고치러 가기] 이동
- [ ] [양식 파일 저장] → 같은 파일을 다시 불러오면(`schema/load` 임시 버튼) 같은 화면
- [ ] 새로고침해도 편집 중인 양식이 남음(자동 저장)
- [ ] `npm run build` → `dist/index.html` 더블클릭으로 동작

---

## 4. 열린 질문 (진행하면서 정할 것)

| # | 질문 | 기본안 |
|---|---|---|
| Q1 | collect의 "보호 없음"을 `SheetModel`에 표시할지, 엑셀 쓰기에서 layout으로 판단할지 | 엑셀 쓰기에서 판단(계약 변경 없음) |
| Q2 | `AggregateFill` 모양 | 위 B8 초안으로 개발자 2와 합의(K4) |
| Q3 | 항목:값 블록의 값 칸을 마지막 열까지 병합할지 | 병합(엑셀에서 넓게 보임). 취합 파트는 `valueCell`만 읽으므로 영향 없음 |
| Q4 | 미리보기 목록 줄을 5줄로 줄이는 것이 표형·빈칸채우기형에도 필요한지 | 목록 블록과 여유 줄에만 적용 |
