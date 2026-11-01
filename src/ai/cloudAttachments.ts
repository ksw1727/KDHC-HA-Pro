import JSZip from 'jszip';
import { dumpExcel, listSheets, type SheetMeta } from '../../tools/excelDump';
import { LockedFileError, openWorkbook, WrongPasswordError, type OpenedWorkbook } from '../../tools/excelOpen';

export { LockedFileError, WrongPasswordError };

export interface CloudSource { name: string; text: string }
/** 첨부 준비 중 난 오류 (서버 연결 문제가 아니므로 화면에 그대로 보여 준다) */
/** 요약 한도 때문에 일부 행을 담지 못한 요약인지 (화면에 알린다) */
export const isCutSource = (s: CloudSource) => s.text.includes('요약 한도 때문에');
export class AttachmentError extends Error { override name = 'AttachmentError'; }
export const MAX_CLOUD_SOURCE_CHARS = 12000;
/** 원본은 브라우저 안에서만 읽고 요약만 보내므로, 로컬 연결(원본 전송)보다 크게 받는다 */
export const MAX_CLOUD_FILE = 50 * 1024 * 1024;
const MB = 1024 * 1024;
/** 그림·첨부 개체는 요약에 내용이 들어가지 않아(개수만) 압축 해제 한도에서 뺀다 */
const isMedia = (path: string) => /^xl\/(media|embeddings)\//.test(path);
const bytesOf = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).byteLength;

/** Inspect central-directory sizes before ExcelJS can decompress workbook members. */
export const ARCHIVE_LIMITS = { member: 120 * MB, total: 250 * MB };
export async function inspectExcelArchive(bytes: Uint8Array, limits = ARCHIVE_LIMITS): Promise<void> {
  const zip = await JSZip.loadAsync(bytes, { checkCRC32: false });
  const entries = Object.values(zip.files);
  if (entries.length > 2048) throw new Error('엑셀 내부 파일이 너무 많아요. 소규모 양식으로 나눠 주세요.');
  let total = 0;
  for (const entry of entries) {
    if (entry.dir || isMedia(entry.name)) continue;
    const size = (entry as unknown as { _data?: { uncompressedSize?: unknown } })._data?.uncompressedSize;
    if (typeof size !== 'number' || !Number.isSafeInteger(size) || size < 0) throw new Error('엑셀 압축 해제 크기를 확인할 수 없어요. .xlsx로 다시 저장해 주세요.');
    total += size;
    if (size > limits.member || total > limits.total) throw new Error('엑셀 압축 해제 크기가 너무 커요. 소규모 양식으로 나눠 주세요.');
  }
}

const isZipBytes = (b: Uint8Array) => b[0] === 0x50 && b[1] === 0x4b;
/** 첨부마다 한 번만 연다 (.xls 변환·암호 풀기 결과). 이 탭 메모리에만 있다 */
const opened = new WeakMap<File, OpenedWorkbook>();
/** 이 첨부를 .xlsx 바이트로 연다. 암호가 필요하면 LockedFileError, 틀리면 WrongPasswordError */
export async function openAttachment(file: File, password?: string): Promise<OpenedWorkbook> {
  const hit = opened.get(file);
  if (hit) return hit;
  const raw = new Uint8Array(await file.arrayBuffer());
  if (isZipBytes(raw)) await inspectExcelArchive(raw);
  const o = await openWorkbook(raw, file.name, password);
  if (o.bytes !== raw) await inspectExcelArchive(o.bytes);
  opened.set(file, o);
  return o;
}
/** 로컬 연결 서버로 보낼 바이트: 암호를 푼 파일은 푼 내용, 나머지는 원본 */
export async function bytesForLocal(file: File): Promise<Uint8Array> {
  const o = opened.get(file);
  return o && o.notes.some((n) => n.includes('암호')) ? o.bytes : new Uint8Array(await file.arrayBuffer());
}

/** 첨부한 엑셀의 시트 목록 (브라우저 안에서만 읽고 보내지 않는다). 암호 오류는 그대로 던져 화면이 암호를 묻게 한다 */
export async function readSheetList(file: File, password?: string): Promise<SheetMeta[]> {
  try {
    return await listSheets((await openAttachment(file, password)).bytes);
  } catch (e) {
    if (e instanceof LockedFileError || e instanceof WrongPasswordError) throw e;
    throw new AttachmentError(`${file.name}: 시트 목록을 읽지 못했어요. ${(e as Error).message}`);
  }
}

/** sheets[i]: files[i]에서 요약할 시트 이름들 (없으면 모든 시트). 큰 파일은 반복 자료 행을 줄여 한도 안에 맞춘다 */
export async function prepareCloudSources(files: File[], consent: boolean, sheets: (string[] | undefined)[] = []): Promise<CloudSource[]> {
  if (files.length > 5) throw new AttachmentError('엑셀은 최대 5개까지 올릴 수 있어요.');
  if (files.length && !consent) throw new AttachmentError('민감한 셀을 포함한 요약 내용이 외부 AI로 전달되는 것에 동의해 주세요.');
  return Promise.all(files.map(async (file, i) => {
    if (file.name.length > 120) throw new AttachmentError('파일 이름은 120자 이하로 줄여 주세요.');
    if (!/\.(xlsx|xlsm|xls)$/i.test(file.name) || file.size > MAX_CLOUD_FILE) throw new AttachmentError('엑셀(.xlsx·.xlsm·.xls) 파일당 50MB 이하만 사용할 수 있어요.');
    let text: string;
    try {
      const o = await openAttachment(file);
      text = (await dumpExcel(o.bytes, { maxChars: MAX_CLOUD_SOURCE_CHARS, sheets: sheets[i], notes: o.notes })).text;
    } catch (e) {
      if (e instanceof LockedFileError) throw new AttachmentError(`${file.name}: ${e.message}`);
      throw new AttachmentError(`${file.name}: 엑셀을 읽지 못했어요. ${(e as Error).message}`);
    }
    if (text.length > MAX_CLOUD_SOURCE_CHARS) throw new AttachmentError(`${file.name}: 요약을 한도 안으로 줄이지 못했어요. 보낼 시트를 줄여 주세요.`);
    return { name: file.name, text };
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
