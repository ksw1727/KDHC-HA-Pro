# 단일 HTML 프로토타입 (양식생성 · 양식취합)

`docs/prd/`의 React 앱과 별개로, **`index.html` 파일 하나**로 동작하는 시험판입니다. 기획 문서는 [`docs/`](docs/진PRD.md)에 있습니다.

- 실행: `index.html`을 더블클릭 → Chrome/Edge에서 열림 (엑셀 부품 ExcelJS를 CDN에서 받으므로 인터넷 필요, 파일 내용은 밖으로 나가지 않음)
- 써 보기: `시험용_파일/`의 회신 파일들을 양식취합 탭에 한꺼번에 넣기
- 자체 점검: `npm i exceljs@4.4.0` 후 `node selfcheck.js` (지저분한 회신 파일 세트로 취합 전체 검사)
