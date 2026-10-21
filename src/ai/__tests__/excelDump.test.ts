// @vitest-environment node
import ExcelJS from 'exceljs';
import { dumpExcel } from '../../../tools/excelDump';

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
    expect(text).toContain('A4="" [채움#FFF2CC,빈 칸]');
    expect(text).toContain('C4: list "사원,대리,과장"');
    expect(text).toContain('D6==SUM(D4:D5)');
    expect(text).toContain('(메모: 원 단위)');
    expect(text).toContain('한난MOA 계산식에 없는 함수: VLOOKUP');
  });
});
