// @vitest-environment node
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { writeWorkbook } from '../export/writeWorkbook';
import { exportForm, exportNames } from '../export/exportZip';
import { readMeta } from '@contract/metaIO';
import { readCustomProps } from '@contract/xlsxPatch';
import { SAMPLE, f } from '@contract/__tests__/fixtures';
import type { FormSchema } from '@contract/schema';

const now = new Date('2026-10-13T05:00:00Z');
const open = async (bytes: Uint8Array) => {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(bytes as unknown as ArrayBuffer);
  return wb;
};
const clone = <T,>(x: T): T => structuredClone(x);
const protection = (ws: ExcelJS.Worksheet) => (ws as unknown as { sheetProtection?: object }).sheetProtection;

describe('엑셀 파일 (writeWorkbook)', () => {
  test('혼합형: 잠금·입력칸·서식·입력 규칙·인쇄영역·틀 고정·메모', async () => {
    const s = clone(SAMPLE['header-list']);
    const bytes = await writeWorkbook(s, { orgName: '부산', now });
    const wb = await open(bytes);
    const ws = wb.worksheets[0];
    expect(ws.name).toBe('2026 하반기 교육 참가자 조사');
    expect(ws.getCell('B4').value).toBe('부산');
    expect(ws.getCell('B4').protection?.locked).not.toBe(false); // 잠금은 엑셀 기본값이라 파일에 따로 적히지 않음
    expect(ws.getCell('B10').protection?.locked).toBe(false);       // 목록 이름 입력칸
    expect(ws.getCell('B9').value).toBe('이름 *');                    // 머리글
    expect(ws.getCell('C10').numFmt).toBe('#,##0"원"');
    expect(ws.getCell('C10').dataValidation).toMatchObject({ type: 'whole', operator: 'between' });
    expect(ws.pageSetup.printArea).toBe('A1:C109');
    expect(ws.views[0]).toMatchObject({ state: 'frozen', ySplit: 9 });
    expect(protection(ws)).toBeTruthy();
  });

  test('메타: veryHidden 마지막 시트, 다시 읽으면 체크섬 일치', async () => {
    const wb = await open(await writeWorkbook(SAMPLE.list, { orgName: '서울', now }));
    const meta = wb.worksheets.at(-1)!;
    expect(meta.name).toBe('_meta');
    expect(meta.state).toBe('veryHidden');
    const r = await readMeta(wb);
    expect(r.status).toBe('ok');
    if (r.status !== 'ok') throw new Error();
    expect(r.meta).toMatchObject({ kind: 'submission', orgName: '서울', sheetName: '2026 하반기 교육 참가자 조사' });
    expect(r.meta.cellMap?.blocks.b1).toMatchObject({ kind: 'list', headerRow: 6 });
    expect(r.meta.schema.formId).toBe(SAMPLE.list.formId);
  });

  test('메타를 고치면 변조로 판정', async () => {
    const wb = await open(await writeWorkbook(SAMPLE.list, { orgName: '서울', now }));
    const ws = wb.getWorksheet('_meta')!;
    ws.getCell('B1').value = String(ws.getCell('B1').value).replace('서울', '부산');
    expect((await readMeta(wb)).status).toBe('tampered');
  });

  test('파일 속성, 통합문서 구조 보호 없음 (작성자가 계산용 시트를 추가할 수 있게)', async () => {
    const bytes = await writeWorkbook(SAMPLE.list, { orgName: '서울', now });
    expect(await readCustomProps(bytes)).toEqual({ 'kdhc.formId': SAMPLE.list.formId, 'kdhc.formVersion': '1', 'kdhc.kind': 'submission', 'kdhc.org': '서울' });
    const zip = await JSZip.loadAsync(bytes);
    expect(await zip.file('xl/workbook.xml')!.async('string')).not.toMatch(/workbookProtection/);
  });

  test('시트 모으기형: 보호·구조 보호 없음, 메타는 있음, cellMap 없음', async () => {
    const s = clone(SAMPLE.collect);
    s.collect = { scope: 'report', starter: [['항목', '결과'], ['소화기', null]] };
    const bytes = await writeWorkbook(s, { orgName: '부산', now });
    const wb = await open(bytes);
    expect(wb.worksheets[0].name).toBe('보고서');
    expect(protection(wb.worksheets[0])).toBeFalsy();
    const zip = await JSZip.loadAsync(bytes);
    expect(await zip.file('xl/workbook.xml')!.async('string')).not.toMatch(/workbookProtection/);
    const r = await readMeta(wb);
    expect(r.status === 'ok' && r.meta.cellMap).toBeUndefined();
  });

  test('자유 제작형: 판 글자·입력 칸·숫자 표·줄 영역, 입력 칸만 풀림, 메타에 셀 지도', async () => {
    const bytes = await writeWorkbook(SAMPLE.free, { orgName: '서울', now });
    const wb = await open(bytes);
    const ws = wb.worksheets[0];
    expect(ws.getCell('A6').value).toBe('점검자');
    expect(ws.getCell('B6').protection?.locked).toBe(false);
    expect(ws.getCell('A6').protection?.locked).not.toBe(false);
    expect(ws.getCell('B8').value).toBe('소화기');
    expect(ws.getCell('B9').protection?.locked).toBe(false);
    expect(ws.getCell('A11').value).toBe('항목 *');
    expect(ws.getCell('C12').protection?.locked).toBe(false);
    const r = await readMeta(wb);
    expect(r.status === 'ok' && r.meta.cellMap?.blocks.b3).toMatchObject({ kind: 'list', headerRow: 11, firstDataRow: 12 });
  });

  test('표형 합계·계산 열 수식', async () => {
    const s = clone(SAMPLE.matrix);
    const m = s.blocks[0];
    if (m.kind !== 'matrix') throw new Error();
    m.calcCols = [f('r', '여 비율', { type: 'calc', formula: '[여] ÷ [계] × 100', decimals: 1, unit: '%' })];
    const ws = (await open(await writeWorkbook(s, { now }))).worksheets[0];
    expect(ws.getCell('D7').formula).toBe('SUM(B7:C7)');
    expect(ws.getCell('E7').formula).toBe('IFERROR(C7/D7*100,"")');
    expect(ws.getCell('E7').numFmt).toBe('#,##0.0"%"');
    expect(ws.getCell('E7').protection?.locked).not.toBe(false);
    expect(ws.getCell('E7').note).toBeTruthy();
  });

  test('선택지가 길거나 쉼표가 있으면 숨김 목록 시트를 참조', async () => {
    const s = clone(SAMPLE.list);
    const l = s.blocks[0];
    if (l.kind !== 'list') throw new Error();
    l.columns[1].options = ['가, 나', '다'];
    const wb = await open(await writeWorkbook(s, { orgName: '서울', now }));
    const lists = wb.getWorksheet('_lists')!;
    expect(lists.state).toBe('veryHidden');
    expect(lists.getCell('A1').value).toBe('가, 나');
    expect(wb.worksheets[0].getCell('C7').dataValidation?.formulae?.[0]).toBe("'_lists'!$A$1:$A$2");
  });
});

describe('내보내기 묶음 (exportForm)', () => {
  test('preset: 지사마다 파일, zip 이름 규칙', async () => {
    const s: FormSchema = { ...clone(SAMPLE.list), title: '조사/1', formVersion: 2 };
    const progress: number[] = [];
    const r = await exportForm(s, now, (d) => progress.push(d));
    expect(r.download.name).toBe('조사_1_v2_배포용.zip');
    expect(r.files.map((x) => x.name)).toEqual(['조사_1_v2_서울.xlsx', '조사_1_v2_부산.xlsx', '조사_1_v2_대구.xlsx']);
    expect(progress).toEqual([1, 2, 3]);
    const zip = await JSZip.loadAsync(await r.download.blob.arrayBuffer());
    expect(Object.keys(zip.files)).toHaveLength(3);
    const wb = await open(r.files[1].bytes);
    expect(wb.worksheets[0].getCell('B4').value).toBe('부산');
  });
  test('preset 공용 파일: 하나만, 지사명은 목록에서 고르는 필수 칸, 메타·속성에 지사 없음', async () => {
    const s: FormSchema = { ...clone(SAMPLE.list), title: '조사', formVersion: 2 };
    const r = await exportForm(s, now, undefined, true);
    expect(r.download.name).toBe('조사_v2.xlsx');
    expect(r.files).toHaveLength(1);
    const wb = await open(r.files[0].bytes);
    const b4 = wb.worksheets[0].getCell('B4');
    expect(b4.value).toBeNull();
    expect(b4.protection?.locked).toBe(false);
    expect(b4.dataValidation).toMatchObject({ type: 'list', formulae: ['"서울,부산,대구"'] });
    const m = await readMeta(wb);
    if (m.status !== 'ok') throw new Error();
    expect(m.meta.orgName).toBeUndefined();
    expect(m.meta.schema.org.mode).toBe('preset');
    expect((await readCustomProps(r.files[0].bytes))['kdhc.org']).toBeUndefined();
  });
  test('시트 모으기형은 공용 파일을 골라도 지사별 zip', async () => {
    const r = await exportForm({ ...clone(SAMPLE.collect), org: { mode: 'preset', orgs: ['서울', '부산'] } }, now, undefined, true);
    expect(r.download.name.endsWith('.zip')).toBe(true);
    expect(r.files).toHaveLength(2);
  });
  test('식별 안 함: 파일 하나', async () => {
    const r = await exportForm(SAMPLE['fill-in'], now);
    expect(r.download.name).toBe(`${exportNames(SAMPLE['fill-in']).fileOf()}`);
    expect(r.files).toHaveLength(1);
  });
});
