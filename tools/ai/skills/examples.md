# 잘 만든 예시와 끝내기 전 점검표

## 예시 1 — 혼합형 (한 번 적는 칸 + 목록 + 계산)
요구: "지사마다 담당자·연락처랑 교육 신청자 명단(이름, 직급 1~4급, 교육비, 인원, 합계) 받아줘. 중앙지사·강남지사. 11월 5일까지."
```json
{"title":"2026 하반기 직무교육 참가 신청","guide":"11월 5일까지 회신해 주세요.","deadline":"2026-11-05","layout":"header-list",
 "blocks":[
  {"kind":"fields","id":"b1","fields":[
    {"key":"f_dm01","label":"담당자","type":"text","required":true},
    {"key":"f_dm02","label":"연락처","type":"pattern","pattern":"mobile","required":true}]},
  {"kind":"list","id":"b2","maxRows":50,"columns":[
    {"key":"f_ls01","label":"이름","type":"text","required":true},
    {"key":"f_ls02","label":"직급","type":"select","options":["1급","2급","3급","4급"],"required":true},
    {"key":"f_ls03","label":"교육비","type":"number","unit":"원","thousands":true,"decimals":0,"min":0,"required":false,"help":"1인당 금액, 원 단위"},
    {"key":"f_ls04","label":"인원","type":"number","unit":"명","decimals":0,"min":0,"required":false},
    {"key":"f_ls05","label":"합계","type":"calc","formula":"[교육비] × [인원]","required":false}],
   "exampleRow":{"f_ls01":"홍길동","f_ls02":"3급","f_ls03":150000,"f_ls04":1}}],
 "org":{"mode":"preset","orgs":["중앙지사","강남지사"],"label":"지사"}}
```
(나머지 `contractVersion`·`formId`·`aggregations`·`createdAt` 등은 `moa new`가 만든 값을 그대로 둔다.)
- 요구의 항목 이름을 그대로 썼다. 합계는 입력받지 않고 계산한다. 연락처는 형식 칸이다.

## 예시 2 — 빈칸채우기형 (제출처마다 자기 열만)
요구: "안전교육·보호장비 예산을 중앙지사·강남지사에서 천원 단위로 받아. 표는 항목이 행, 지사가 열."
```json
{"title":"2027 안전예산 요구","layout":"fill-in",
 "blocks":[{"kind":"grid","id":"b1","colLabels":["항목","중앙지사","강남지사"],"spareRows":0,"rows":[
   [{"kind":"fixed","value":"안전교육"},
    {"kind":"input","field":{"key":"f_g101","label":"안전교육 · 중앙지사","type":"number","unit":"천원","thousands":true,"decimals":0,"min":0,"required":true}},
    {"kind":"input","field":{"key":"f_g102","label":"안전교육 · 강남지사","type":"number","unit":"천원","thousands":true,"decimals":0,"min":0,"required":true}}],
   [{"kind":"fixed","value":"보호장비"},
    {"kind":"input","field":{"key":"f_g201","label":"보호장비 · 중앙지사","type":"number","unit":"천원","thousands":true,"decimals":0,"min":0,"required":true}},
    {"kind":"input","field":{"key":"f_g202","label":"보호장비 · 강남지사","type":"number","unit":"천원","thousands":true,"decimals":0,"min":0,"required":true}}]]}],
 "org":{"mode":"preset","orgs":["중앙지사","강남지사"],"label":"지사"}}
```
- 열 머리글이 제출처 이름과 **똑같아서** 작성처가 자동으로 정해진다. 시작 양식의 "내용"·"입력" 열과 "항목 1" 행은 지웠다.

## 예시 3 — 만들 수 없음
요구: "지사마다 칸 위치가 다른 보고서를 한 양식으로 받아줘"
답 첫 줄: `이 양식은 한난MOA로 다시 만들 수 없어요.` → ✕ 이유 → 이렇게 바꾸면 만들 수 있어요(예: 시트 모으기형으로 보고서를 시트째 모으기). `form.json`은 만들지 않는다.

## 끝내기 전 점검표 (답하기 직전에 매번)
1. `moa check`가 "통과"인가?
2. `moa preview`에서 요구의 항목을 하나씩 짚었는가 — 이름·순서·종류(숫자/날짜/고르기)·필수가 맞고, 자리표시 항목("1행", "항목 1", 쓰지 않는 "이름")이 남지 않았는가?
3. 제목이 비어 있지 않은가? 사용자가 말한 기한·문의처를 넣었는가?
4. 제출처: 말한 곳을 `moa orgs`로 찾은 **정확한 이름**으로 넣었는가? 부르는 말(`label`)이 용도에 맞는가?
5. 내가 정한 기본값을 답에 모두 알렸는가?
