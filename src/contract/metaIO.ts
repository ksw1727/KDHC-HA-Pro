import type { CellValue, Workbook } from 'exceljs';
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

/** 칸 글자. LibreOffice·한셀 등이 다시 저장하면 글꼴(영문/한글)별로 나뉜 서식 있는 글자(richText)가 될 수 있다 */
const cellString = (v: CellValue): string =>
  v !== null && typeof v === 'object' && 'richText' in v ? v.richText.map((r) => r.text).join('') : v === null || v === undefined ? '' : String(v);

export function readChunkSheet(wb: Workbook, name: string, mark: string): string | null {
  const ws = wb.getWorksheet(name);
  if (!ws || cellString(ws.getCell('A1').value) !== mark) return null;
  let s = '';
  for (let row = 1; ; row++) {
    const v = cellString(ws.getCell(`B${row}`).value);
    if (v === '') break;
    s += v;
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
