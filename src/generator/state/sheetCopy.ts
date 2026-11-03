import ExcelJS from 'exceljs';
import { snapshotSheet, type CollectSheet } from '@contract/collectSheet';

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
  return ws ? snapshotSheet(ws, fileName) : null;
}
