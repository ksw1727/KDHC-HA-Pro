// @vitest-environment node
import ExcelJS from 'exceljs';
import { dumpExcel, listSheets, packBlanks, sheetClues, sheetRole, slimWorkbook } from '../../../tools/excelDump';
import { defaultSheet } from '@gen/state/sheetCopy';

/** 사람들이 쓰던 엑셀 양식 흉내: 머리글, 노란 빈칸, 선택 규칙, VLOOKUP·다른 시트 참조, 메모, 조건부 서식 */
async function sample(): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('교육신청');
  ws.mergeCells('A1:D1');
  ws.getCell('A1').value = '동절기 안전교육 신청';
  ws.getCell('A1').font = { bold: true };
  ['부서', '이름', '직급', '교육비'].forEach((h, i) => { ws.getCell(3, i + 1).value = h; });
  for (let r = 4; r <= 5; r++) for (let c = 1; c <= 4; c++) {
    const cell = ws.getCell(r, c);
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF2CC' } };
    cell.border = { top: { style: 'thin' }, bottom: { style: 'thin' } };
  }
  ws.getCell('C4').dataValidation = { type: 'list', formulae: ['"사원,대리,과장"'] };
  ws.getCell('E4').value = { formula: 'VLOOKUP(B4,명단!A:B,2,FALSE)' };
  ws.getCell('D6').value = { formula: 'SUM(D4:D5)' };
  ws.getCell('D3').note = '원 단위';
  ws.addConditionalFormatting({ ref: 'D4:D5', rules: [{ type: 'cellIs', operator: 'greaterThan', formulae: [100000], priority: 1, style: { fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: 'FFFF0000' } } } }] });
  wb.addWorksheet('명단').getCell('A1').value = '김민수';
  return new Uint8Array(await wb.xlsx.writeBuffer());
}

describe('쓰던 엑셀 읽기 (moa read-excel)', () => {
  test('칸·규칙·수식과 옮기기 어려운 것을 글로', async () => {
    const { text, findings } = await dumpExcel(await sample());
    expect(findings).toMatchObject({ macros: false, sheets: 2, conditionalFormats: 1, crossSheetFormulas: ['교육신청!E4'], unknownFunctions: ['VLOOKUP'] });
    expect(text).toContain('## 시트 "교육신청"');
    expect(text).toContain('병합: A1:D1');
    expect(text).toContain('A1="동절기 안전교육 신청" [굵게]');
    expect(text).toContain('A4~D4="" [채움#FFF2CC,빈 칸, 4칸]');
    expect(text).toContain('C4: list "사원,대리,과장"');
    expect(text).toContain('D6==SUM(D4:D5)');
    expect(text).toContain('(메모: 원 단위)');
    expect(text).toContain('한난MOA 계산식에 없는 함수: VLOOKUP');
  });

  /** 연도별 시트에 수백 행씩 쌓인 현황 파일 (사용자 기계실 인입배관 지원사업 현황 같은) */
  async function bigStatus(years = [2020, 2021, 2022, 2023, 2024], rows = 400): Promise<Uint8Array> {
    const wb = new ExcelJS.Workbook();
    const thin = { top: { style: 'thin' }, bottom: { style: 'thin' }, left: { style: 'thin' }, right: { style: 'thin' } } as const;
    for (const y of years) {
      const ws = wb.addWorksheet(`${y}년`);
      ws.mergeCells('A1:L1'); ws.getCell('A1').value = `${y}년 사용자 기계실 인입배관 지원사업 현황`; ws.getCell('A1').font = { bold: true };
      const heads = ['연번', '지사', '단지명', '주소', '세대수', '관경', '연장(m)', '지원금액', '자부담', '합계', '착공일', '비고'];
      heads.forEach((h, i) => { const c = ws.getCell(3, i + 1); c.value = h; c.font = { bold: true }; c.border = thin; });
      for (let r = 4; r < 4 + rows; r++) {
        const vals = [r - 3, '강남지사', `○○아파트 ${r}단지`, `서울시 강남구 ○○로 ${r}`, 100 + r, '200A', 12.5 + r, 3000000 + r, 1000000, null, new Date(Date.UTC(y, 3, 1)), r % 7 ? '' : '보류'];
        vals.forEach((v, i) => { const c = ws.getCell(r, i + 1); c.value = i === 9 ? { formula: `H${r}+I${r}` } : v as ExcelJS.CellValue; c.border = thin; });
      }
      ws.getCell(4 + rows, 1).value = '합계'; ws.getCell(4 + rows, 8).value = { formula: `SUM(H4:H${3 + rows})` };
    }
    return new Uint8Array(await wb.xlsx.writeBuffer());
  }
  test('큰 현황 파일도 한도 안으로 줄이고 머리글·첫 행·합계는 남긴다', async () => {
    const bytes = await bigStatus();
    const full = await dumpExcel(bytes, 1e9);
    expect(full.text.length).toBeGreaterThan(100000);
    const { text } = await dumpExcel(bytes, { maxChars: 12000 });
    expect(text.length).toBeLessThanOrEqual(12000);
    for (const y of [2020, 2024]) expect(text).toContain(`## 시트 "${y}년"`);
    expect(text).toContain('A3="연번" [굵게]');
    expect(text).toMatch(/행 생략 \(위·아래 행과 같은 칸 구성/);
    expect(text).toContain('=SUM(H4:H403)');
    expect(text).not.toContain('요약 한도 때문에');
  });
  test('한 시트만 고르면 그 시트를 더 자세히 담는다', async () => {
    const bytes = await bigStatus();
    const all = (await dumpExcel(bytes, { maxChars: 12000 })).text;
    const one = (await dumpExcel(bytes, { maxChars: 12000, sheets: ['2024년'] })).text;
    expect(one).not.toContain('## 시트 "2023년"');
    expect(one).toContain('담지 않은 시트 4장');
    const rowsOf = (t: string) => (t.split('## 시트 "2024년"')[1].match(/^\d+행:/gm) ?? []).length;
    expect(rowsOf(one)).toBeGreaterThan(rowsOf(all));
  });
  test('줄일 수 없을 만큼 크면 뒤쪽을 자르되 자른 곳을 적는다', async () => {
    const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet('제각각');
    for (let r = 1; r <= 600; r++) ws.getCell(r, (r % 40) + 1).value = `항목 ${r} 설명 `.repeat(3);
    const { text } = await dumpExcel(new Uint8Array(await wb.xlsx.writeBuffer()), { maxChars: 12000 });
    expect(text.length).toBeLessThanOrEqual(12000);
    expect(text).toMatch(/요약 한도 때문에 \d+행 뒤로는 담지 못했어요/);
    expect(text).toContain('사용자에게 알려 주세요');
  });
  test('시트 목록: 이름·숨김·행 수', async () => {
    const wb = new ExcelJS.Workbook();
    wb.addWorksheet('A&B 현황').getCell('C120').value = 1;
    wb.addWorksheet('계산용', { state: 'hidden' }).getCell('A1').value = 1;
    expect(await listSheets(new Uint8Array(await wb.xlsx.writeBuffer()))).toEqual([
      { name: 'A&B 현황', state: 'visible', rows: 120 }, { name: '계산용', state: 'hidden', rows: 1 },
    ]);
  });

  test('아주 긴 시트는 앞 2,000행과 끝 행만 읽고, 그림 내용은 비운다', async () => {
    const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet('대장');
    ws.getRow(1).values = ['번호', '이름', '금액'];
    for (let r = 2; r <= 6001; r++) ws.getRow(r).values = [r - 1, `이름${r}`, r * 10];
    ws.getCell('A6002').value = '합계'; ws.getCell('C6002').value = { formula: 'SUM(C2:C6001)' };
    const img = wb.addImage({ buffer: Buffer.alloc(2000, 1) as unknown as ExcelJS.Buffer, extension: 'png' });
    ws.addImage(img, 'E2:F4');
    const bytes = new Uint8Array(await wb.xlsx.writeBuffer());
    const slim = await slimWorkbook(bytes);
    expect(slim.trimmed.get('대장')).toBe(6002);
    const { text, findings } = await dumpExcel(bytes, { maxChars: 12000 });
    expect(text.length).toBeLessThanOrEqual(12000);
    expect(text).toContain('행이 많아(약 6,002행) 앞 2,000행과 끝 20행만 읽었어요');
    expect(text).toContain('=SUM(C2:C6001)');
    expect(findings.images).toBe(1);
  });

  test('이어지는 빈 칸은 묶어 적는다: 계획·실적 표 94행 × 26열도 12,000자 안에 끝까지 담긴다', async () => {
    expect(packBlanks(['H5="●"', 'I5="" [빈 칸]', 'J5="" [빈 칸]', 'K5="" [빈 칸]', 'L5="x"', 'M5="" [빈 칸]', 'N5="" [빈 칸]'])).toEqual(['H5="●"', 'I5~K5="" [빈 칸, 3칸]', 'L5="x"', 'M5="" [빈 칸]', 'N5="" [빈 칸]']);
    expect(packBlanks(['A1="" [채움#FFFF00,빈 칸]', 'B1="" [빈 칸]', 'C1="" [빈 칸]', 'D1="" [빈 칸]'])).toEqual(['A1="" [채움#FFFF00,빈 칸]', 'B1~D1="" [빈 칸, 3칸]']);
    // 「3. 안전보건경영시스템 성과측정 및 모니터링 양식」 모양: 항목마다 계획·실적 두 줄, 1~12월과 결과 칸은 테두리만 있는 빈 칸
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('모니터링');
    ws.getCell('A1').value = '안전보건경영시스템 모니터링 및 성과측정';
    const thin = { style: 'thin' as const };
    for (let r = 5; r <= 94; r++) {
      ws.getCell(r, 2).value = r % 2 ? `세부추진항목 ${r}` : null;
      ws.getCell(r, 5).value = '산업안전부';
      ws.getCell(r, 7).value = r % 2 ? '계획' : '실적';
      for (let c = 1; c <= 26; c++) ws.getCell(r, c).border = { top: thin, left: thin, bottom: thin, right: thin };
    }
    const { text } = await dumpExcel(new Uint8Array(await wb.xlsx.writeBuffer()), { maxChars: 12000 });
    expect(text.length).toBeLessThanOrEqual(12000);
    expect(text).toContain('94행:');
    expect(text).not.toContain('담지 못했어요');
    expect(text).toContain('H5~Z5="" [빈 칸, 19칸]');
  });

  test('취합 의도 단서: 참고/작성 시트, 제출처 자리표시, 번호 줄, 예시 값', () => {
    expect([sheetRole('<참고> 평가 방법'), sheetRole('<작성> 위험성평가 실시표(사무업무)'), sheetRole('Sheet1')]).toEqual(['reference', 'input', null]);
    expect(defaultSheet([{ name: '<참고> 평가 방법' }, { name: '<참고> 기준' }, { name: '<작성> 실시표' }])?.name).toBe('<작성> 실시표');
    expect(defaultSheet([{ name: '<참고> 평가 방법' }, { name: 'Sheet2' }])?.name).toBe('Sheet2');
    const ws = new ExcelJS.Workbook().addWorksheet('수기관리 시 작성양식(OO부)');
    ws.getCell('A18').value = '순번';
    [1, 2, 3, 4].forEach((n, i) => { ws.getCell(20 + i, 1).value = n; });
    ws.getCell('C20').value = 'OO 공사';
    [1, 2, 3].forEach((n, i) => { ws.getCell(28 + i, 1).value = String(n); });
    const c = sheetClues(ws).join(' / ');
    expect(c).toContain('"OO부"는 제출처 자리표시');
    expect(c).toContain('A열 20~23행에 번호 1~4');
    expect(c).toContain('A열 28~30행에 번호 1~3');
    expect(c).toContain('C20 "OO 공사"');
  });
});

