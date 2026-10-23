import type ExcelJS from 'exceljs';
import { META_SHEET } from '@contract/metaIO';
import { addr, colLetter, colNumber, parseAddr } from '@contract/layout';
import type { CellMap, FieldsBlockMap, GridBlockMap, ListBlockMap, MatrixBlockMap, RowFlag } from '@contract/meta';
import { orgLabel, sameOrg, type Field, type FieldsBlock, type FormSchema, type GridBlock, type ListBlock, type MatrixBlock } from '@contract/schema';
import type { BaseForm, IdentifiedFile, Question, RawCell, ReadResult, ReadRow, Slot } from './types';
import { normalize } from './normalize';
import { cellText, formLabels, isBlank, noteText, normLabel, plainValue, similar } from './cellValue';

/** 03-aggregator.md 3.3 ② 읽기 — 칸 지도(CellMap)로 정확한 칸을 읽고, 지도와 다르면 칸 이름으로 다시 찾는다 */

const HIDDEN_SHEETS = new Set([META_SHEET, '_records', '_lists']);
const DITTO = new Set(['〃', '"', '”', '상동', '위와같음', '위와 같음', '동상']);
const TOTAL_RE = /^(합\s*계|소\s*계|총\s*계|계)$/;
const HEADER_SEARCH = 3;   // 머리글 행이 밀렸을 때 위아래로 찾아보는 줄 수

const isCalc = (f: Field) => f.type === 'calc';

/** 이 파일을 읽을 때 쓸 칸 지도와 양식 (파일 자신의 메타가 같은 버전이면 그것, 아니면 기준 양식 것) */
function mapFor(f: IdentifiedFile, base: BaseForm): { cellMap?: CellMap; sheetName?: string; fileSchema?: FormSchema } {
  const own = f.meta;
  if (own?.cellMap && own.schema.formVersion === base.schema.formVersion) return { cellMap: own.cellMap, sheetName: own.sheetName, fileSchema: own.schema };
  return { cellMap: own?.cellMap ?? base.meta?.cellMap, sheetName: own?.sheetName ?? base.meta?.sheetName, fileSchema: own?.schema };
}

/** 같은 항목 key의 이름들 (파일이 옛 버전이면 옛 이름도 칸 이름 찾기에 쓴다) */
function labelsOf(field: Field, fileSchema?: FormSchema): string[] {
  const names = [field.label];
  for (const b of fileSchema?.blocks ?? []) {
    const old = (b.kind === 'list' ? b.columns : b.kind === 'fields' ? b.fields : []).find((x) => x.key === field.key);
    if (old && old.label !== field.label) names.push(old.label);
  }
  return names.map(normLabel);
}

const visibleSheets = (wb: ExcelJS.Workbook) => wb.worksheets.filter((ws) => ws.state === 'visible' && !HIDDEN_SHEETS.has(ws.name));

function sheetScore(ws: ExcelJS.Worksheet, labels: string[]): number {
  const seen = new Set<string>();
  ws.eachRow({ includeEmpty: false }, (row) => row.eachCell({ includeEmpty: false }, (c) => { seen.add(normLabel(cellText(c.value))); }));
  return labels.filter((l) => seen.has(l)).length;
}

/** 양식 시트 찾기: 메타의 시트 이름 → 칸 이름이 가장 많이 맞는 보이는 시트 */
function findFormSheet(wb: ExcelJS.Workbook, sheetName: string | undefined, schema: FormSchema): ExcelJS.Worksheet | undefined {
  const named = sheetName ? wb.getWorksheet(sheetName) : undefined;
  if (named && named.state === 'visible') return named;
  const labels = formLabels(schema);
  const scored = visibleSheets(wb).map((ws) => ({ ws, s: sheetScore(ws, labels) })).sort((a, b) => b.s - a.s);
  return scored[0] && scored[0].s >= Math.max(1, Math.ceil(labels.length * 0.5)) ? scored[0].ws : undefined;
}

function rawCellOf(ws: ExcelJS.Worksheet, address: string): RawCell & { strike: boolean } {
  const c = ws.getCell(address);
  const comment = noteText(c.note);
  const merged = c.isMerged && c.master.address !== c.address;
  return { raw: plainValue(c.value), address, ...(comment ? { comment } : {}), ...(merged ? { fill: 'merged' as const } : {}), strike: !!c.font?.strike };
}

/** 자동 필터 범위의 데이터 줄(머리글 줄 다음부터). 없으면 null */
function filterRows(ws: ExcelJS.Worksheet): [number, number] | null {
  const af = (ws as unknown as { autoFilter?: unknown }).autoFilter;
  if (!af) return null;
  const at = (x: unknown): string | undefined => {
    if (typeof x === 'string') return x;
    if (x && typeof x === 'object' && 'row' in x && 'column' in x) return addr(Number((x as { column: number }).column), Number((x as { row: number }).row));
    return undefined;
  };
  const ref = typeof af === 'string' ? af : `${at((af as { from?: unknown }).from) ?? ''}:${at((af as { to?: unknown }).to) ?? ''}`;
  const m = /^\$?([A-Z]+)\$?(\d+):\$?([A-Z]+)\$?(\d+)$/i.exec(ref.trim());
  if (!m) return null;
  return [Number(m[2]) + 1, Number(m[4])];
}

/**
 * 숨긴 줄·열 가려내기 (03-aggregator.md 3.3 "모양 속 숨은 뜻")
 * - 필터로 가린 줄: 보통 일부만 보려고 건 것이라 필터를 푼 것처럼 보통 줄로 읽고, 파일에 안내만 남긴다.
 * - 직접 숨긴 줄·열: 값이 있으면 어디인지 모아 두고, 파일마다 넣을지 묻는다(기본 = 넣기).
 */
class HiddenArea {
  private filter: [number, number] | null;
  private filtered = new Set<number>();
  private msgRows = new Set<number>();
  private msgCols = new Map<number, string>();
  constructor(private ws: ExcelJS.Worksheet, private out: ReadResult) { this.filter = filterRows(ws); }

  /** 이 줄이 직접 숨긴 줄인가 (필터로 가린 줄은 false, 따로 셈다) */
  row(r: number): boolean {
    if (!this.ws.getRow(r).hidden) return false;
    if (this.filter && r >= this.filter[0] && r <= this.filter[1]) { this.filtered.add(r); return false; }
    return true;
  }
  col(c: number): boolean { return !!this.ws.getColumn(c).hidden; }
  private area() { return (this.out.hiddenArea ??= { rows: [], cols: [], slots: [], extraHeaders: [] }); }
  /** 값이 있는 숨긴 목록 줄 */
  addRow(r: number) { this.area().rows.push(r); this.msgRows.add(r); }
  /** 값이 있는 칸이 숨긴 줄·열에 있으면 기록. 기록했으면 true */
  addCell(address: string, slot: Slot, label: string): boolean {
    const { row, col } = parseAddr(address);
    const byRow = this.row(row), byCol = this.col(col);
    if (!byRow && !byCol) return false;
    this.area().slots.push(slot);
    if (byRow) this.msgRows.add(row);
    if (byCol) this.msgCols.set(col, label);
    return true;
  }
  addExtra(col: number, header: string) { this.area().extraHeaders.push(header); this.msgCols.set(col, header); }

  /** 파일 하나를 다 읽은 뒤: 필터 안내와 숨긴 곳 질문 */
  finish() {
    if (this.filtered.size)
      this.out.infos.push({ code: 'FILTER_CLEARED', message: `필터가 걸린 채 제출된 파일이에요. 필터로 가려진 ${this.filtered.size}줄도 필터를 푼 것처럼 함께 합쳤어요` });
    const a = this.out.hiddenArea;
    if (!a || (!a.rows.length && !a.slots.length && !a.extraHeaders.length)) return;
    a.cols = [...this.msgCols.entries()].sort((x, y) => x[0] - y[0]).map(([c, l]) => `${colLetter(c)}열 "${l}"`);
    const rows = [...this.msgRows].sort((x, y) => x - y);
    const parts = [
      rows.length ? `숨긴 줄 ${rows.length}개(${rows.slice(0, 6).join('·')}${rows.length > 6 ? '…' : ''}행)` : '',
      a.cols.length ? `숨긴 열 ${a.cols.length}개(${a.cols.join(', ')})` : '',
    ].filter(Boolean);
    this.out.questions.push({
      id: `hidden:${this.out.fileId}`, fileId: this.out.fileId, kind: 'hidden-area',
      message: `${parts.join('과 ')}에 값이 있어요. 숨긴 곳의 값도 취합에 넣을까요?`,
      choices: [{ id: 'include', label: '넣기' }, { id: 'exclude', label: '빼기' }], defaultChoice: 'include',
    });
  }
}

function emptyResult(f: IdentifiedFile, sheetName: string): ReadResult {
  return {
    fileId: f.file.id, sheetName, header: {}, rows: [], excludedRows: [], extraColumns: [], authorNotes: [],
    unreadSheets: [], totalRowChecks: [], infos: [], questions: [], readCount: 0,
  };
}

/** 파일 하나 읽기 (구조 5종) */
export function readSubmission(f: IdentifiedFile, base: BaseForm): ReadResult {
  const wb = f.workbook!;
  const schema = base.schema;
  const { cellMap, sheetName, fileSchema } = mapFor(f, base);
  if (schema.layout === 'collect') return readCollect(f, schema, sheetName);
  const ws = findFormSheet(wb, sheetName, schema);
  const out = emptyResult(f, ws?.name ?? sheetName ?? '');
  if (!ws || !cellMap) {
    out.infos.push({ code: 'FORM_SHEET_MISSING', message: '양식 시트가 없어요. 시트를 지웠거나 이름과 칸이 너무 많이 바뀌었어요' });
    return out;
  }
  if (ws.name !== sheetName) out.infos.push({ code: 'LABEL_MOVED', message: `양식 시트 이름이 "${ws.name}"(으)로 바뀌어 있었어요. 칸 이름으로 찾았어요` });
  out.unreadSheets = visibleSheets(wb).filter((s) => s !== ws).map((s) => s.name);
  for (const name of out.unreadSheets) out.infos.push({ code: 'EXTRA_SHEET', message: `작성자가 추가한 "${name}" 시트는 읽지 않았어요` });

  const orgCell = cellMap.orgCell ? cellText(ws.getCell(cellMap.orgCell).value).trim() : '';
  out.org = f.orgFromFile ?? (orgCell || undefined);
  // 제출처마다 나간 파일은 제출처명 칸이 잠겨 있다. 잠금을 풀고 바꿨으면 알린다 (파일에 적힌 제출처로 취합)
  if (f.orgFromFile && cellMap.orgCell && !sameOrg(orgCell, f.orgFromFile)) {
    const L = orgLabel(schema);
    out.infos.push({ code: 'FIXED_CELL_CHANGED', address: cellMap.orgCell,
      message: `잠긴 ${L}명 칸이 ${orgCell ? `"${orgCell}"(으)로 바뀌어` : '지워져'} 있었어요. 이 파일을 받은 ${L} "${f.orgFromFile}"(으)로 취합했어요` });
  }

  const h = new HiddenArea(ws, out);
  for (const b of schema.blocks) {
    const m = cellMap.blocks[b.id];
    if (b.kind === 'fields' && m?.kind === 'fields') readFields(ws, b, m, fileSchema, out, h, schema.layout === 'free');
    if (b.kind === 'list' && m?.kind === 'list') readList(ws, b, m, fileSchema, out, h, !!(ws as unknown as { sheetProtection?: object }).sheetProtection);
    if (b.kind === 'matrix' && m?.kind === 'matrix') readMatrix(ws, b, m, out, h);
    if (b.kind === 'grid' && m?.kind === 'grid') readGrid(ws, b, m, out, h);
  }
  h.finish();
  return out;
}

/** 시트 모으기형: 칸 단위로 읽지 않고 모을 시트만 정한다 (3.3 머리말) */
function readCollect(f: IdentifiedFile, schema: FormSchema, sheetName: string | undefined): ReadResult {
  const visible = visibleSheets(f.workbook!);
  const report = (sheetName && visible.find((s) => s.name === sheetName)) || visible[0];
  const sheets = schema.collect?.scope === 'all' ? visible : report ? [report] : [];
  const out = emptyResult(f, report?.name ?? '');
  out.org = f.orgFromFile;
  out.collectSheets = sheets.map((s) => s.name);
  out.unreadSheets = visible.filter((s) => !sheets.includes(s)).map((s) => s.name);
  if (!report) out.infos.push({ code: 'FORM_SHEET_MISSING', message: '모을 시트가 없어요' });
  for (const ws of sheets) {
    const n = ws.getImages().length;
    if (n) out.infos.push({ code: 'IMAGE_NOT_COPIED', message: `"${ws.name}" 시트의 그림 ${n}개는 옮겨지지 않았어요` });
  }
  return out;
}

const cellAt = (ws: ExcelJS.Worksheet, a: string): RawCell => {
  const { strike: _s, ...c } = rawCellOf(ws, a);
  return c;
};

/** 표형: 칸 지도대로 읽고, 행·열 제목이 자리에 없으면 제목 이름으로 위치를 다시 찾는다. 합계 행·열은 대조용으로만 */
function readMatrix(ws: ExcelJS.Worksheet, b: MatrixBlock, m: MatrixBlockMap, out: ReadResult, h: HiddenArea) {
  const find = (label: string) => {
    let hit: { col: number; row: number } | undefined;
    ws.eachRow({ includeEmpty: false }, (row, r) => row.eachCell({ includeEmpty: false }, (c, col) => {
      if (!hit && normLabel(cellText(c.value)) === normLabel(label)) hit = { col, row: r };
    }));
    return hit;
  };
  const locate = (labels: string[], cells: string[], what: '행' | '열', pick: 'row' | 'col') => labels.map((l, i) => {
    const a = cells[i];
    const here = a ? cellText(ws.getCell(a).value).trim() : '';
    if (a && normLabel(here) === normLabel(l)) return parseAddr(a)[pick];
    const hit = find(l);
    if (hit) {
      out.infos.push({ code: 'LABEL_MOVED', message: `${what} 제목 "${l}"이(가) 자리를 옮겨 있어서 이름으로 찾았어요` });
      return hit[pick];
    }
    // 이름만 고친 경우("1분기" → "1/4분기"): 제자리에 글자가 있고 다른 제목과 겹치지 않으면 그 자리로 읽는다
    if (a && here && !labels.some((x) => normLabel(x) === normLabel(here))) {
      out.infos.push({ code: 'LABEL_MOVED', message: `${what} 제목 "${l}"이(가) "${here}"(으)로 바뀌어 있었어요. 같은 자리라 "${l}"(으)로 읽었어요`, address: a });
      return parseAddr(a)[pick];
    }
    out.infos.push({ code: 'COLUMN_MISSING', message: `${what} 제목 "${l}"을(를) 찾지 못해 빈칸으로 둬요` });
    return undefined;
  });
  const rowOf = locate(b.rowLabels, m.rowLabelCells, '행', 'row');
  const colOf = locate(b.colLabels, m.colLabelCells, '열', 'col');
  const matrix = rowOf.map((r) => colOf.map((c) => (r && c ? cellAt(ws, addr(c, r)) : undefined)));
  (out.matrices ??= {})[b.id] = matrix;
  for (const row of matrix) for (const cell of row) if (cell?.comment) out.authorNotes.push({ address: cell.address, fieldKey: b.cell.key, text: cell.comment });
  matrix.forEach((row, r) => row.forEach((cell, c) => {
    if (cell && !isBlank(cell.raw)) h.addCell(cell.address, { part: 'matrix', key: b.cell.key, blockId: b.id, r, c }, `${b.rowLabels[r]} ${b.colLabels[c]}`);
  }));

  // 원본 파일에 적힌 합계 행·계 열 값 = 칸들의 합인지 대조 (값으로는 읽지 않음)
  const num = (v: unknown) => (typeof v === 'number' ? v : 0);
  const check = (address: string, computed: number, label: string) => {
    const written = plainValue(ws.getCell(address).value);
    if (typeof written !== 'number') return;
    out.totalRowChecks.push({ sourceRow: parseAddr(address).row, fieldKey: b.cell.key, written, computed, label });
    if (Math.abs(written - computed) > 1e-9) out.infos.push({ code: 'TOTAL_MISMATCH', message: `${label} 칸 ${written}이(가) 칸들의 합 ${computed}과 달라요(원본 파일의 합계)`, address });
  };
  const lastCol = Math.max(0, ...colOf.map((c) => c ?? 0));
  const lastRow = Math.max(0, ...rowOf.map((r) => r ?? 0));
  if (b.totalCol && lastCol) matrix.forEach((row, r) => { if (rowOf[r]) check(addr(lastCol + 1, rowOf[r]!), row.reduce((s, c) => s + num(c?.raw), 0), `${b.rowLabels[r]} 계`); });
  if (b.totalRow && lastRow) colOf.forEach((c, i) => { if (c) check(addr(c, lastRow + 1), matrix.reduce((s, row) => s + num(row[i]?.raw), 0), `합계 ${b.colLabels[i]}`); });
}

/** 빈칸채우기형: 입력칸 주소에서 읽고, 고정 칸이 바뀌었으면 알려만 준다. 여유 줄은 글이 있는 줄만 */
function readGrid(ws: ExcelJS.Worksheet, b: GridBlock, m: GridBlockMap, out: ReadResult, h: HiddenArea) {
  const grid: Record<string, RawCell> = {};
  out.grid = grid;
  for (const cell of b.rows.flat()) {
    if (cell.kind !== 'input') continue;
    const a = m.inputCells[cell.field.key];
    if (!a) continue;
    const c = cellAt(ws, a);
    if (!isBlank(c.raw)) { grid[cell.field.key] = c; h.addCell(a, { part: 'grid', key: cell.field.key }, cell.field.label); }
    if (c.comment) out.authorNotes.push({ address: a, fieldKey: cell.field.key, text: c.comment });
  }
  for (const [a, v] of Object.entries(m.fixedCells)) {
    const now = cellText(ws.getCell(a).value);
    if (now.trim() !== String(v).trim()) out.infos.push({ code: 'FIXED_CELL_CHANGED', message: `본사가 채운 ${a} 칸이 "${String(v)}"에서 "${now}"(으)로 바뀌어 있었어요. 바뀐 값은 쓰지 않아요`, address: a });
  }
  if (!m.spare) return;
  const fields = (b.spareColumns ?? []).map((f, i) => ({ f, col: colNumber(m.columns[i]) })).filter((x) => !isCalc(x.f));
  const spare: ReadRow[] = [];
  out.gridSpareRows = spare;
  const pendingBlank: number[] = [];
  let excluded = 0;
  for (let r = m.spare.firstRow; r <= m.spare.lastRow; r++) {
    const cells: Record<string, RawCell> = {};
    let strike = false;
    for (const { f, col } of fields) {
      const { strike: s, ...c } = rawCellOf(ws, addr(col, r));
      strike ||= s && !isBlank(c.raw);
      cells[f.key] = c;
    }
    if (Object.values(cells).every((c) => isBlank(c.raw))) { pendingBlank.push(r); continue; }
    for (const br of pendingBlank.splice(0)) { out.excludedRows.push({ sourceRow: br, reason: 'blank', preview: '' }); excluded++; }
    const preview = Object.values(cells).map((c) => (isBlank(c.raw) ? '' : String(c.raw))).filter(Boolean).join(' · ').slice(0, 60);
    if (Object.values(cells).some((c) => typeof c.raw === 'string' && TOTAL_RE.test(c.raw.trim()))) {
      out.excludedRows.push({ sourceRow: r, reason: 'total', preview });
      excluded++;
      continue;
    }
    const flags: RowFlag[] = [];
    if (h.row(r)) { flags.push('hidden'); h.addRow(r); }
    else for (const { f, col } of fields) if (!isBlank(cells[f.key].raw) && h.col(col)) h.addCell(cells[f.key].address, { part: 'spare', key: f.key, sourceRow: r }, f.label);
    if (strike) flags.push('strike');
    spare.push({ cells, sourceRow: r, flags });
    for (const [k, c] of Object.entries(cells)) if (c.comment) out.authorNotes.push({ address: c.address, fieldKey: k, sourceRow: r, text: c.comment });
  }
  out.readCount += spare.length + excluded;
}


function readFields(ws: ExcelJS.Worksheet, b: FieldsBlock, m: FieldsBlockMap, fileSchema: FormSchema | undefined, out: ReadResult, h: HiddenArea, trustMap = false) {
  for (const field of b.fields) {
    if (isCalc(field)) continue;
    const at = m.cells[field.key];
    const names = labelsOf(field, fileSchema);
    let valueAddr: string | undefined = at?.valueCell;
    // 자유 제작형은 왼쪽(위쪽) 글자 칸이 항목 이름과 다를 수 있어 칸 지도를 그대로 믿는다
    if (!at || (!trustMap && !names.includes(normLabel(cellText(ws.getCell(at.labelCell).value))))) {
      // 라벨이 제자리에 없으면 같은 시트에서 라벨을 찾아 바로 오른쪽 칸을 읽는다
      valueAddr = undefined;
      ws.eachRow({ includeEmpty: false }, (row, r) => row.eachCell({ includeEmpty: false }, (c, col) => {
        if (!valueAddr && names.includes(normLabel(cellText(c.value)))) valueAddr = `${colLetter(col + 1)}${r}`;
      }));
      out.infos.push(valueAddr
        ? { code: 'LABEL_MOVED', message: `"${field.label}" 칸이 자리를 옮겨 있어서 이름으로 찾았어요`, address: valueAddr }
        : { code: 'COLUMN_MISSING', message: `"${field.label}" 칸을 찾지 못해 빈칸으로 둬요` });
    }
    if (!valueAddr) continue;
    const { strike: _s, ...cell } = rawCellOf(ws, valueAddr);
    out.header[field.key] = cell;
    if (!isBlank(cell.raw)) h.addCell(valueAddr, { part: 'header', key: field.key }, field.label);
    if (cell.comment) out.authorNotes.push({ address: valueAddr, fieldKey: field.key, text: cell.comment });
  }
}

function readList(ws: ExcelJS.Worksheet, b: ListBlock, m: ListBlockMap, fileSchema: FormSchema | undefined, out: ReadResult, h: HiddenArea, isProtected: boolean) {
  const fields = b.columns.filter((x) => !isCalc(x));
  const headerAt = (row: number, col: number) => normLabel(cellText(ws.getCell(row, col).value));

  // 1. 머리글: 지도대로 맞는지 보고, 아니면 ±3줄에서 칸 이름이 가장 많이 맞는 줄을 머리글로
  const fits = (row: number) => fields.filter((x) => labelsOf(x, fileSchema).includes(headerAt(row, colNumber(m.columns[x.key] ?? 'A')))).length;
  let headerRow = m.headerRow;
  const colOf: Record<string, number> = {};
  if (fits(m.headerRow) === fields.length) {
    for (const x of fields) colOf[x.key] = colNumber(m.columns[x.key]);
  } else {
    let best = { row: m.headerRow, n: -1, map: {} as Record<string, number> };
    for (let row = Math.max(1, m.headerRow - HEADER_SEARCH); row <= m.headerRow + HEADER_SEARCH; row++) {
      const map: Record<string, number> = {};
      ws.getRow(row).eachCell({ includeEmpty: false }, (c, col) => {
        const t = normLabel(cellText(c.value));
        const hit = fields.find((x) => !(x.key in map) && labelsOf(x, fileSchema).includes(t));
        if (hit) map[hit.key] = col;
      });
      if (Object.keys(map).length > best.n) best = { row, n: Object.keys(map).length, map };
    }
    headerRow = best.row;
    Object.assign(colOf, best.map);
    if (headerRow !== m.headerRow) out.infos.push({ code: 'HEADER_MOVED', message: `머리글이 ${m.headerRow}행이 아니라 ${headerRow}행에 있었어요` });
    if (fields.some((x) => x.key in colOf && colOf[x.key] !== colNumber(m.columns[x.key])))
      out.infos.push({ code: 'COLUMNS_REORDERED', message: '칸 순서가 바뀌어 있어서 칸 이름으로 맞췄어요' });
  }

  // 2. 머리글 행의 나머지 글자: 비슷한 이름이면 물어보고(기본 = 맞춤), 아니면 양식에 없는 칸으로 보관
  const extraCols: { col: number; header: string }[] = [];
  ws.getRow(headerRow).eachCell({ includeEmpty: false }, (c, col) => {
    if (col === 1 || Object.values(colOf).includes(col)) return;
    const text = cellText(c.value).trim();
    const t = normLabel(text);
    const cand = fields.find((x) => !(x.key in colOf) && labelsOf(x, fileSchema).some((l) => similar(l, t)));
    if (cand) {
      colOf[cand.key] = col;
      const q: Question = {
        id: `alias:${out.fileId}:${cand.key}`, fileId: out.fileId, kind: 'column-alias', fieldKey: cand.key, header: text,
        message: `칸 이름 "${text}"을(를) "${cand.label}" 칸으로 볼까요?`,
        choices: [{ id: 'map', label: '예' }, { id: 'extra', label: '아니오(추가 칸으로)' }], defaultChoice: 'map',
      };
      out.questions.push(q);
    } else extraCols.push({ col, header: text });
  });
  for (const x of fields) if (!(x.key in colOf)) out.infos.push({ code: 'COLUMN_MISSING', message: `"${x.label}" 칸이 없어서 빈칸으로 둬요` });
  const extras = extraCols.map((e) => ({ header: e.header, values: [] as { sourceRow: number; value: unknown }[] }));

  // 3. 데이터 줄: 지도의 입력 줄 범위(머리글이 밀린 만큼 같이 밀기). 보호가 풀린 사본은 표가 이어지면 더 읽는다
  const shift = headerRow - m.headerRow;
  // 예시 줄도 읽는다: 예시 그대로면 빼고, 작성자가 실제 값으로 덮어 썼으면 데이터로 (예시 줄을 첫 줄로 쓰는 경우가 많다)
  const exampleRow = m.exampleRow !== undefined && b.exampleRow ? m.exampleRow + shift : undefined;
  const first = exampleRow ?? m.firstDataRow + shift;
  let last = m.lastDataRow + shift;
  if (!isProtected) while (last < ws.rowCount && rowHasText(ws, last + 1, colOf, extraCols)) last++;

  const prev: Record<string, RawCell> = {};
  const pendingBlank: number[] = [];
  const totals: Record<string, number> = {};
  const hiddenExtra = new Set<string>();
  for (let r = first; r <= last; r++) {
    const row = ws.getRow(r);
    const cells: Record<string, RawCell> = {};
    let strike = false;
    for (const x of fields) {
      if (!(x.key in colOf)) continue;
      const { strike: s, ...cell } = rawCellOf(ws, `${colLetter(colOf[x.key])}${r}`);
      strike ||= s && !isBlank(cell.raw);
      if (typeof cell.raw === 'string' && DITTO.has(cell.raw.trim()) && prev[x.key]) {
        cells[x.key] = { ...cell, raw: prev[x.key].raw, fill: 'ditto', comment: [cell.comment, `원래 값: ${cell.raw.trim()}`].filter(Boolean).join('\n') };
      } else cells[x.key] = cell;
    }
    const extraVals = extraCols.map((e) => plainValue(ws.getCell(r, e.col).value));
    const blank = Object.values(cells).every((c) => isBlank(c.raw)) && extraVals.every(isBlank);
    if (blank) { if (r !== exampleRow) pendingBlank.push(r); continue; }
    // 글이 있는 줄 사이에 낀 빈 줄만 "빈 줄"로 센다 (끝의 남은 입력 줄은 세지 않음)
    for (const br of pendingBlank.splice(0)) out.excludedRows.push({ sourceRow: br, reason: 'blank', preview: '' });
    const preview = fields.map((x) => cellText(ws.getCell(r, colOf[x.key] ?? 1).value)).filter(Boolean).join(' · ').slice(0, 60);

    if (r === exampleRow) {
      const same = (x: Field) => {
        const want = b.exampleRow?.[x.key];
        const got = cells[x.key]?.raw;
        if (isBlank(want)) return isBlank(got);
        return got !== undefined && sameValue(want, got, x);
      };
      if (fields.every(same)) { out.excludedRows.push({ sourceRow: r, reason: 'example', preview }); continue; }   // fields엔 계산 칸이 없음
      out.infos.push({ code: 'EXAMPLE_ROW_USED', message: `예시 줄(${r}행)에 적은 값을 데이터로 읽었어요`, address: `A${r}` });
    }
    if (Object.values(cells).some((c) => typeof c.raw === 'string' && TOTAL_RE.test(c.raw.trim()))) {
      out.excludedRows.push({ sourceRow: r, reason: 'total', preview });
      for (const x of fields) {
        const w = cells[x.key]?.raw;
        if (x.type === 'number' && typeof w === 'number') {
          out.totalRowChecks.push({ sourceRow: r, fieldKey: x.key, written: w, computed: totals[x.key] ?? 0 });
          if (Math.abs(w - (totals[x.key] ?? 0)) > 1e-9)
            out.infos.push({ code: 'TOTAL_MISMATCH', message: `${r}행 합계 줄의 "${x.label}" ${w}이(가) 위 줄들의 합 ${totals[x.key] ?? 0}과 달라요(원본 파일의 합계)`, address: `${colLetter(colOf[x.key])}${r}` });
        }
      }
      continue;
    }

    const flags: RowFlag[] = [];
    if (h.row(row.number)) { flags.push('hidden'); h.addRow(r); }
    else {
      for (const x of fields) { const c = cells[x.key]; if (c && !isBlank(c.raw) && h.col(colOf[x.key])) h.addCell(c.address, { part: 'row', key: x.key, sourceRow: r }, x.label); }
      extraCols.forEach((e, i) => { if (!isBlank(extraVals[i]) && h.col(e.col) && !hiddenExtra.has(e.header)) { hiddenExtra.add(e.header); h.addExtra(e.col, e.header); } });
    }
    if (strike) flags.push('strike');
    const rec: ReadRow = { cells, sourceRow: r, flags };
    out.rows.push(rec);
    for (const x of fields) {
      const c = cells[x.key];
      if (!c) continue;
      prev[x.key] = c;
      if (x.type === 'number') totals[x.key] = (totals[x.key] ?? 0) + asNumber(c.raw, x);
      if (c.comment && c.fill !== 'ditto') out.authorNotes.push({ address: c.address, fieldKey: x.key, sourceRow: r, text: c.comment });
    }
    extraVals.forEach((v, i) => { if (!isBlank(v)) extras[i].values.push({ sourceRow: r, value: v }); });
  }
  out.extraColumns.push(...extras.filter((e) => e.values.length));

  // 4. 보호가 풀린 사본: 표 밖에 적힌 글은 데이터로 섞지 않고 알려만 준다
  if (!isProtected) {
    const maxCol = Math.max(...Object.values(colOf), ...extraCols.map((e) => e.col));
    ws.eachRow({ includeEmpty: false }, (row, r) => row.eachCell({ includeEmpty: false }, (c, col) => {
      const outside = (r >= headerRow && col > maxCol) || r > last;
      if (outside && !isBlank(plainValue(c.value))) out.infos.push({ code: 'TEXT_OUTSIDE_INPUT', message: `표 밖 ${c.address}에 적힌 "${cellText(c.value).slice(0, 30)}"은(는) 읽지 않았어요`, address: c.address });
    }));
  }
  out.readCount += out.rows.length + out.excludedRows.length;
}

function rowHasText(ws: ExcelJS.Worksheet, r: number, colOf: Record<string, number>, extra: { col: number }[]): boolean {
  return [...Object.values(colOf), ...extra.map((e) => e.col)].some((col) => !isBlank(plainValue(ws.getCell(r, col).value)));
}


/** 예시 줄 비교: 엑셀이 '2026-12'를 날짜로, '25000'을 숫자로 바꿔 저장해도 같은 값으로 본다 */
function sameValue(a: unknown, b: unknown, field: Field): boolean {
  const ctx = { year: 2000, today: new Date(0) };
  const v = (x: unknown) => { const r = normalize(x, field, ctx); const val = r.status === 'ok' || r.status === 'auto' ? r.value : x; return val instanceof Date ? val.toISOString().slice(0, 10) : String(val ?? '').trim(); };
  return v(a) === v(b);
}

/** 합계 줄 대조용 숫자: '1,000개'·'약 10'처럼 값 정리에서 숫자가 되는 것은 그 숫자로 */
function asNumber(raw: unknown, field: Field): number {
  const r = normalize(raw, field, { year: 2000, today: new Date(0) });
  return typeof r.value === 'number' ? r.value : typeof r.proposal === 'number' ? r.proposal : 0;
}
