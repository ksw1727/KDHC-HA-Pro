import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { readFileSync } from 'node:fs';
import * as XLSX from 'xlsx';
import { AttachmentError, bytesForLocal, buildCloudChatBody, inspectExcelArchive, LockedFileError, MAX_CLOUD_FILE, MAX_CLOUD_SOURCE_CHARS, prepareCloudSources, readSheetList, WrongPasswordError } from '../cloudAttachments';

function file(bytes: Uint8Array, name = '양식.xlsx'): File {
  return { name, size: bytes.length, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) } as File;
}
async function workbook(text: string) {
  const wb = new ExcelJS.Workbook(); wb.addWorksheet('양식').getCell('A1').value = text;
  return new Uint8Array(await wb.xlsx.writeBuffer());
}
describe('cloud browser-only Excel summaries', () => {
  it('requires explicit external AI consent before reading original bytes', async () => {
    const f = file(new Uint8Array()); const read = vi.spyOn(f, 'arrayBuffer');
    await expect(prepareCloudSources([f], false)).rejects.toThrow('외부 AI'); expect(read).not.toHaveBeenCalled();
  });
  it('sends only summary sources, never files/base64, even if caller supplies extra fields', async () => {
    const sources = await prepareCloudSources([file(await workbook('민감한 셀'))], true);
    expect(sources[0].text).toContain('민감한 셀');
    const body = JSON.parse(buildCloudChatBody({ engine: 'codex', message: '만들기', sources, files: ['raw'], base64: 'raw' } as Parameters<typeof buildCloudChatBody>[0]));
    expect(Object.keys(body)).toEqual(['engine', 'message', 'sources']); expect(body.sources[0]).toEqual({ name: '양식.xlsx', text: sources[0].text });
  });
  it('rejects broken files, too many files, and oversized files', async () => {
    await expect(prepareCloudSources([file(new Uint8Array(), 'old.xls')], true)).rejects.toThrow('읽지 못했어요');
    await expect(prepareCloudSources(Array.from({ length: 6 }, () => file(new Uint8Array())), true)).rejects.toThrow('5개');
    await expect(prepareCloudSources([{ ...file(new Uint8Array()), size: MAX_CLOUD_FILE + 1 } as File], true)).rejects.toThrow('50MB');
  });
  it('shrinks an oversized summary within the limit and says what was shortened', async () => {
    const [src] = await prepareCloudSources([file(await workbook('셀'.repeat(12001)))], true);
    expect(src.text.length).toBeLessThanOrEqual(MAX_CLOUD_SOURCE_CHARS);
    expect(src.text).toMatch(/…\(\d+자\)/);
  });
  it('sends only the picked sheets and tells the AI which ones were left out', async () => {
    const wb = new ExcelJS.Workbook();
    for (const y of [2022, 2023, 2024]) wb.addWorksheet(`${y}년`).getCell('A1').value = `${y} 현황`;
    const f = file(new Uint8Array(await wb.xlsx.writeBuffer()));
    expect((await readSheetList(f)).map((s) => s.name)).toEqual(['2022년', '2023년', '2024년']);
    const [src] = await prepareCloudSources([f], true, [['2024년']]);
    expect(src.text).toContain('2024 현황'); expect(src.text).not.toContain('2022 현황');
    expect(src.text).toContain('담지 않은 시트 2장');
    await expect(prepareCloudSources([f], true, [['없는 시트']])).rejects.toThrow('없는 시트');
  });
  it('reads old .xls by converting it in the browser, and says what may be lost', async () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['연번', '지사', '금액'], [1, '강남지사', 3000]]), '2024년');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['옛 자료']]), '2023년');
    const xls = new Uint8Array(XLSX.write(wb, { type: 'array', bookType: 'biff8' }) as ArrayBuffer);
    expect(xls[0]).toBe(0xd0);
    const f = file(xls, '옛 양식.xls');
    expect((await readSheetList(f)).map((x) => x.name)).toEqual(['2024년', '2023년']);
    const [src] = await prepareCloudSources([f], true, [['2024년']]);
    expect(src.text).toContain('옛 엑셀(.xls)을 .xlsx로 바꿔 읽었어요');
    expect(src.text).toContain('B2="강남지사"');
    expect(src.text).not.toContain('옛 자료');
  });
  it('asks for the open password, rejects a wrong one, and opens with the right one (file encrypted by msoffcrypto-tool)', async () => {
    const enc = new Uint8Array(readFileSync('src/ai/__tests__/fixtures/encrypted-password-han1234.xlsx'));
    const f = file(enc, '암호.xlsx');
    await expect(readSheetList(f)).rejects.toBeInstanceOf(LockedFileError);
    await expect(prepareCloudSources([f], true)).rejects.toThrow('열기 암호');
    await expect(readSheetList(f, '틀린 암호')).rejects.toBeInstanceOf(WrongPasswordError);
    expect((await readSheetList(f, '한난1234!')).map((x) => x.name)).toEqual(['2024년', '2023년']);
    const [src] = await prepareCloudSources([f], true);
    expect(src.text).toContain('암호 파일 2024 현황');
    expect(src.text).not.toContain('한난1234');
    const local = await bytesForLocal(f);
    expect([local[0], local[1]]).toEqual([0x50, 0x4b]);
    // 암호 해제가 무거워 전체 실행에서는 ~29초 걸린다 (이 파일만 돌리면 ~10초)
  }, 60000);
  it('shows attachment errors without the connection prefix', async () => {
    await expect(prepareCloudSources([file(new Uint8Array([1, 2, 3]))], true)).rejects.toBeInstanceOf(AttachmentError);
  });
  it('checks each ZIP member before expanding highly compressible data', async () => {
    const small = { member: 8 * 1024 * 1024, total: 32 * 1024 * 1024 };
    const zip = new JSZip(); zip.file('xl/worksheets/sheet1.xml', 'a'.repeat(8 * 1024 * 1024 + 1));
    const bytes = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
    expect(bytes.length).toBeLessThan(100000);
    await expect(inspectExcelArchive(bytes, small)).rejects.toThrow('압축 해제 크기');
    // 그림은 요약에 내용이 안 들어가므로 한도에서 뺀다
    const pic = new JSZip(); pic.file('xl/media/image1.png', 'a'.repeat(9 * 1024 * 1024));
    await expect(inspectExcelArchive(await pic.generateAsync({ type: 'uint8array', compression: 'DEFLATE' }), small)).resolves.toBeUndefined();
  });
  it('checks total expanded archive size and member count', async () => {
    const zip = new JSZip(); for (let i = 0; i < 5; i++) zip.file(`x${i}`, 'a'.repeat(7 * 1024 * 1024));
    await expect(inspectExcelArchive(await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' }), { member: 8 * 1024 * 1024, total: 32 * 1024 * 1024 })).rejects.toThrow('압축 해제 크기');
    const many = new JSZip(); for (let i = 0; i < 2049; i++) many.file(`x${i}`, '');
    await expect(inspectExcelArchive(await many.generateAsync({ type: 'uint8array' }))).rejects.toThrow('너무 많아요');
  });
  it('applies character, form-byte, and total UTF-8 byte limits', () => {
    expect(() => buildCloudChatBody({ engine: 'claude', message: 'x'.repeat(6001) })).toThrow('6,000');
    expect(() => buildCloudChatBody({ engine: 'claude', message: 'a', form: { text: '한'.repeat(54000) } })).toThrow('160KB');
    expect(() => buildCloudChatBody({ engine: 'claude', message: '한'.repeat(6000), form: { text: 'a'.repeat(159000) }, sources: Array.from({ length: 5 }, () => ({ name: 'a', text: '한'.repeat(30000) })) })).toThrow('480KB');
  });
});
