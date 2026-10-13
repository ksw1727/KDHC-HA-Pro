# 03. 취합 파트 — 검증과 취합 (개발자 2)

> 함께 읽을 문서: `00-overview.md`, `01-contract.md`
> 담당 코드: `src/aggregator/`
> 금지: `src/generator/` import, `src/contract/` 단독 수정 (같은 틀 시트는 `contract/layout`을 호출해서 만든다)
> 개발 첫날부터 `fixtures/`의 샘플 파일로 개발·테스트한다(생성 파트 완성을 기다리지 않는다).
> 참고본: 개발자2 프로토타입 `index.html` + `selfcheck.js` — 엑셀 모양 해석·값 정리·검산 로직을 이 구조로 옮긴다.

---

## 1. 이 파트가 하는 일

작성자가 돌려준 엑셀 파일(또는 본부 취합본)을 받아 **식별 → 읽기(모양 해석) → 값 정리 → 검증 → 운영자 결정 → 취합 → 검산 → 결과 파일 쓰기**를 한다.
원칙은 **사람처럼 꼼꼼하게**: 한 줄도 잃어버리지 않고(검산), 고치되 원래 값은 남기고(셀 메모), 애매하면 묻는다(검토 화면).

하지 않는 일: 양식 만들기·수정. 양식에 대해 아는 정보는 `FileMeta`와 양식 JSON이 전부다.

## 2. 화면

### 2.1 파일 넣기
- xlsx 여러 개 또는 zip을 끌어다 놓기 / 파일 선택. zip은 JSZip으로 풀어 안의 xlsx만 사용(`__MACOSX`, `~$` 임시 파일 무시). 이전 취합본도 함께 넣을 수 있다.
- **`.xlsx`만** 처리. `.xls`·`.csv`·암호 걸린 파일·깨진 파일은 사유를 표시하고 건너뛴다("엑셀에서 .xlsx로 다시 저장해서 보내 주세요"). 건너뛴 파일도 파일목록·검산에 남는다.
- 이후에도 [파일 더 넣기]로 추가 가능. 같은 파일명·같은 내용이면 무시.
- 메타를 찾을 수 없는 파일이 있으면 "양식 JSON을 넣으면 이 파일도 취합할 수 있어요" 안내와 [양식 JSON 넣기] 버튼.

### 2.2 검토 화면

```
┌ 양식 제목 · v2 · 파일 17개                                       [파일 더 넣기] ┐
│ [제출 12/15] [확인할 칸 9] [자동 정리 31] [제외 1] [미제출 3]   검산: ✓ 일치       │
├──────────────────────────────────────────────────────────────────────────┤
│ ▸ 파일                                                                      │
│ 지사/파일   │ 상태          │ 내용                          │ 처리             │
│ 서울        │ ✓ 정상        │ 24행 · 자동 정리 3칸            │ [제외]           │
│ 부산        │ ⚠ 확인할 칸 2 │ 수량 '약 10'(7행) …            │ [제외]           │
│ 대구        │ ⧉ 중복 2개    │ 최신 파일(10/13) 사용           │ [파일 바꾸기▼]   │
│ '에이지사'   │ ? 지사 확인   │ 목록에 없는 지사명              │ [지사 연결▼]     │
│ 광주        │ ⇄ 구조 변경   │ 열 순서 바뀜, 자동 맞춤          │                  │
│ 작년.xlsx   │ ⊘ 다른 양식   │ 양식 ID 불일치                  │ 자동 제외         │
│ 울산 …      │ ◷ 미제출      │                                │                  │
├──────────────────────────────────────────────────────────────────────────┤
│ ▸ 확인할 칸                                    [남은 것 모두 자동 수정안 적용]    │
│ 부산 · 7행 · 수량  │ 입력 '약 10' │ 수정안 10  │ (●) 수정안  ( ) 직접 [____]  ( ) 그대로 │
│ 부산 · 9행 · 품목  │ 입력 'notebook' │ 수정안 '노트북' │ …                       │
│ 대구 · 4행 · 참가일 │ 입력 '다음주' │ 수정안 없음 │ ( ) 직접 [____]  (●) 그대로      │
│ (확인) 칸 이름 '수 량' → '수량'으로 볼까요?          (●) 예  ( ) 아니오(추가 칸)  │
├──────────────────────────────────────────────────────────────────────────┤
│ 결과에 넣을 시트: ☑ 같은 틀(필수) ☐ 지사별 펼치기 ☐ 시트 모으기 ☑ 제출 현황      │
│ ☑ 수정된 회신 파일 사본도 받기 (직접 수정 3건)              [취합 파일 받기]       │
└──────────────────────────────────────────────────────────────────────────┘
```

**파일 표**
- 한 줄 = 한 지사(지사 목록이 없거나 지사를 모르는 파일은 파일명으로 한 줄).
- 모든 포함 파일에 [제외] 버튼(파일 단위 제외, 사유 "운영자 제외"로 기록). 운영자 결정이 더 필요한 것(중복·지사 연결)만 추가 버튼.
- 행을 펼치면 해당 파일의 읽기 결과(읽은/반영/제외 줄과 사유), 자동 정리 목록(원래 값 → 정리 값), 오류 목록, **작성자 메모 n개**(엑셀 메모), **읽지 않은 시트**(작성자가 추가한 계산용 시트 등)를 보여준다.
- 정렬: 확인 필요 → 정상 → 자동 처리 → 제외 → 미제출.

**확인할 칸** (값 오류 + 애매한 판단을 한 곳에)
- 값 오류 칸마다 **(수정안) / (직접 수정) / (그대로)** 중 선택. 목록 줄·여유 줄에서 나온 항목에는 **[이 줄 빼기]**도 둔다(입력칸에 메모처럼 적은 줄 등). 뺀 줄은 취합본에 넣지 않고 사유 "운영자 제외"로 파일목록·검산·판단 기록에 남긴다.
  - 수정안: `NormalizeResult.proposal`. 수정안이 없으면 이 선택지는 숨긴다.
  - 직접 수정: 입력한 값도 같은 `normalize()`로 검사해, 여전히 오류면 빨간 안내(저장은 함).
  - 그대로: 원래 값 그대로 넣고 노란색 + 오류 시트에 기록.
- 애매한 판단도 같은 목록에 예/아니오로: 비슷한 칸 이름, 쉼표로 여러 값(나눌까요?), 양식 시트를 하나로 정할 수 없음(메타 없는 파일에서 같은 틀 시트가 여러 개), 같은 줄 두 번, 빈칸채우기 같은 칸 충돌(어느 값?).
- **미결정 기본값**: 수정안이 있으면 수정안, 없으면 그대로. 판단 항목은 "예"가 아닌 보수적 기본값(칸 이름 → 맞춤, 여러 값 → 나누지 않음, 충돌 → 최신 파일 값).
- [취합 파일 받기]를 눌렀을 때 미결정 항목이 남아 있으면 "확인하지 않은 9칸은 자동 수정안으로 넣어요" 안내와 [목록 보기] / [그대로 받기]. 버튼을 비활성화하지 않는다. 판단 기록 시트에 **기본값 적용** 여부를 남긴다.

**결과 옵션**
- 결과 시트 체크박스의 기본값은 `schema.aggregations`. 필수 방식은 체크 고정. 현재 layout·지사 방식이 지원하는 방식만 표시.
- 직접 수정이 1건 이상이면 [수정된 회신 파일 사본도 받기] 체크박스(기본 켬).

### 2.3 결과 받기
- 취합본: `{양식제목}_취합_{YYYYMMDD-HHmm}.xlsx`
- 수정된 회신 파일 사본(선택): `{양식제목}_수정본_{YYYYMMDD-HHmm}.zip` 안에 `{원본파일명}_수정.xlsx`. 둘 다 받을 때는 취합본과 수정본 zip을 따로 내려받는다.
- 성공 시 "지사 12곳, 행 284개를 취합했어요 · 검산 일치" 요약. 검산 불일치면 내려받기 전에 경고와 차이 내역을 보여준다(받기는 가능).

## 3. 처리 파이프라인

```
files ─► ① identify ─► ② read ─► ③ normalize ─► ④ validate ─► ⑤ resolve(decisions)
      ─► ⑥ aggregate ─► ⑦ verify ─► ⑧ write (+ ⑨ patch copies)
```

모든 단계는 화면과 분리된 **순수 함수 또는 비동기 함수**로 만들고, 화면은 결과만 그린다. 결정이 바뀌면 ⑤부터 다시 계산한다. 파일 읽기(①~④)는 Web Worker에서 파일 단위로 병렬 처리한다.

### 3.1 내부 데이터 모델

```ts
interface LoadedFile { id: string; fileName: string; bytes: ArrayBuffer; lastModified: number; contentHash: string; }

type MetaSource = 'meta-sheet' | 'doc-props' | 'schema-json' | 'header-match' | 'none';

interface IdentifiedFile {
  file: LoadedFile;
  source: MetaSource;
  kind: 'submission' | 'aggregate' | 'unknown';
  formId?: string; formVersion?: number;
  meta?: FileMeta;                 // meta-sheet일 때
  orgFromFile?: string;            // 메타 orgName 또는 지사명 칸 값
  savedAt: string;                 // 문서 속성 modified → 없으면 file.lastModified
  status: 'ok' | 'other-form' | 'unreadable' | 'duplicate-content';
  skipReason?: string;             // unreadable일 때: '.xls 형식', '암호 걸림', '깨진 파일' 등
  notes: string[];                 // 예: '메타 변조 감지', '양식 버전 다름(v1)'
}

type ExcludeReason = 'blank' | 'example' | 'total' | 'operator';   // operator = 검토 화면의 [이 줄 빼기]

interface ReadResult {                       // ② 결과 (값 정리 전 원본)
  fileId: string;
  sheetName: string;
  header: Record<string, RawCell>;
  rows: { cells: Record<string, RawCell>; sourceRow: number; flags: RowFlag[] }[];
  matrix?: RawCell[][];
  grid?: Record<string, RawCell>;
  gridSpareRows?: { cells: Record<string, RawCell>; sourceRow: number; flags: RowFlag[] }[];
  excludedRows: { sourceRow: number; reason: ExcludeReason; preview: string }[];
  extraColumns: { header: string; values: { sourceRow: number; value: unknown }[] }[];  // 양식에 없는 칸
  authorNotes: { address: string; fieldKey?: string; sourceRow?: number; text: string }[];  // 작성자가 단 엑셀 메모
  unreadSheets: string[];          // 읽지 않은 시트(작성자가 추가한 계산용 시트 등)
  totalRowChecks: { sourceRow: number; fieldKey: string; written: number; computed: number }[];  // 합계 줄 대조용
  notes: string[];
}
interface RawCell { raw: unknown; address: string; comment?: string; fill?: 'ditto' | 'merged'; }

interface Issue {
  id: string;
  fileId: string;
  code: IssueCode | 'COLUMN_MISSING' | 'COLUMNS_REORDERED' | 'VERSION_MISMATCH' | 'META_TAMPERED'
      | 'META_MISSING' | 'FIXED_CELL_CHANGED' | 'TOTAL_MISMATCH' | 'IMAGE_NOT_COPIED'
      | 'EXTRA_SHEET' | 'TEXT_OUTSIDE_INPUT' | 'FORM_SHEET_MISSING';
  severity: 'value' | 'info';      // value = 확인할 칸 대상, info = 자동 처리 안내
  sheet: string; address?: string; // 원본 위치 — 수정본 사본에 쓸 때 필요
  location: string;                // 화면용: '목록 7행 수량'
  fieldKey?: string; fieldLabel?: string;
  raw?: unknown;
  proposal?: CellValue;            // 자동 수정안
  message: string;                 // 화면·결과 파일용 한국어 문장
}

interface Question {               // 애매한 판단 (값 오류가 아닌 것)
  id: string; fileId?: string;
  kind: 'column-alias' | 'split-values' | 'multi-sheet' | 'same-row-twice' | 'grid-conflict';
  message: string;
  choices: { id: string; label: string }[];
  defaultChoice: string;
}

interface ParsedSubmission extends NormalizedSubmission {
  fileId: string;
  issues: Issue[];
  autoFixed: { address: string; fieldKey: string; from: unknown; to: CellValue }[];
}

interface Decisions {
  cellFix: Record<string /*issueId*/, { mode: 'proposal' | 'manual' | 'keep'; value?: CellValue } | undefined>;
  answers: Record<string /*questionId*/, string | undefined>;
  excludeFile: Record<string /*fileId*/, boolean>;
  excludeRow: Record<string /*fileId:sourceRow*/, boolean>;   // [이 줄 빼기]
  duplicateChoice: Record<string /*org*/, string /*fileId*/>;
  orgLink: Record<string /*fileId*/, string /*org*/>;
}
```

### 3.2 ① 식별 (identify)

순서대로 시도한다.
1. `contract/metaIO.readMeta()` 성공 + 체크섬 일치 → `source = 'meta-sheet'`
2. 체크섬 불일치 → 메타를 버리고 `META_TAMPERED` 기록 후 3으로
3. `docProps/custom.xml`의 `kdhc.formId` 있음 → `source = 'doc-props'`. 셀 위치는 같은 `formId`의 다른 파일 메타 또는 양식 JSON에서 가져온다.
4. 둘 다 없음 → 기준 양식(다른 파일의 메타 또는 양식 JSON)의 머리글 이름과 **일치율**을 계산. 70% 이상이면 `source = 'header-match'`(새 파일에 복사해 보낸 경우). 아니면 `unreadable`.

**기준 양식 정하기**: 식별된 파일들 중 가장 많은 `formId`를 기준 양식으로 한다(운영자가 바꿀 수 있음). 기준과 `formId`가 다른 파일은 `other-form`(자동 제외). 같은 `formId`에서 `formVersion`이 다르면 가장 높은 버전의 schema를 기준으로 하고, 낮은 버전 파일은 `VERSION_MISMATCH`(info) 후 머리글 매칭으로 읽는다.

**내용 완전 동일**: `contentHash`(입력 시트 값 기준 해시)가 같은 파일은 하나만 남기고 나머지는 `duplicate-content`(묻지 않고 제외, 파일목록에 기록). 지사 목록 유무와 관계없이 적용.

**시트 모으기형(`layout = 'collect'`)**: 위 1~3만 쓴다. 4(머리글 일치율)는 적용하지 않는다. 자유 서식이라 비교할 머리글이 없기 때문이다. 따라서 메타도 파일 속성도 없는 파일(새 파일에 복사한 경우, 한난MOA로 만들지 않은 일반 엑셀)은 **`other-form`으로 자동 제외**하고 "한난MOA 양식 파일이 아니에요"로 표시한다. 운영자가 지사를 연결해 포함시키는 기능은 두지 않는다. `doc-props`로 식별된 파일은 속성의 `kdhc.org`를 제출처로 쓴다. `contentHash`는 모을 시트들의 값 기준으로 계산한다.

**취합본**: `kind = 'aggregate'`이면 `_records`를 읽어 `NormalizedSubmission[]`으로 풀고, 각각을 제출본 하나처럼 이후 단계(⑤부터)에 넣는다(`sourceFile`은 "취합본파일명 › 원본파일명"). 이미 정리된 값이므로 ②~④는 건너뛴다.

### 3.3 ② 읽기 — 엑셀 모양 해석 (read)

> **시트 모으기형은 ②~④와 ⑦의 칸 단위 처리를 모두 건너뛴다.** 대신 "모을 시트"만 정한다.
> - `scope: 'report'`(기본): 메타 `sheetName`의 시트. 이름이 바뀌었으면 `_meta`·숨김 시트를 뺀 **첫 번째 보이는 시트**.
> - `scope: 'all'`: `_meta`·`_records`·숨김 시트를 뺀 보이는 시트 전부(파일 안 순서대로).
> - 검토 화면의 '내용' 칸에 모을 시트 이름을 보여준다(예: "보고서 · 사진 시트는 모으지 않음").
> - 그림·차트·도형은 MVP에서 옮기지 않는다(로드맵). 모을 시트에 그림·차트가 있으면 `IMAGE_NOT_COPIED`(info)로 "그림 n개는 옮겨지지 않았어요"를 남긴다.

**읽는 범위 (양식 시트의 입력칸)** — 양식 시트는 입력칸만 편집할 수 있다(`00-overview.md` M20)
- **양식 시트 하나만 읽는다.** `_meta`의 `sheetName` → 머리글 일치율 순으로 찾는다(이름이 바뀌어도 찾음). 못 찾으면 `FORM_SHEET_MISSING`으로 파일 제외("양식 시트가 없어요").
- 그 밖의 보이는 시트(작성자가 추가한 계산용 시트 등)는 **읽지 않는다.** `unreadSheets` → `EXTRA_SHEET`(info), 파일목록에 "읽지 않은 시트: 계산용".
- 양식 시트에서는 `CellMap`의 입력칸만 읽는다. 인쇄영역이 없으면 `CellMap` 범위를 쓰고, 그래도 안 맞으면 머리글 행 탐색으로 표를 찾는다.
- 보호가 풀린 사본(메타 없이 새 파일에 복사 등)에서 입력칸 밖에 글이 있으면 데이터로 섞지 않고 `TEXT_OUTSIDE_INPUT`(info)으로 위치·내용을 기록한다. "메모 줄"·"인쇄영역 밖 메모"라는 구분은 두지 않는다.
- 메타 없는 파일에서 같은 틀의 시트가 여러 개면 어느 것이 양식 시트인지 확인(`multi-sheet`).

**칸 맞추기**
- 지사명: preset 파일은 메타 `orgName`. input 파일은 `cellMap.orgCell`의 값. none은 없음.
- fields 블록: `cellMap`의 `valueCell`에서 값을 읽는다. `labelCell`의 글자가 `field.label`과 다르면 **같은 시트에서 그 라벨을 찾아 오른쪽 칸**을 읽는다.
- list 블록: `headerRow`의 각 열 머리글을 `field.label`과 비교한다.
  - 모두 일치 → `cellMap.columns` 사용
  - 다르면 → 머리글 행(±3행)에서 **칸 이름으로 열을 다시 찾는다**. 앞뒤 공백·대소문자·`*`는 자동 무시, 그 외 비슷한 이름(예: "수 량")은 확인(`column-alias`). 순서만 바뀌었으면 `COLUMNS_REORDERED`(info), 못 찾은 열은 `COLUMN_MISSING`(info)이고 값은 null.
  - 양식에 없는 칸은 버리지 않고 `extraColumns` → `추가 칸` 시트.
- matrix 블록: `cells[r][c]` 주소에서 읽는다. 행·열 제목이 다르면 제목 이름으로 위치를 다시 찾는다. 합계 행·열은 값으로 읽지 않고 `totalRowChecks`로만 쓴다.
- grid 블록: `inputCells` 주소에서 읽는다. `fixedCells`와 다른 값이 있으면 `FIXED_CELL_CHANGED`(info, 값은 무시). 여유 줄 범위의 값 있는 행은 `gridSpareRows`.

**계산 칸** (`01-contract.md` 3.1절): 계산 칸(`type: 'calc'`, 표형 계산 행·열, 빈칸채우기 계산 칸)은 **읽지 않는다**(검증·값 정리 대상 아님). 같은 틀 시트·지사별 펼치기에서는 `contract/formula`의 `compute*` 함수로 **합친 입력값에서 다시 계산**한다. 목록 계산 열은 각 줄의 입력값으로, 위쪽 정보 계산 항목은 그 제출의 값으로 계산해 자동 칸에 넣는다. `layoutSheet`의 aggregate 모드는 목록 줄 값에 계산 칸이 없으면 직접 계산한다.

**모양 속 숨은 뜻**

| 모양 | 처리 |
|---|---|
| 숨긴 줄·필터로 가린 줄 | **넣고** `flags: ['hidden']` → 상태 칸 `숨긴 줄`, 같은 틀 시트에서 흐리게 |
| 취소선 | **넣고** `flags: ['strike']` → 상태 칸 `취소선`, 취소선 서식 유지 |
| 합친 셀 | 병합 범위의 모든 줄에 같은 값(자동, `fill: 'merged'`) |
| `〃`, `"`, `상동`, `위와 같음` | 윗줄 값으로 채움(자동, `fill: 'ditto'`, 원래 값은 메모) |
| 선택목록 칸에 쉼표로 여러 값 | 확인(`split-values`): 나눠서 여러 줄로 / 그대로 |
| 작성자 메모(엑셀 메모, 입력칸에 단 것) | `authorNotes`로 모아 같은 틀 시트의 같은 칸에 그대로 옮기고, `메모` 시트에 목록으로도 남김. 우리가 단 자동 메모(`[자동]`으로 시작)는 다시 취합할 때 제외 |
| 수식 칸 | 결과 값 사용. 깨진 수식(`#REF!` 등)은 `FORMULA_ERROR` |

**줄 고르기** (list 블록, grid 여유 줄)
- 제외: 빈 줄(입력칸이 모두 빈 줄, 번호 칸은 보지 않음), **예시 줄**(`exampleRow` 위치이면서 `schema`의 예시와 같은 값), **합계 줄**(어느 칸이든 "합계/소계/계/총계"). 사유와 함께 `excludedRows` → `파일목록` 시트.
- 그 밖의 줄은 모두 데이터다. 입력칸에 메모처럼 적은 줄도 짐작해서 빼지 않는다 — 필수 빈칸 등으로 확인할 칸에 뜨고, 운영자가 [이 줄 빼기]로 뺀다(`operator`).
- 합계 줄은 제외하되 숫자 칸 값을 위 줄들의 합과 대조할 수 있도록 `totalRowChecks`에 남긴다.
- 한 파일 안에서 모든 칸이 같은 줄 → 확인(`same-row-twice`): 둘 다 넣기 / 하나만.
- 입력 줄이 하나도 없는 파일 → 파일목록에 `제출 · 해당 없음`으로 따로 표시(오류 아님).

### 3.4 ③ 값 정리 (normalize)

- 모든 칸에 `FIELD_TYPES[type].normalize(raw, field, ctx)`를 적용한다(`01-contract.md` 5절 표). `ctx.year`는 취합 연도.
- `auto` → 정리 값 사용, `autoFixed`에 원래 값 기록 → 같은 틀 시트에서 연한 파란색 + 원래 값 셀 메모.
- `proposal` / `invalid` → `Issue`(severity `value`, `proposal` 포함) → 확인할 칸.

### 3.5 ④ 검증 (validate)

- 필수 항목이 빈칸 → `REQUIRED_EMPTY` (list는 반영 행에만, grid는 필수 입력칸에 대해 **모든 제출을 겹친 뒤** 빈칸이면 1건)
- ③에서 나온 타입·서식 오류
- 모두 `severity: 'value'`

### 3.6 ⑤ 결정 (resolve) — 정책 표 (`00-overview.md` 5.1)

| 상황 | 판정 | 기본 상태 | 운영자 동작 |
|---|---|---|---|
| 값 오류 칸 | 확인할 칸 | 수정안 있으면 수정안, 없으면 그대로 | 수정안 / 직접 수정 / 그대로 |
| 애매한 판단 | 확인할 칸 | `Question.defaultChoice` | 선택지 |
| 모든 포함 파일 | — | 포함 | [제외] |
| 구조 변경 | 자동 | 포함 | 없음(안내만) |
| 다른 양식 / 내용 완전 동일 | 자동 | 제외 | 없음 |
| 같은 지사 파일 2개 이상 (지사 사용 시) | 자동 + 변경 가능 | `savedAt`이 가장 늦은 파일 | [파일 바꾸기▼] |
| 지사명이 목록 밖 / 지사 불명 (지사 사용 시) | 결정 필요 | 미결정 → 파일명으로 표시해 포함 | [지사 연결▼] 목록에서 선택 또는 "입력값 그대로 사용" |

- 지사 목록: `schema.org.orgs`. input 모드에 목록이 없으면 "목록 밖" 판정은 하지 않는다(입력값 그대로 사용). none 모드는 지사 관련 판정을 하지 않는다(파일 하나 = 응답 하나).
- 지사 연결 후 다른 파일과 같은 지사가 되면 중복 규칙을 다시 적용한다. 취합본 안의 지사와 직접 제출된 같은 지사도 중복 규칙을 적용한다.
- 결정 반영 결과: 포함된 `ParsedSubmission[]`의 값에 `cellFix`를 적용한 **최종 값**. 직접 수정·수정안 적용 칸은 같은 틀 시트에서 연한 파란색 + "원래 값: …, 수정: 운영자/수정안" 메모.

### 3.7 ⑥ 취합 (aggregate) — 플러그인 구조

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
  submissions: ParsedSubmission[];      // 결정 반영 후 포함된 것만, 최종 값
  allFiles: IdentifiedFile[];           // 제출 현황·파일목록용
  decisions: Decisions;
  issues: Issue[];
  sourceWorkbooks: Map<string, ExcelJS.Workbook>;  // 시트 모으기용
}
type ResultSheet =
  | { type: 'model'; model: SheetModel }                     // 같은 틀 시트 (contract/layout 결과)
  | { type: 'table'; name: string;                           // 일반 표 시트
      columns: { header: string; width?: number; numFmt?: string }[];
      rows: CellValue[][];
      marks?: { row: number; col: number; mark: 'error' | 'auto-fixed'; note: string }[] }
  | { type: 'copy'; name: string; fileId: string; sheetName: string };   // 시트 모으기
// src/aggregator/methods/index.ts — 여기에 한 줄 추가하면 화면에 자동 노출
export const METHODS: AggregationMethod[] = [sameFrame, spread, collectSheets, submissionStatus];
```

**같은 틀 시트 (`same-frame`, 항상)** — `contract/layout.layoutSheet(schema, { mode: 'aggregate', info, data })`로 만든다. 모양은 `01-contract.md` 7.2절.

| layout | 채우는 값 |
|---|---|
| list | 지사 순서(목록 순 → 가나다, none은 파일명 순) × 각 제출의 반영 행. 자동 칸: `지사`, `출처 파일`, `원본 줄`, `상태` |
| header-list | 위와 같고, 머리정보 항목들을 줄마다 반복해 자동 칸에(`출처 파일` 앞). 목록 행이 0개인 제출은 머리정보만 1행 |
| matrix | 칸마다 모든 제출의 숫자 합. 합계 행·열은 다시 계산한 값. 오류로 그대로 둔 칸(숫자 아님)은 합에서 빼고 칸 메모에 "제외된 값 n개" |
| fill-in | 입력칸마다 모든 제출의 값을 겹침: 0개 → 빈칸, 1개 또는 모두 같음 → 그 값(출처는 셀 메모), 서로 다름 → 확인(`grid-conflict`, 기본은 최신 파일 값). 여유 줄 자리에 모든 제출의 추가 행을 이어 붙임(자동 칸 `지사`, `출처 파일`, `원본 줄`) |

- 2행 정보칸: `취합일 2026-11-06 · 파일 12개 · 오류 2 · 검산 일치`
- `상태` 칸 값: `숨긴 줄`, `취소선`, `오류`, `자동 정리`, `수정` (여러 개면 쉼표)
- 오류로 그대로 둔 칸 노란색 + 오류 내용 메모, 자동 정리·수정 칸 연한 파란색 + 원래 값 메모, 숨긴 줄 흐리게, 취소선 유지.

**선택 시트**

| ID | 시트 이름 | 열 | 행 |
|---|---|---|---|
| `spread` | 지사별 | `지사`(none이면 `출처 파일`), matrix: `{행제목} {열제목}` 모든 조합 / header-list: 머리정보 항목들 + `목록 행 수` / fill-in: 입력칸 이름들 | 제출당 1행. matrix는 마지막에 `합계` 행 |
| `collect-sheets` | 지사명(또는 파일명) 각각 | 원본 그대로 | 원본 입력 시트의 값·서식·병합·열 너비·줄 높이를 복사(보호·유효성 검사·메타 제외). 취합본 입력이면 취합본 안의 지사별 시트를 복사 |
| `submission-status` | 제출 현황 | `지사`, `상태`, `파일명`, `저장 시각`, `반영 행 수`, `오류 수`, `수정 수`, `처리` | 지사 목록 전체(+ 목록 밖 지사). 상태: 제출 / 해당 없음 / 미제출 / 제외(다른 양식·운영자 제외) |

**시트 모으기형의 `collect-sheets` (필수)** — 같은 틀 시트 대신 아래를 만든다.

| 시트 | 내용 |
|---|---|
| `목차` (맨 앞) | 1행 양식 제목, 2행 `취합일 · 파일 n개 · 미제출 n`. 표: `{org.label}`(none이면 `번호`) · `상태`(제출/미제출/제외) · `원본 파일` · `저장 시각` · `모은 시트` · `바로가기`. `바로가기`는 해당 시트로 이동하는 엑셀 내부 링크(`#'서울'!A1`) |
| 제출처별 시트 | 시트 이름 = 제출처명(none이면 원본 파일 이름). `scope: 'all'`이면 보고서 시트 = 제출처명, 나머지 = `{제출처명}_{원래 시트명}`. 순서 = 지사 목록 순 → 가나다 |

- 시트 이름은 엑셀 규칙에 맞춘다: 31자 이하, `\ / ? * [ ] :` → `_`, 같은 이름이면 `(2)`를 붙인다.
- 각 시트의 A1 셀 메모에 "원본: {파일명} · 저장 {시각}"을 단다.
- 미제출 제출처(preset)는 목차에만 `미제출`로 적고 시트는 만들지 않는다.

- 결과 값은 타입·서식대로 저장한다: number는 숫자 + 양식의 `excelNumFmt`, date는 엑셀 날짜(연도형은 숫자).
- 표 시트 머리글 행 굵게·연회색, 틀 고정, 자동 필터.

### 3.8 ⑦ 검산 (verify)

취합 결과를 내려받기 전에 계산해 검토 화면 상단과 `검산` 시트에 보여준다. 하나라도 안 맞으면 경고.

| 검사 | 내용 |
|---|---|
| 줄 수 | 파일별·전체 `읽은 줄 = 반영 + 제외(사유별: 빈 줄·예시·합계·운영자 제외·중복)` |
| 취합 누락 | 넣은 파일 수 = 반영 + 제외(사유별) + 건너뜀(사유별). 지사 사용 시 미제출 지사 목록 |
| 숫자 합계 | 숫자 칸마다 `원본 합계(값 정리 후) = 같은 틀 시트 합계`. 수정·제외로 생긴 차이는 별도 줄로 표시(예: "수정으로 +5, 운영자 제외로 -120") |
| 수식 검산 | 표형 합계 행·열: 원본 파일의 합계 칸 값 = 원본 칸들의 합. 목록에서 제외한 합계 줄(`totalRowChecks`): 적힌 합계 = 위 줄들의 합. 안 맞으면 `TOTAL_MISMATCH`(info)로 해당 파일 표시 |
| 빈칸채우기 | 입력칸 수 = 채워진 칸 + 빈칸(필수 빈칸 수 별도), 충돌 칸 수 |

### 3.9 ⑧ 결과 파일 쓰기 (write)

시트 순서:
1. 같은 틀 시트 (시트 이름 = 양식 제목)
2. 선택한 방식들의 결과 시트 (`METHODS` 순서)
3. `오류` (항상): `지사 | 파일명 | 위치 | 항목 | 입력값 | 내용 | 처리(수정안/직접 수정/그대로/자동)` — info 포함 모든 Issue
4. `파일목록` (항상): 파일별 상태, 읽은/반영/제외 줄과 사유, 해당 없음, 읽지 않은 시트, 건너뛴 파일과 사유
5. `검산` (항상): 3.8 결과
6. `판단 기록` (항상): 확인할 칸·애매한 판단·지사 연결·중복 선택·파일 제외의 결정 전체, 기본값 적용 여부
7. `메모` (있을 때만): 작성자가 단 엑셀 메모 목록 (지사 · 파일명 · 위치 · 항목 · 원본 줄 · 메모 내용)
8. `추가 칸` (있을 때만): 양식에 없는 칸 (파일·원본 줄·칸 이름·값)
9. `_records` (veryHidden): 포함된 `NormalizedSubmission[]` (최종 값, `01-contract.md` 4.5)
10. `_meta` (veryHidden): `kind: 'aggregate'`, `aggregate.includedSources`, `methods` — `contract/metaIO.writeMeta()` 사용

**시트 모으기형의 시트 순서**: `목차` → 제출처별 시트 → `제출 현황`(선택 시) → `오류`(info만: 그림 미복사 등, 있을 때만) → `파일목록` → `판단 기록` → `_records`(빈 배열) → `_meta`. `검산`·`메모`·`추가 칸` 시트는 만들지 않는다. ⑨ 수정된 회신 파일 사본도 해당 없다.

- 결과 파일은 보호하지 않는다(운영자가 자유롭게 편집). 인쇄영역 = 제목 ~ 마지막 줄.
- 파일 속성 이중 기록은 `contract/xlsxPatch` 사용(구조 보호는 넣지 않는다).

### 3.10 ⑨ 수정된 회신 파일 사본 (patch copies)

- 대상: **직접 수정**이 1건 이상 있는 파일. (수정안 적용 칸도 함께 반영할지는 체크박스, 기본 켬)
- 방법: 원본 바이트를 ExcelJS로 다시 열어 `Issue.sheet`·`address` 칸의 값을 바꾸고, 그 칸에 "취합 시 수정 (2026-11-06): 원래 값 '약 10'" 메모를 단다. `_meta`·파일 속성은 그대로 둔다(체크섬 대상이 아니므로 유지됨).
- 원본 파일은 건드리지 않는다(브라우저는 사용자 PC의 원본을 덮어쓸 수 없음). 사본은 zip으로 내려받는다.
- 주의: ExcelJS 왕복 시 일부 서식(조건부 서식·도형 등)이 빠질 수 있다 → 0단계 호환성 테스트에서 확인하고, 빠지는 항목은 화면에 "사본에서는 일부 서식이 빠질 수 있어요" 안내.

## 4. 폴더 구조

```
src/aggregator/
  pages/AggregatePage.tsx
  upload/        DropZone.tsx, unzip.ts, fileGuard.ts (.xls·암호·깨진 파일 판별)
  pipeline/      identify.ts, read/ (printArea.ts, headerMatch.ts, rowFilter.ts, shapes.ts), normalize.ts,
                 validate.ts, resolve.ts, aggregate.ts, verify.ts, write.ts, patchCopies.ts
  worker/        readWorker.ts (①~④를 Web Worker에서)
  methods/       types.ts, index.ts, sameFrame.ts, spread.ts, collectSheets.ts, submissionStatus.ts
  review/        SummaryCards.tsx, FileTable.tsx, FileRow.tsx, FixList.tsx, VerifyCard.tsx, MethodPicker.tsx
  state/         aggregateStore.ts (useReducer)
  __tests__/
```

## 5. 성능 기준
- 파일 20개 3초 이내, 파일 100개·총 10만 행 10초 이내(최신 노트북, Chrome).
- 파일 읽기는 Web Worker에서 병렬. UI가 멈추지 않도록 파일 단위로 진행률 표시.
- 결정 변경 시 ⑤~⑦만 다시 계산(①~④ 결과는 캐시).

## 6. 완료 기준

1. `fixtures/`의 모든 파일을 넣으면 각 파일이 표(`01-contract.md` 8절)의 의도대로 분류된다.
2. 오류·예외 정책이 정책 표대로 동작한다. 미결정 칸은 자동 수정안으로 들어가고 판단 기록에 남는다.
3. 같은 틀 시트가 구조 4종 모두에서 빈 양식과 같은 틀이다(머리글 위치·서식 일치). 선택 시트가 명세대로 나온다.
4. `messy__*` 파일들을 넣어도 검산(줄 수·숫자 합계)이 일치한다.
5. 직접 수정한 칸이 취합본과 수정본 사본에 모두 반영되고, 수정본 사본을 다시 넣으면 그 칸이 오류 없이 읽힌다.
6. 본부 취합본 2개를 다시 취합한 결과가, 같은 지사 파일들을 직접 취합한 결과와 같다.
7. 결과 파일을 MS Excel에서 열면 숫자·날짜가 계산 가능한 값이고, 오류 칸 노란색·자동 정리 칸 연한 파란색 + 원래 값 메모가 보인다.
8. 성능 기준을 만족한다. 처리 중 네트워크 요청이 없다.
9. 시트 모으기형: 모양이 서로 다른 `collect__ok_*` 3개가 목차 + 제출처별 시트로 모양 그대로(값·서식·합친 셀·열 너비·줄 높이) 모인다. `scope`에 따라 추가 시트 포함 여부가 바뀐다. `collect__meta-deleted`·`collect__not-moa`는 제외된다.

## 7. 테스트

| 대상 | 내용 |
|---|---|
| identify | 메타 정상 / 변조 / 시트 삭제(속성만) / 모두 없음(머리글 일치율) / 다른 양식 / 버전 다름 / 취합본 / 내용 완전 동일 / .xls·암호·깨진 파일 |
| read | 양식 시트 찾기(이름 변경·삭제), 추가 시트 무시, 열 순서 변경·삭제·비슷한 이름, 추가 칸, 숨긴 줄·필터, 취소선, 합친 셀, `〃`, 빈/예시/합계 줄, 입력칸에 메모처럼 적은 줄(데이터로 읽힘), 작성자 엑셀 메모 수집, 보호 풀린 사본의 입력칸 밖 글(info), grid 고정 칸 변경·여유 줄 |
| normalize | `01-contract.md` 5절 표의 모든 예시 (타입 × ok/auto/proposal/invalid) |
| validate | IssueCode 8종, grid 필수 칸은 겹친 뒤 판정 |
| resolve | 미결정 기본값, 수정안/직접/그대로, 파일 제외, 줄 빼기, 중복 기본값(최신)·파일 바꾸기, 지사 연결 후 중복 재판정, none 모드 |
| methods | 같은 틀 시트 구조 4종 + 선택 시트 3종 입력 → 기대값 비교 |
| verify | 줄 수 대조, 숫자 합계 대조(수정·제외 차이 분리), 합계 줄·합계 행 수식 검산 |
| write | 결과 파일을 다시 열어 시트 순서, `_records`·`_meta` 왕복, 오류·자동 정리 칸 서식과 메모 |
| patch copies | 수정 칸 값·메모, `_meta` 유지, 사본 재입력 시 오류 없음 |
| 다시 취합 | 본부 취합본 2개 → 결과 = 직접 취합 결과 |
| 시트 모으기형 | 모을 시트 고르기(report/all, 시트 이름 바뀜), 메타 없는 파일·일반 엑셀 제외, 시트 이름 규칙(31자·금지문자·중복), 목차 링크, 복사 후 합친 셀·열 너비·줄 높이 일치, 그림 있는 시트 info 기록, 취합본 다시 취합 |
| 성능 | 100파일 × 1,000행 합성 데이터 10초 이내 |
