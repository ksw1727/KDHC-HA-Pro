import type { Workbook } from 'exceljs';
import type { FileMeta } from './meta';
import { computeChecksum } from './checksum';
import { CONTRACT_VERSION } from './version';

export const META_SHEET = '_meta';
const MARK = 'KDHC-META';
const CHUNK = 30_000;

/** 메타 만들기 (체크섬 계산 포함) */
export async function buildMeta(meta: Omit<FileMeta, 'checksum'>): Promise<FileMeta> {
  return { ...meta, checksum: await computeChecksum(meta) };
}

/** JSON 글자를 30,000자 단위로 B열에 나눠 넣는 숨김 시트 (01-contract.md 4.1, 4.5) */
export function writeChunkSheet(wb: Workbook, name: string, mark: string, json: string) {
  const old = wb.getWorksheet(name);
  if (old) wb.removeWorksheet(old.id);
  const ws = wb.addWorksheet(name, { state: 'veryHidden' });
  ws.getCell('A1').value = mark;
  ws.getCell('A2').value = CONTRACT_VERSION;
  for (let i = 0, row = 1; i < json.length || row === 1; i += CHUNK, row++) ws.getCell(`B${row}`).value = json.slice(i, i + CHUNK);
}

export function readChunkSheet(wb: Workbook, name: string, mark: string): string | null {
  const ws = wb.getWorksheet(name);
  if (!ws || ws.getCell('A1').value !== mark) return null;
  let s = '';
  for (let row = 1; ; row++) {
    const v = ws.getCell(`B${row}`).value;
    if (v === null || v === undefined || v === '') break;
    s += String(v);
  }
  return s || null;
}

/** _meta 시트 쓰기: 이름 '_meta', veryHidden, 통합문서의 마지막 시트 */
export function writeMeta(wb: Workbook, meta: FileMeta) {
  writeChunkSheet(wb, META_SHEET, MARK, JSON.stringify(meta));
}

export type ReadMetaResult =
  | { status: 'ok'; meta: FileMeta }
  | { status: 'missing' }
  | { status: 'tampered'; meta?: FileMeta };

/** _meta 시트 읽기 + 체크섬 확인 */
export async function readMeta(wb: Workbook): Promise<ReadMetaResult> {
  const json = readChunkSheet(wb, META_SHEET, MARK);
  if (!json) return { status: 'missing' };
  let meta: FileMeta;
  try {
    meta = JSON.parse(json) as FileMeta;
  } catch {
    return { status: 'tampered' };
  }
  const sum = await computeChecksum(meta);
  return sum === meta.checksum ? { status: 'ok', meta } : { status: 'tampered', meta };
}
