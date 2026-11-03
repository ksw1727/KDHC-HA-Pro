// @vitest-environment node
import ExcelJS from 'exceljs';
import { SAMPLE } from './fixtures';
import { applySheet, sheetSize, snapshotSheet, withoutSheet } from '../collectSheet';
import { validateSchema, type FormSchema } from '../schema';
import { layoutSheet } from '../layout';
import { writeWorkbook } from '@gen/export/writeWorkbook';

/** 여러 단 머리글·합친 칸·서식·수식이 있는 계획/실적 표 */
function sheet(): ExcelJS.Worksheet {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('모니터링');
  ws.mergeCells('A1:F1');
  ws.getCell('A1').value = '안전보건경영시스템 모니터링';
  ws.getCell('A1').font = { bold: true, size: 14 };
  ws.mergeCells('A3:A4'); ws.getCell('A3').value = '활동목표';
  ws.mergeCells('C3:E3'); ws.getCell('C3').value = '2025년';
  ['1월', '2월', '3월'].forEach((m, i) => { ws.getCell(4, 3 + i).value = m; });
  ws.getCell('F3').value = '합계';
  ws.getCell('F5').value = { formula: 'COUNTA(C5:E5)', result: 0 } as ExcelJS.CellFormulaValue;
  for (let r = 5; r <= 60; r++) for (let c = 1; c <= 6; c++) ws.getCell(r, c).border = { top: { style: 'thin' }, bottom: { style: 'thin' } };
  ws.getCell('B60').value = '60행';
  ws.getColumn(2).width = 33;
  ws.getRow(5).height = 24;
  ws.getCell('C5').dataValidation = { type: 'list', allowBlank: true, formulae: ['"●,○"'] };
  return ws;
}

describe('시트 모으기형: 쓰던 엑셀 시트 그대로', () => {
  test('사본 → 다시 시트: 값·수식·합친 칸·열 너비·줄 높이·입력 규칙이 그대로', () => {
    const snap = snapshotSheet(sheet(), '원본.xlsx');
    expect(sheetSize(snap)).toEqual({ rows: 60, cols: 6, merges: 3 });
    const ws = new ExcelJS.Workbook().addWorksheet(snap.name);
    applySheet(ws, snap);
    expect(ws.getCell('A1').value).toBe('안전보건경영시스템 모니터링');
    expect(ws.getCell('A1').font?.bold).toBe(true);
    expect(ws.getCell('A4').isMerged).toBe(true);
    expect(ws.getCell('D3').isMerged).toBe(true);
    expect((ws.getCell('F5').value as ExcelJS.CellFormulaValue).formula).toBe('COUNTA(C5:E5)');
    expect(ws.getCell('B60').value).toBe('60행');
    expect(ws.getCell('B30').border?.top?.style).toBe('thin');
    expect(ws.getColumn(2).width).toBe(33);
    expect(ws.getRow(5).height).toBe(24);
    expect(ws.getCell('C5').dataValidation?.type).toBe('list');
  });

  test('양식 계약: 사본이 있으면 통과, 모양이 틀리면 오류. AI에게 보낼 때는 뗀다', () => {
    const snap = snapshotSheet(sheet());
    const s: FormSchema = { ...structuredClone(SAMPLE.collect), collect: { scope: 'report', sheet: snap } };
    expect(validateSchema(s).ok).toBe(true);
    expect(validateSchema({ ...s, collect: { scope: 'report', sheet: { name: 'x', cells: [['1A', null]] } } }).ok).toBe(false);
    expect(withoutSheet(s).collect).toEqual({ scope: 'report' });
    expect(JSON.stringify(withoutSheet(s))).not.toContain('모니터링');
  });

  test('빈 양식: 제목·지사명 줄 없이 그 시트 하나 그대로 (+ 숨긴 메타), 미리보기도 같은 모양', async () => {
    const snap = snapshotSheet(sheet());
    const s: FormSchema = { ...structuredClone(SAMPLE.collect), collect: { scope: 'report', sheet: snap } };
    const model = layoutSheet(s, { mode: 'template', orgName: '서울' }, { today: new Date() });
    expect(model.sheetName).toBe('모니터링');
    expect(model.merges).toEqual(snap.merges);
    expect(model.cells.find((c) => c.address === 'A1')?.value).toBe('안전보건경영시스템 모니터링');
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await writeWorkbook(s, { orgName: '서울', now: new Date() }) as unknown as ArrayBuffer);
    expect(wb.worksheets.map((w) => `${w.name}:${w.state}`)).toEqual(['모니터링:visible', '_meta:veryHidden']);
    const ws = wb.getWorksheet('모니터링')!;
    expect(ws.getCell('A1').value).toBe('안전보건경영시스템 모니터링');
    expect(ws.getCell('A3').isMerged).toBe(true);
    expect(ws.getCell('B60').value).toBe('60행');
  });
});

describe('시트 사본 저장 크기', () => {
  test('지난 카드용 빈 사본은 이름만 남고, 너무 큰 시트는 고를 때 막는다', async () => {
    const { sheetStub, sheetBytes, MAX_SHEET_BYTES } = await import('../collectSheet');
    const snap = snapshotSheet(sheet(), '원본.xlsx');
    expect(sheetStub(snap)).toEqual({ name: '모니터링', source: '원본.xlsx', cells: [], styles: [], merges: [], cols: [], rows: [] });
    expect(sheetBytes(snap)).toBeLessThan(MAX_SHEET_BYTES);
    const { sheetCopyFromBytes } = await import('@gen/state/sheetCopy');
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('큰 시트');
    for (let r = 1; r <= 3000; r++) for (let c = 1; c <= 10; c++) ws.getCell(r, c).value = `값 ${r}-${c} 긴 글자 채우기`;
    await expect(sheetCopyFromBytes(new Uint8Array(await wb.xlsx.writeBuffer() as ArrayBuffer), 'big.xlsx')).rejects.toThrow('너무 커요');
  });
});
