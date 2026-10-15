// @vitest-environment node
import ExcelJS from 'exceljs';
import { buildMeta, readMeta, writeMeta, META_SHEET } from '../metaIO';
import { SAMPLE } from './fixtures';

/** 영문·한글이 섞인 글자를 LibreOffice처럼 글꼴별 조각(richText)으로 나눈다 */
const asRichText = (s: string): ExcelJS.CellRichTextValue => ({
  richText: (s.match(/[가-힣\s]+|[^가-힣\s]+/g) ?? []).map((text) => ({ text, font: { name: /[가-힣]/.test(text) ? '나눔고딕' : 'Calibri' } })),
});

describe('_meta 시트 읽기 (readMeta)', () => {
  test('다른 프로그램이 다시 저장해 글자가 richText로 바뀌어도 읽는다', async () => {
    const meta = await buildMeta({ contractVersion: 1, kind: 'submission', schema: structuredClone(SAMPLE.matrix), generatedAt: '2026-10-15T00:00:00.000Z' });
    const wb = new ExcelJS.Workbook();
    wb.addWorksheet('양식');
    writeMeta(wb, meta);
    const ws = wb.getWorksheet(META_SHEET)!;
    for (const a of ['A1', 'B1']) ws.getCell(a).value = asRichText(String(ws.getCell(a).value));
    expect((ws.getCell('B1').value as ExcelJS.CellRichTextValue).richText.length).toBeGreaterThan(1);

    const r = await readMeta(wb);
    expect(r.status).toBe('ok');
    expect(r.status === 'ok' && r.meta.schema.title).toBe(SAMPLE.matrix.title);
  });
});
