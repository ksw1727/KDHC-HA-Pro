import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { buildCloudChatBody, inspectExcelArchive, prepareCloudSources } from '../cloudAttachments';

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
  it('rejects old xls, too many files, and oversized files', async () => {
    await expect(prepareCloudSources([file(new Uint8Array(), 'old.xls')], true)).rejects.toThrow('.xlsx로 다시 저장');
    await expect(prepareCloudSources(Array.from({ length: 6 }, () => file(new Uint8Array())), true)).rejects.toThrow('5개');
    await expect(prepareCloudSources([{ ...file(new Uint8Array()), size: 10 * 1024 * 1024 + 1 } as File], true)).rejects.toThrow('10MB');
  });
  it('rejects oversized summary rather than silently truncating', async () => {
    await expect(prepareCloudSources([file(await workbook('셀'.repeat(12001)))], true)).rejects.toThrow('너무 커 일부 확인');
  });
  it('checks each ZIP member before expanding highly compressible data', async () => {
    const zip = new JSZip(); zip.file('xl/worksheets/sheet1.xml', 'a'.repeat(8 * 1024 * 1024 + 1));
    const bytes = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
    expect(bytes.length).toBeLessThan(100000);
    await expect(inspectExcelArchive(bytes)).rejects.toThrow('압축 해제 크기');
  });
  it('checks total expanded archive size and member count', async () => {
    const zip = new JSZip(); for (let i = 0; i < 5; i++) zip.file(`x${i}`, 'a'.repeat(7 * 1024 * 1024));
    await expect(inspectExcelArchive(await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' }))).rejects.toThrow('압축 해제 크기');
    const many = new JSZip(); for (let i = 0; i < 2049; i++) many.file(`x${i}`, '');
    await expect(inspectExcelArchive(await many.generateAsync({ type: 'uint8array' }))).rejects.toThrow('너무 많아요');
  });
  it('applies character, form-byte, and total UTF-8 byte limits', () => {
    expect(() => buildCloudChatBody({ engine: 'claude', message: 'x'.repeat(6001) })).toThrow('6,000');
    expect(() => buildCloudChatBody({ engine: 'claude', message: 'a', form: { text: '한'.repeat(54000) } })).toThrow('160KB');
    expect(() => buildCloudChatBody({ engine: 'claude', message: '한'.repeat(6000), form: { text: 'a'.repeat(159000) }, sources: Array.from({ length: 5 }, () => ({ name: 'a', text: '한'.repeat(12000) })) })).toThrow('240KB');
  });
});
