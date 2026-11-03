import ExcelJS from 'exceljs';
import { MAX_SHEET_BYTES, sheetBytes, snapshotSheet, type CollectSheet } from '@contract/collectSheet';

/** 이 엑셀(.xlsx 바이트)의 보이는 시트 이름들 */
export async function visibleSheetNames(bytes: Uint8Array): Promise<string[]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(bytes as unknown as ArrayBuffer);
  return wb.worksheets.filter((w) => w.state === 'visible').map((w) => w.name);
}

/** 쓰던 엑셀 시트를 시트 모으기형 빈 양식으로 쓸 사본. sheetName이 없으면 첫 번째 보이는 시트 */
export async function sheetCopyFromBytes(bytes: Uint8Array, fileName: string, sheetName?: string): Promise<CollectSheet | null> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(bytes as unknown as ArrayBuffer);
  const visible = wb.worksheets.filter((w) => w.state === 'visible');
  const ws = (sheetName && visible.find((w) => w.name === sheetName)) || visible[0];
  if (!ws) return null;
  const s = snapshotSheet(ws, fileName);
  if (sheetBytes(s) > MAX_SHEET_BYTES) throw new Error(`"${ws.name}" 시트가 너무 커요(${Math.round(sheetBytes(s) / 1000)}KB, ${Math.round(MAX_SHEET_BYTES / 1000)}KB까지). 빈 행·열이나 서식을 줄여서 다시 골라 주세요`);
  return s;
}
