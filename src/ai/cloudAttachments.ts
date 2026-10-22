import JSZip from 'jszip';
import { dumpExcel } from '../../tools/excelDump';

export interface CloudSource { name: string; text: string }
export const MAX_CLOUD_SOURCE_CHARS = 12000;
const MAX_FILE = 10 * 1024 * 1024;
const bytesOf = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).byteLength;

/** Inspect central-directory sizes before ExcelJS can decompress workbook members. */
export async function inspectExcelArchive(bytes: Uint8Array): Promise<void> {
  const zip = await JSZip.loadAsync(bytes, { checkCRC32: false });
  const entries = Object.values(zip.files);
  if (entries.length > 2048) throw new Error('엑셀 내부 파일이 너무 많아요. 소규모 양식으로 나눠 주세요.');
  let total = 0;
  for (const entry of entries) {
    if (entry.dir) continue;
    const size = (entry as unknown as { _data?: { uncompressedSize?: unknown } })._data?.uncompressedSize;
    if (typeof size !== 'number' || !Number.isSafeInteger(size) || size < 0) throw new Error('엑셀 압축 해제 크기를 확인할 수 없어요. .xlsx로 다시 저장해 주세요.');
    total += size;
    if (size > 8 * 1024 * 1024 || total > 32 * 1024 * 1024) throw new Error('엑셀 압축 해제 크기가 너무 커요. 소규모 양식으로 나눠 주세요.');
  }
}

export async function prepareCloudSources(files: File[], consent: boolean): Promise<CloudSource[]> {
  if (files.length > 5) throw new Error('엑셀은 최대 5개까지 올릴 수 있어요.');
  if (files.length && !consent) throw new Error('민감한 셀을 포함한 요약 내용이 외부 AI로 전달되는 것에 동의해 주세요.');
  return Promise.all(files.map(async (file) => {
    if (file.name.length > 120) throw new Error('파일 이름은 120자 이하로 줄여 주세요.');
    if (/\.xls$/i.test(file.name)) throw new Error(`${file.name}: .xls는 분석할 수 없어요. .xlsx로 다시 저장해 주세요.`);
    if (!/\.(xlsx|xlsm)$/i.test(file.name) || file.size > MAX_FILE) throw new Error('엑셀(.xlsx·.xlsm) 파일당 10MB 이하만 사용할 수 있어요.');
    const bytes = new Uint8Array(await file.arrayBuffer());
    await inspectExcelArchive(bytes);
    const summary = await dumpExcel(bytes, 12000);
    if (summary.text.length > MAX_CLOUD_SOURCE_CHARS || summary.text.includes('너무 길어 ')) throw new Error(`${file.name}: 요약이 너무 커 일부 확인이 필요해요. 전송하지 않았어요. 소규모 양식으로 나눠 주세요.`);
    return { name: file.name, text: summary.text };
  }));
}

export function buildCloudChatBody(payload: { chatId?: string; engine: 'claude' | 'codex'; message: string; form?: unknown; sources?: CloudSource[] }): string {
  if (payload.message.length > 6000) throw new Error('메시지는 6,000자 이하로 줄여 주세요.');
  if (payload.form !== undefined && bytesOf(payload.form) > 160_000) throw new Error('양식 정의가 160KB를 넘어요. 더 작은 양식으로 나눠 주세요.');
  if (payload.sources?.some((s) => s.text.length > MAX_CLOUD_SOURCE_CHARS)) throw new Error('요약이 너무 커 일부 확인이 필요해요. 소규모 양식으로 나눠 주세요.');
  // Allow-list the wire format. A caller can never accidentally forward File/base64 fields.
  const body = JSON.stringify({ chatId: payload.chatId, engine: payload.engine, message: payload.message, form: payload.form, sources: payload.sources?.map(({ name, text }) => ({ name, text })) });
  if (new TextEncoder().encode(body).byteLength > 240_000) throw new Error('전송할 내용이 240KB를 넘어요. 첨부·양식·메시지를 줄여 주세요.');
  return body;
}
