# 02. 생성 파트 — 양식 빌더와 엑셀 생성 (개발자 1)

> 함께 읽을 문서: `00-overview.md`, `01-contract.md`
> 담당 코드: `src/generator/` (+ `fixtures/` 생성 스크립트)
> 금지: `src/aggregator/` import, `src/contract/` 단독 수정

---

## 1. 이 파트가 하는 일

운영자가 웹 화면에서 양식을 정의하면, **실시간 미리보기**를 보여주고, 공통 계약에 맞는 **엑셀 파일**(지사별 zip 또는 단일 파일)과 **양식 JSON**을 내보낸다.

하지 않는 일: 제출된 파일 읽기, 검증, 취합.

## 2. 화면

### 2.1 시작 화면
- [새 양식 만들기] → 빈 빌더 (기본 layout: `header-list`)
- [양식 JSON 불러오기] → 파일 선택 → `validateSchema()` 통과 시 빌더로. 실패 시 "이 파일은 양식 파일이 아니에요" 안내
- 브라우저 `localStorage`에 마지막 편집 중인 양식 자동 저장(편의 기능, 실패해도 동작에 영향 없음)

### 2.2 빌더 화면 (2단 구성)

```
┌──────────────────────────────────────────────────────────────┐
│ 양식 제목                           [양식 JSON 저장] [엑셀 내보내기] │
├──────────────────────┬───────────────────────────────────────┤
│ ① 기본 정보           │  실시간 미리보기         미리보기 지사: [서울▼] │
│ ② 양식 구조           │  ┌───────────────────────────────────┐ │
│ ③ 항목 (블록별 목록)   │  │ 엑셀처럼 생긴 표                    │ │
│ ④ 취합 방식           │  │ 잠긴 칸 / 필수 입력칸 표시           │ │
│ ⑤ 지사/기관           │  └───────────────────────────────────┘ │
└──────────────────────┴───────────────────────────────────────┘
```

| 영역 | 내용 |
|---|---|
| ① 기본 정보 | 제목(필수), 작성 안내, 제출 기한(날짜), 문의처 |
| ② 양식 구조 | 목록형 / 표형 / 혼합형. 바꾸면 블록을 해당 구조로 재구성하고, 기존 항목은 가능한 한 유지(이동 불가한 항목은 확인 창) |
| ③ 항목 | 블록별 항목 목록. 추가·삭제·끌어서 순서 변경(dnd-kit). 항목을 누르면 편집 패널: 이름, 타입, 필수, 안내, 타입별 옵션. 표형은 행 제목·열 제목 목록 편집, 합계 행 여부 |
| ④ 취합 방식 | `AGGREGATION_SUPPORT`에서 현재 layout이 지원하는 방식만 체크박스로. 1개 이상 필수. 기본값: 구조별 대표 방식 + 제출 현황표 |
| ⑤ 지사/기관 | [목록 있음 / 목록 없음]. 목록 있음: 텍스트 영역에 붙여넣기(줄바꿈 또는 탭 구분) 또는 xlsx/csv 첫 열 불러오기. 중복·빈 줄 자동 제거, 개수 표시. 목록 없음에서도 참고 목록을 넣으면 지사명 칸이 드롭다운이 됨 |

**입력 검증 (내보내기 전)**: 제목 없음, 항목 0개, 같은 블록 안 이름 중복, 목록 선택의 선택지 없음, preset인데 지사 0개, 표형 행·열 제목 없음 → 해당 위치에 빨간 안내, 내보내기 버튼을 누르면 첫 오류 위치로 이동.

### 2.3 내보내기
- preset 모드: 지사마다 `{양식제목}_{지사명}.xlsx`를 만들어 `{양식제목}_배포용.zip`으로 다운로드
- input 모드: `{양식제목}.xlsx` 1개
- 파일명에 쓸 수 없는 문자(`\/:*?"<>|`)는 `_`로 바꾼다.
- 이미 내보낸 양식을 수정해 다시 내보내면 `formVersion`을 1 올린다. `formId`는 유지한다. (화면에 "버전 2로 내보냅니다" 표시)
- [양식 JSON 저장]: `{양식제목}.form.json` (= `FormSchema` 그대로)

## 3. 핵심 구조: 미리보기와 파일이 반드시 같게

```
FormSchema ─► layoutEngine(schema, orgName?) ─► SheetModel ─┬─► <PreviewGrid/>  (HTML)
                                                             └─► writeWorkbook()  (ExcelJS) ─► xlsxPatch ─► Blob
                                                                    └─ CellMap도 SheetModel에서 추출
```

```ts
// src/generator/layout/sheetModel.ts
interface SheetModel {
  sheetName: string;                 // '입력' 고정
  columns: { width: number }[];
  cells: ModelCell[];                // 값이 있거나 서식이 있는 칸만
  merges: string[];                  // 예: 'A1:E1'
  validations: { address: string; rule: ExcelJS.DataValidation }[];  // 범위 주소 허용 'C7:C106'
  cellMap: CellMap;
}
interface ModelCell {
  address: string;                   // 'B4'
  value?: string | number;
  role: 'title' | 'guide' | 'label' | 'header' | 'input' | 'locked-value' | 'row-number';
  required?: boolean;
  numFmt?: string;
  wrap?: boolean;
}
```

- `layoutEngine`은 **순수 함수**(입력이 같으면 출력이 같음, 화면·파일 접근 없음)로 만든다. 테스트의 중심이다.
- `PreviewGrid`와 `writeWorkbook`은 `role`별 스타일 표(`styles.ts`) 하나를 공유한다.
- 미리보기에서 list 블록은 처음 5행 + "… (총 100행)" 줄로 줄여 보여준다.

## 4. 엑셀 생성 규칙

배치는 `01-contract.md` 7절을 따른다.

| role | 서식 | 잠금 |
|---|---|---|
| title | 굵게 14pt, 병합 | 잠금 |
| guide | 회색 10pt, 줄바꿈, 병합 | 잠금 |
| label / header | 굵게, 연회색 배경, 테두리. 필수면 이름 뒤 ` *` | 잠금 |
| input | 흰 배경, 테두리. 필수면 연노랑 배경 | **잠금 해제** |
| locked-value | 회색 글자 (preset 지사명) | 잠금 |
| row-number | 회색, 가운데 | 잠금 |

- 항목 타입별 입력 규칙과 서식은 `FIELD_TYPES[type].excelValidation()`, `excelNumFmt()`를 사용한다(직접 만들지 않는다).
- 안내(`help`)는 데이터 유효성 검사의 입력 메시지(`showInputMessage`, `prompt`)로 넣는다.
- 오류 메시지: `showErrorMessage: true`, 스타일 `stop`, 메시지 "{항목명}: {규칙 설명}" (예: "참가일: 날짜를 입력하세요 (예: 2026-10-20)")
- 시트 보호: `worksheet.protect(PROTECT_PASSWORD, { selectLockedCells: true, selectUnlockedCells: true, formatCells: false, insertRows: false, deleteRows: false })`
- 틀 고정: list 블록 머리글 행 아래로 고정
- 인쇄: 가로 방향, 너비 1페이지 맞춤
- 메타: `contract/metaIO.writeMeta()` 호출 (`kind: 'submission'`, `orgName`, `sheetName`, `cellMap`, checksum 포함)
- 후처리: `contract/xlsxPatch` (파일 속성, 통합문서 구조 보호)
- 통합문서 속성: `creator = 'KDHC-HA-Pro'`

## 5. 폴더 구조

```
src/generator/
  pages/StartPage.tsx, BuilderPage.tsx
  builder/            ① ~ ⑤ 패널 컴포넌트, FieldEditor.tsx
  state/              formReducer.ts (useReducer), actions.ts, validateForExport.ts
  layout/             layoutEngine.ts, sheetModel.ts, styles.ts
  preview/            PreviewGrid.tsx
  export/             writeWorkbook.ts, exportZip.ts, exportJson.ts, fileName.ts
  __tests__/
scripts/
  make-fixtures.ts    fixtures/ 생성 (01-contract.md 8절 목록)
```

## 6. fixtures 생성 스크립트

`npm run fixtures`로 `fixtures/`의 파일을 만든다. 생성 파트 코드(`layoutEngine`, `writeWorkbook`)로 정상 파일을 만든 뒤 ExcelJS로 값을 채우고, 상황별로 변형한다(열 순서 바꾸기, `_meta` 삭제, 메타 JSON 수정 등).
**0단계에서는 생성 파트가 아직 없으므로**, 이 스크립트의 첫 버전은 ExcelJS로 직접 배치를 만들어 계약만 지키면 된다. 2단계에서 실제 생성 코드로 바꾼다.

## 7. 완료 기준

1. 세 가지 구조 각각으로 양식을 만들어 내보낼 수 있다.
2. 미리보기의 칸 배치와 내보낸 파일의 칸 배치가 같다(테스트로 확인).
3. 내보낸 파일을 MS Excel에서 열면: 입력칸만 편집 가능, 드롭다운·숫자·날짜 제한 동작, 안내 메시지 표시, `_meta` 시트가 보이지 않음.
4. preset 15개 지사 → zip 안에 파일 15개, 각 파일의 지사명 칸과 메타 `orgName`이 일치.
5. 양식 JSON 저장 → 불러오기 → 같은 파일이 생성된다.
6. 내보내기 중 네트워크 요청이 없다.

## 8. 테스트

| 대상 | 내용 |
|---|---|
| `layoutEngine` | 구조 3종 × (preset/input) 스냅샷. `cellMap`의 모든 주소가 `cells`에 존재 |
| `writeWorkbook` | 생성한 버퍼를 ExcelJS로 다시 열어: 입력칸 unlocked, 머리글 locked, 유효성 검사 범위, `readMeta()` 왕복, veryHidden |
| `validateForExport` | 2.2의 오류 조건 각각 |
| 파일명 | 금지 문자 치환 |
| 버전 | 재내보내기 시 `formVersion` 증가, `formId` 유지 |
