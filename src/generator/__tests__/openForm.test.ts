// @vitest-environment node
import ExcelJS from 'exceljs';
import { writeWorkbook } from '../export/writeWorkbook';
import { duplicateForm, openFormJson, openFormXlsx, shortTime } from '../landing/openForm';
import { SAMPLE } from '@contract/__tests__/fixtures';

const now = new Date('2026-10-13T05:00:00Z');
const buf = (u: Uint8Array) => u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength) as ArrayBuffer;

describe('이미 만든 양식 열기', () => {
  test('양식 파일(.form.json)', () => {
    const r = openFormJson(JSON.stringify(SAMPLE.list));
    expect(r.ok && r.entry.schema.formId).toBe(SAMPLE.list.formId);
    expect(openFormJson('{"a":1}')).toEqual({ ok: false, message: '이 파일은 양식 파일이 아니에요.' });
    expect(openFormJson('엑셀 아님').ok).toBe(false);
  });

  test('엑셀에서 되살리기: 내보낸 양식이 그대로, 마지막 내보내기로 기록', async () => {
    const r = await openFormXlsx(buf(await writeWorkbook(SAMPLE['header-list'], { orgName: '부산', now })));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.entry.schema).toEqual(SAMPLE['header-list']);
    expect(r.entry.lastExported).toEqual(SAMPLE['header-list']);
  });

  test('한난MOA로 만들지 않은 엑셀', async () => {
    const wb = new ExcelJS.Workbook();
    wb.addWorksheet('Sheet1').getCell('A1').value = '안녕';
    const r = await openFormXlsx((await wb.xlsx.writeBuffer()) as ArrayBuffer);
    expect(r).toEqual({ ok: false, message: '한난MOA로 만든 파일이 아니에요.' });
  });
});

test('복제: (복사), 새 formId, 버전 1', () => {
  const d = duplicateForm({ ...SAMPLE.list, formVersion: 3 }, now, 'new-id');
  expect(d.schema).toMatchObject({ formId: 'new-id', formVersion: 1, title: `${SAMPLE.list.title} (복사)` });
  expect(d.lastExported).toBeUndefined();
});

test('최근 양식 시각', () => {
  const local = new Date(2026, 9, 13, 14, 20);
  expect(shortTime(local.toISOString(), new Date(2026, 9, 13, 18))).toBe('오늘 14:20');
  expect(shortTime(local.toISOString(), new Date(2026, 9, 20))).toBe('10/13');
});
