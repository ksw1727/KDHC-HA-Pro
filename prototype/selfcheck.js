// 자체 점검: node selfcheck.js  (필요: npm i exceljs@4.4.0)
// 빈 양식을 만들고 → 응답자처럼 지저분하게 채우고 → 취합해서 결과를 확인한다.
const assert = require('assert');
const ExcelJS = require('exceljs');
// 핵심 로직은 index.html 안 <script id="core">에 있다 (파일 하나로 쓰기 위해)
const html = require('fs').readFileSync(require('path').join(__dirname, 'index.html'), 'utf8');
const mod = { exports: {} };
new Function('module', 'require', html.match(/<script id="core">([\s\S]*?)<\/script>/)[1])(mod, require);
const Core = mod.exports;

const C = (name, type, extra) => ({ ...Core.newColumn(name), type, ...extra });
const form = Core.newForm();
form.name = '2026 비품 신청';
form.notice = '11월 5일까지 회신';
form.rows = 5;
const asset = C('자산번호', 'text', { unique: true });
const item = C('품목', 'list', { options: ['노트북', '모니터', '의자'], required: true });
const qty = C('수량', 'number', { required: true, min: '1', max: '100' });
const price = C('단가', 'number');
const amount = C('금액', 'number');
const due = C('필요일', 'date');
const memo = C('비고', 'text');
amount.calc = { kind: 'product', a: qty.id, b: price.id };
form.columns = [asset, item, qty, price, amount, due, memo];
assert.deepStrictEqual(Core.checkForm(form), []);

async function fill(name, rowsFn, wbFn) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await Core.buildTemplate(form));
  const ws = wb.getWorksheet(form.name);
  rowsFn(ws);
  if (wbFn) wbFn(wb);
  return { name, buf: await wb.xlsx.writeBuffer() };
}
const put = (ws, r, vals) => vals.forEach((v, i) => { if (v !== undefined) ws.getCell(r, i + 1).value = v; });

(async () => {
  // 개정 표시
  const rv = (n) => Core.parseRevision(n);
  assert.strictEqual(rv('비품_개발팀_v3(최종).xlsx').num, 3);
  assert.strictEqual(rv('비품_개발팀_v3(최종).xlsx').flag, 2);
  assert.strictEqual(rv('비품_개발팀_v3(최종).xlsx').base, rv('비품_개발팀.xlsx').base);
  assert.strictEqual(rv('비품_인사팀_수정.xlsx').base, rv('비품_인사팀.xlsx').base);
  assert.strictEqual(rv('Server3.xlsx').base, 'server3'); // 이름 끝 r3를 개정으로 오인하지 않음
  assert.strictEqual(rv('비품 (2).xlsx').base, '비품(2)');  // 브라우저 중복 이름 (2)는 개정으로 보지 않음

  const files = [];
  // 영업팀: 단위 붙은 숫자, 〃, 합친 셀, 숨긴 줄, 취소선, 합계 줄, 인쇄영역 밖 메모, 셀 메모
  files.push(await fill('비품신청_영업팀.xlsx', (ws) => {
    put(ws, 4, ['A-1', '노트북', '2개', 1000, 2000, '2026.11.1', '급함']);
    put(ws, 5, ['A-2', undefined, 1, 300, 300, '〃']);
    ws.getCell(4, 2).value = '노트북'; ws.mergeCells(4, 2, 5, 2);
    put(ws, 6, ['A-3', '의자', 3, 100, 300, '11/10']); ws.getRow(6).hidden = true;
    put(ws, 7, ['A-4', '모니터', 1, 500, 500]); ws.getCell(7, 1).style = { ...ws.getCell(7, 1).style, font: { strike: true } }; // 불러온 파일은 셀끼리 서식 객체를 같이 쓰므로 새로 만든다
    put(ws, 8, [undefined, '합계', 7]);
    ws.getCell(4, 10).value = '※ 의자는 급함';
    ws.getCell(4, 7).note = '팀장 승인 완료';
  }, (wb) => { wb.modified = new Date('2026-10-05T00:00:00Z'); }));
  // 개발팀 v1, v2(값 바뀜 + 줄 추가)
  files.push(await fill('비품신청_개발팀.xlsx', (ws) => {
    put(ws, 4, ['D-1', '노트북', 2, 1000, 2000]);
    put(ws, 5, ['D-2', '의자', 1, 100, 100]);
  }));
  files.push(await fill('비품신청_개발팀_v2.xlsx', (ws) => {
    put(ws, 4, ['D-1', '노트북', 3, 1000, 3000]);
    put(ws, 5, ['D-2', '의자', 1, 100, 100]);
    put(ws, 6, ['D-3', '모니터', 1, 500, 500]);
  }));
  // 인사팀: 애매한 값, 목록 오타, 여러 값, 겹치는 자산번호, 계산 틀림, 인쇄영역(5줄) 넘겨 쓰기
  files.push(await fill('비품신청_인사팀.xlsx', (ws) => {
    put(ws, 4, ['H-1', '모니터', '약 10', 500, 5000]);
    put(ws, 5, ['H-2', '노트븍', 1, 1000, 1000]);
    put(ws, 6, ['H-3', '노트북, 모니터', 1, 1000, 1000]);
    put(ws, 7, ['A-1', '의자', 1, 100, 999]);
    put(ws, 8, ['H-5', '의자', 1, 100, 100]);
    put(ws, 9, ['H-6', '의자', 2, 100, 200]); // 인쇄영역(4~8행) 밖으로 이어짐
  }));
  files.push(await fill('비품신청_재무팀.xlsx', () => {})); // 빈 회신
  // 양식정보 없이 새 파일에 복사: 제목 줄이 밀리고 칸 순서·이름이 다름
  {
    const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet('Sheet1');
    put(ws, 5, ['품목', '자산번호', '수량(개)', '단가', '금액', '필요일', '비고', '사유']);
    put(ws, 6, ['의자', 'P-1', 2, 100, 200, '2026-11-20', '', '고장']);
    files.push({ name: '구매팀_복사본.xlsx', buf: await wb.xlsx.writeBuffer() });
  }
  // 다른 양식, csv
  {
    const other = { ...Core.newForm(), name: '다른 양식' };
    files.push({ name: '다른양식.xlsx', buf: await Core.buildTemplate(other) });
    files.push({ name: '메모.csv', buf: Buffer.from('a,b') });
  }

  const raws = [];
  for (const f of files) raws.push(await Core.readFile(f.buf, f.name, 0));
  const detected = Core.detectForms(raws);
  assert.strictEqual(detected[0].form.id, form.id);

  const opts = { year: 2026, date: '2026-10-12' };
  let res = Core.interpret(form, raws, {}, opts);
  const byName = (n) => res.files.find((f) => f.name === n);
  const rowsOf = (src) => res.rows.filter((r) => r.src === src);

  // 파일 상태
  assert.strictEqual(byName('다른양식.xlsx').state, '제외');
  assert.strictEqual(byName('메모.csv').state, '제외');
  assert.strictEqual(byName('비품신청_재무팀.xlsx').state, '제출 · 해당 없음');
  assert.strictEqual(byName('비품신청_개발팀.xlsx').state, '제외');
  assert.strictEqual(byName('비품신청_개발팀_v2.xlsx').state, '반영');

  // 영업팀
  const s = rowsOf('비품신청_영업팀.xlsx');
  assert.strictEqual(s.length, 4, '합계 줄만 빠지고 4줄');
  assert.strictEqual(s[0].values[qty.id], 2); assert.strictEqual(s[0].fixed[qty.id], '2개');
  assert.strictEqual(s[0].values[due.id], '2026-11-01');
  assert.strictEqual(s[1].values[item.id], '노트북', '합친 셀 채움');
  assert.strictEqual(s[1].values[due.id], '2026-11-01', '〃 → 윗줄');
  assert.ok(s[2].status.includes('숨긴 줄')); assert.strictEqual(s[2].values[due.id], '2026-11-10');
  assert.ok(s[3].status.includes('취소선'));
  assert.ok(!s[0].strike && !s[1].strike && !s[2].strike, '취소선은 그 줄만');
  assert.strictEqual(s[0].notes[memo.id], '팀장 승인 완료');
  assert.ok(byName('비품신청_영업팀.xlsx').notes.some((n) => n.includes('합계 줄')));
  assert.ok(res.memos.some((m) => m.text === '※ 의자는 급함' && m.cell === 'J4'));

  // 개발팀 v2: 바뀜·추가 표시
  const d = rowsOf('비품신청_개발팀_v2.xlsx');
  assert.strictEqual(d.length, 3);
  assert.ok(d[0].status.some((x) => x.startsWith('이전 대비 바뀜')));
  assert.strictEqual(d[0].changed[qty.id], '2');
  assert.ok(d[2].status.includes('이전 대비 추가'));

  // 인사팀
  const h = rowsOf('비품신청_인사팀.xlsx');
  assert.strictEqual(h.length, 6, '넘겨 쓴 줄까지 6줄');
  assert.strictEqual(h[0].errors[qty.id], '숫자가 아님');
  assert.strictEqual(h[1].errors[item.id], '목록에 없는 값');
  assert.strictEqual(h[2].errors[item.id], '한 칸에 여러 값');
  assert.ok(h[3].errors[asset.id].startsWith('겹침 금지'));
  assert.ok(s[0].errors[asset.id].startsWith('겹침 금지'));
  assert.ok(h[3].errors[amount.id].includes('다름'));
  const keys = res.questions.map((q) => q.key);
  const qNum = keys.find((k) => k.startsWith('num|비품신청_인사팀'));
  const qList = keys.find((k) => k.startsWith('list|비품신청_인사팀'));
  const qSplit = keys.find((k) => k.startsWith('split|'));
  const qCol = keys.find((k) => k.startsWith('col|구매팀_복사본'));
  assert.ok(qNum && qList && qSplit && qCol, '확인 필요 질문이 생김: ' + keys.join(' ; '));
  assert.ok(keys.includes('rev|' + Core.parseRevision('비품신청_개발팀.xlsx').base));

  // 복사본: 칸 순서가 달라도 이름으로 맞춤, 사유는 추가 칸
  const p = rowsOf('구매팀_복사본.xlsx');
  assert.strictEqual(p.length, 1);
  assert.strictEqual(p[0].values[asset.id], 'P-1');
  assert.strictEqual(p[0].values[qty.id], 2, '수량(개) → 수량 (기본: 맞춤)');
  assert.ok(res.extras.some((x) => x.name === '사유' && x.value === '고장'));
  assert.ok(res.check.ok, '검산 통과: ' + JSON.stringify(res.check));

  // 사람이 답하면 반영
  res = Core.interpret(form, raws, { [qNum]: 'use', [qList]: 'use', [qSplit]: 'split' }, opts);
  const h2 = res.rows.filter((r) => r.src === '비품신청_인사팀.xlsx');
  assert.strictEqual(h2[0].values[qty.id], 10);
  assert.strictEqual(h2[1].values[item.id], '노트북');
  assert.strictEqual(h2.length, 7, '여러 값 나누기로 한 줄 늘어남');
  assert.ok(!h2[2].errors[asset.id] && !h2[3].errors[asset.id], '나눈 줄끼리는 겹침 아님');
  assert.ok(res.check.ok);
  // 개정본 직접 고르기
  const revKey = keys.find((k) => k.startsWith('rev|'));
  const res3 = Core.interpret(form, raws, { [revKey]: '비품신청_개발팀.xlsx' }, opts);
  assert.strictEqual(res3.rows.filter((r) => r.src === '비품신청_개발팀.xlsx').length, 2);

  // 취합본 만들기 → 다시 읽기 → 늦은 회신(v3)과 이어서 합치기
  const outBuf = await Core.buildResult(form, res);
  const outWb = new ExcelJS.Workbook(); await outWb.xlsx.load(outBuf);
  const main = outWb.getWorksheet(form.name);
  assert.strictEqual(main.getCell(3, 1).value, '자산번호');
  assert.strictEqual(main.getCell(3, form.columns.length + 1).value, '출처 파일');
  assert.ok(main.pageSetup.printArea.startsWith('A1:'));
  assert.ok(outWb.getWorksheet('메모') && outWb.getWorksheet('판단 기록') && outWb.getWorksheet('추가 칸'));
  const prev = await Core.readFile(outBuf, '2026 비품 신청_취합_20261012.xlsx', 0);
  const late = await fill('비품신청_개발팀_v3.xlsx', (ws) => {
    put(ws, 4, ['D-1', '노트북', 4, 1000, 4000]);
  });
  const lateRaw = await Core.readFile(late.buf, late.name, 0);
  const res4 = Core.interpret(form, [prev, lateRaw], {}, opts);
  assert.strictEqual(res4.rows.filter((r) => r.src === '비품신청_영업팀.xlsx').length, 4, '이전 취합본의 줄 유지');
  assert.ok(res4.rows.filter((r) => r.src === '비품신청_영업팀.xlsx')[2].status.includes('숨긴 줄'), '숨긴 줄 표시 유지');
  const dev = res4.rows.filter((r) => r.src.startsWith('비품신청_개발팀'));
  assert.deepStrictEqual([...new Set(dev.map((r) => r.src))], ['비품신청_개발팀_v3.xlsx'], 'v3만 반영');
  assert.strictEqual(dev[0].changed[qty.id], '3');
  assert.ok(res4.check.ok, '이어 붙이기 검산: ' + JSON.stringify(res4.check));

  // 양식 빈 파일: 인쇄영역·잠금·숨김 시트
  const tWb = new ExcelJS.Workbook(); await tWb.xlsx.load(await Core.buildTemplate(form));
  const t = tWb.getWorksheet(form.name);
  assert.strictEqual(t.pageSetup.printArea, 'A1:G8');
  assert.strictEqual(tWb.getWorksheet('_meta').state, 'veryHidden');
  assert.strictEqual(t.getCell(5, 2).dataValidation.type, 'list');

  if (process.argv[2]) {
    const fs = require('fs'), path = require('path');
    fs.mkdirSync(process.argv[2], { recursive: true });
    fs.writeFileSync(path.join(process.argv[2], '빈양식.xlsx'), Buffer.from(await Core.buildTemplate(form)));
    fs.writeFileSync(path.join(process.argv[2], '취합본.xlsx'), Buffer.from(outBuf));
    files.forEach((f) => fs.writeFileSync(path.join(process.argv[2], f.name), Buffer.from(f.buf)));
  }
  console.log('OK: 모든 점검 통과', JSON.stringify(res.check));
})().catch((e) => { console.error('FAIL:', e.message); process.exit(1); });
