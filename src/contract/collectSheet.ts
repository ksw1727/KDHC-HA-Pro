import type ExcelJS from 'exceljs';

/**
 * 시트 모으기형: 쓰던 엑셀 시트를 그대로 빈 양식으로 쓸 때의 시트 사본 (2026-11-03).
 * 값·수식·서식·합친 칸·열 너비·줄 높이·입력 규칙·조건부 서식·틀 고정을 담는다. 그림·도형은 담지 못한다.
 * 칸 값만 담는 starter와 달리 합친 칸과 여러 단 머리글이 그대로 남는다.
 * AI에게는 보내지 않는다(크고, AI가 고칠 것이 아님). 화면이 보관했다가 AI가 준 양식에 다시 붙인다.
 */
export interface CollectSheet {
  name: string;                       // 원래 시트 이름 (빈 양식의 시트 이름이 된다)
  source?: string;                    // 원래 파일 이름 (화면 안내용)
  cells: SheetCell[];                 // 값이나 서식이 있는 칸만
  styles: Record<string, unknown>[];  // 칸 서식(ExcelJS style). cells의 세 번째 값이 이 번호
  merges: string[];                   // 'A1:Z1'
  cols: (number | null)[];            // 1열부터 열 너비 (null = 기본)
  hiddenCols?: number[];
  rows: [number, number][];           // [행, 높이]
  hiddenRows?: number[];
  validations?: Record<string, unknown>;   // 주소 → ExcelJS 입력 규칙
  conditional?: unknown[];                  // ExcelJS 조건부 서식
  freeze?: { row: number; col: number };
  landscape?: boolean;
  printArea?: string;
}
export type SheetValue =
  | string | number | boolean | null
  | { f: string; r?: string | number | boolean | null }   // 수식 (r = 마지막 계산 값)
  | { d: string }                                          // 날짜 (ISO)
  | { rt: { text: string; font?: Record<string, unknown> }[] };   // 칸 안 글자마다 서식
export type SheetCell = [address: string, value: SheetValue, style?: number];

const json = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
const empty = (o: unknown) => !o || (typeof o === 'object' && Object.keys(o as object).length === 0);

function valueOf(cell: ExcelJS.Cell): SheetValue {
  const v = cell.value as unknown;
  if (v === null || v === undefined) return null;
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return v;
  if (v instanceof Date) return { d: v.toISOString() };
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    if (typeof o.formula === 'string') return { f: o.formula, ...(o.result !== undefined && typeof o.result !== 'object' ? { r: o.result as string | number | boolean } : {}) };
    if ('sharedFormula' in o) {
      // 공유 수식은 칸마다 풀어 쓴 수식으로 (없으면 마지막 값)
      const f = (cell as unknown as { formula?: string }).formula;
      return typeof f === 'string' && f ? { f } : typeof o.result === 'number' || typeof o.result === 'string' ? o.result : null;
    }
    if (Array.isArray(o.richText)) return { rt: json(o.richText as { text: string; font?: Record<string, unknown> }[]) };
    if (typeof o.text === 'string') return o.text;   // 하이퍼링크는 글자만
  }
  return null;   // 오류 값 등
}

/** 엑셀 시트 → 시트 사본 */
export function snapshotSheet(ws: ExcelJS.Worksheet, source?: string): CollectSheet {
  const styles: Record<string, unknown>[] = [];
  const styleNo = new Map<string, number>();
  const cells: SheetCell[] = [];
  const rows: [number, number][] = [];
  const hiddenRows: number[] = [];
  ws.eachRow({ includeEmpty: true }, (row, r) => {
    if (row.height) rows.push([r, row.height]);
    if (row.hidden) hiddenRows.push(r);
    row.eachCell({ includeEmpty: true }, (cell) => {
      // 합친 칸의 나머지 칸은 값이 없고 테두리만 쓴다 (값은 첫 칸에)
      const value = cell.isMerged && cell.master !== cell ? null : valueOf(cell);
      const st = cell.style && !empty(cell.style) ? json(cell.style) as Record<string, unknown> : null;
      if (value === null && !st) return;
      let n: number | undefined;
      if (st) {
        const key = JSON.stringify(st);
        n = styleNo.get(key);
        if (n === undefined) { n = styles.length; styles.push(st); styleNo.set(key, n); }
      }
      cells.push(n === undefined ? [cell.address, value] : [cell.address, value, n]);
    });
  });
  const ncols = Math.max(ws.columnCount, 0);
  const cols: (number | null)[] = [];
  const hiddenCols: number[] = [];
  for (let c = 1; c <= ncols; c++) {
    const col = ws.getColumn(c);
    cols.push(col.width ?? null);
    if (col.hidden) hiddenCols.push(c);
  }
  const merges = [...((ws.model as { merges?: string[] }).merges ?? [])];
  const dv = (ws as unknown as { dataValidations?: { model?: Record<string, unknown> } }).dataValidations?.model;
  const cf = (ws as unknown as { conditionalFormattings?: unknown[] }).conditionalFormattings;
  const view = ws.views?.find((x) => x.state === 'frozen') as { xSplit?: number; ySplit?: number } | undefined;
  return {
    name: ws.name, ...(source ? { source } : {}), cells, styles, merges, cols, rows,
    ...(hiddenCols.length ? { hiddenCols } : {}), ...(hiddenRows.length ? { hiddenRows } : {}),
    ...(dv && !empty(dv) ? { validations: json(dv) } : {}),
    ...(cf?.length ? { conditional: json(cf) } : {}),
    ...(view && (view.xSplit || view.ySplit) ? { freeze: { row: view.ySplit ?? 0, col: view.xSplit ?? 0 } } : {}),
    ...(ws.pageSetup?.orientation === 'landscape' ? { landscape: true } : {}),
    ...(ws.pageSetup?.printArea ? { printArea: ws.pageSetup.printArea } : {}),
  };
}

function excelValue(v: SheetValue): ExcelJS.CellValue {
  if (v === null || typeof v !== 'object') return v;
  if ('f' in v) return { formula: v.f, ...(v.r !== undefined && v.r !== null ? { result: v.r } : {}) } as ExcelJS.CellFormulaValue;
  if ('d' in v) return new Date(v.d);
  return { richText: v.rt } as ExcelJS.CellRichTextValue;
}

/** 시트 사본 → 엑셀 시트 (빈 양식 내보내기) */
export function applySheet(ws: ExcelJS.Worksheet, s: CollectSheet) {
  s.cols.forEach((w, i) => { if (w) ws.getColumn(i + 1).width = w; });
  for (const c of s.hiddenCols ?? []) ws.getColumn(c).hidden = true;
  for (const [r, h] of s.rows) ws.getRow(r).height = h;
  for (const r of s.hiddenRows ?? []) ws.getRow(r).hidden = true;
  for (const [a, v, n] of s.cells) {
    const cell = ws.getCell(a);
    if (n !== undefined && s.styles[n]) cell.style = json(s.styles[n]) as Partial<ExcelJS.Style>;
    if (v !== null) cell.value = excelValue(v);
  }
  for (const m of s.merges) { try { ws.mergeCells(m); } catch { /* 겹치는 병합은 건너뜀 */ } }
  if (s.validations) {
    const dv = (ws as unknown as { dataValidations?: { model: Record<string, unknown> } }).dataValidations;
    if (dv) dv.model = json(s.validations);
  }
  for (const cf of s.conditional ?? []) { try { ws.addConditionalFormatting(json(cf) as ExcelJS.ConditionalFormattingOptions); } catch { /* 못 옮기는 조건부 서식은 건너뜀 */ } }
  if (s.freeze) ws.views = [{ state: 'frozen', xSplit: s.freeze.col, ySplit: s.freeze.row }];
  if (s.landscape || s.printArea) ws.pageSetup = { ...ws.pageSetup, ...(s.landscape ? { orientation: 'landscape' as const } : {}), ...(s.printArea ? { printArea: s.printArea } : {}) };
}

/** 화면 안내용 크기: 마지막 행·열, 합친 칸 수 */
export function sheetSize(s: CollectSheet): { rows: number; cols: number; merges: number } {
  let rows = 0, cols = 0;
  for (const [a, v] of s.cells) {
    if (v === null) continue;
    const m = /^([A-Z]+)(\d+)$/.exec(a);
    if (!m) continue;
    rows = Math.max(rows, Number(m[2]));
    cols = Math.max(cols, m[1].split('').reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0));
  }
  return { rows, cols, merges: s.merges.length };
}

/** 칸 값 글자 (미리보기용) */
export function sheetText(v: SheetValue): string | number | undefined {
  if (v === null) return undefined;
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  if (typeof v !== 'object') return v;
  if ('f' in v) return v.r === undefined || v.r === null ? `=${v.f}` : typeof v.r === 'boolean' ? String(v.r) : v.r;
  if ('d' in v) return v.d.slice(0, 10);
  return v.rt.map((x) => x.text).join('');
}

/** 사본 크기 한도: 양식은 서버에 512KB까지 저장되고 내보낸 기록과 함께 두 벌 들어가므로 그 아래로 */
export const MAX_SHEET_BYTES = 200_000;
export const sheetBytes = (s: CollectSheet) => new TextEncoder().encode(JSON.stringify(s)).byteLength;

/** 저장 공간을 아끼려고 내용을 비운 사본 (지난 대화 카드·바꾸기 전 양식용). 이름·파일만 남는다 */
export function sheetStub(s: CollectSheet): CollectSheet {
  return { name: s.name, ...(s.source ? { source: s.source } : {}), cells: [], styles: [], merges: [], cols: [], rows: [] };
}

/** AI에게 보낼 때 사본을 떼어 낸 양식 + 사본 */
export function withoutSheet<T extends { collect?: { sheet?: CollectSheet } }>(s: T): T {
  if (!s.collect?.sheet) return s;
  const { sheet: _sheet, ...rest } = s.collect;
  return { ...s, collect: rest };
}
