import type { CellValue, NormalizedSubmission, RowRecord } from '@contract/meta';
import { readChunkSheet } from '@contract/metaIO';
import type { Field, FormSchema } from '@contract/schema';
import type { IssueCode } from '@contract/fieldTypes';
import { issueMessage, normalize, type Ctx } from './normalize';
import type { IdentifiedFile, ParsedSubmission, Question, RawCell, ReadResult, ReadRow, Slot } from './types';

/** ③ 값 정리 + ④ 검증: 읽은 원본 값 → 정리된 값, 자동 정리 목록, 확인할 칸 */

export const RECORDS_SHEET = '_records';
export const RECORDS_MARK = 'KDHC-RECORDS';

export function parseSubmission(f: IdentifiedFile, read: ReadResult, schema: FormSchema, ctx: Ctx): ParsedSubmission {
  const out: ParsedSubmission = {
    fileId: f.file.id, file: f, read, org: read.org, sourceFile: f.file.fileName, savedAt: f.savedAt,
    header: {}, rows: [], issues: [], autoFixed: [],
  };
  const sheet = read.sheetName;

  const take = (cell: RawCell | undefined, field: Field, slot: Slot, location: string): CellValue => {
    const raw = cell?.raw ?? null;
    const r = normalize(raw, field, ctx);
    const address = cell?.address;
    const push = (code: IssueCode, proposal?: CellValue) => out.issues.push({
      id: `${f.file.id}|${slotId(slot)}`, fileId: f.file.id, code, severity: 'value', sheet, address, location, slot,
      fieldLabel: field.label, raw, ...(proposal !== undefined ? { proposal } : {}), message: issueMessage(code, field),
    });
    if (r.status === 'auto' && address) out.autoFixed.push({ address, slot, from: raw, to: r.value });
    if (r.status === 'proposal' || r.status === 'invalid') push(r.issue!, r.proposal);
    else if (field.required && r.value === null && slot.part !== 'grid') push('REQUIRED_EMPTY');
    return r.value;
  };

  for (const b of schema.blocks) {
    if (b.kind === 'fields') {
      for (const field of b.fields) if (field.type !== 'calc') out.header[field.key] = take(read.header[field.key], field, { part: 'header', key: field.key }, `위쪽 정보 · ${field.label}`);
    }
    if (b.kind === 'list') out.rows = rowsOf(read.rows, b.columns, 'row', '목록', take);
    if (b.kind === 'matrix' && read.matrix) {
      out.matrix = b.rowLabels.map((rl, r) => b.colLabels.map((cl, c) =>
        take(read.matrix![r]?.[c], b.cell, { part: 'matrix', key: b.cell.key, r, c }, `표 · ${rl} ${cl}`)));
    }
    if (b.kind === 'grid') {
      out.grid = {};
      for (const cell of b.rows.flat()) {
        if (cell.kind !== 'input' || !read.grid?.[cell.field.key]) continue;
        const v = take(read.grid[cell.field.key], cell.field, { part: 'grid', key: cell.field.key }, cell.field.label);
        if (v !== null) out.grid[cell.field.key] = v;
      }
      if (read.gridSpareRows) out.gridSpareRows = rowsOf(read.gridSpareRows, b.spareColumns ?? [], 'spare', '여유 줄', take);
    }
  }

  for (const info of read.infos) {
    out.issues.push({ id: `${f.file.id}|info|${out.issues.length}`, fileId: f.file.id, code: info.code, severity: 'info', sheet, address: info.address, location: info.address ?? '파일', message: info.message });
  }
  for (const note of f.notes) out.issues.push({ id: `${f.file.id}|note|${out.issues.length}`, fileId: f.file.id, code: note.includes('변조') ? 'META_TAMPERED' : note.includes('버전') ? 'VERSION_MISMATCH' : 'META_MISSING', severity: 'info', sheet, location: '파일', message: note });
  read.questions.push(...sameRowTwice(out.rows, f.file.id));
  return out;
}

type Take = (cell: RawCell | undefined, field: Field, slot: Slot, location: string) => CellValue;

function rowsOf(rows: ReadRow[], fields: Field[], part: 'row' | 'spare', where: string, take: Take): RowRecord[] {
  return rows.map((row) => ({
    sourceRow: row.sourceRow,
    ...(row.flags.length ? { flags: row.flags } : {}),
    values: Object.fromEntries(fields.filter((x) => x.type !== 'calc').map((x) =>
      [x.key, take(row.cells[x.key], x, { part, key: x.key, sourceRow: row.sourceRow }, `${where} ${row.sourceRow}행 · ${x.label}`)])),
  }));
}

export function slotId(s: Slot): string {
  switch (s.part) {
    case 'header': case 'grid': return `${s.part}:${s.key}`;
    case 'row': case 'spare': return `${s.part}:${s.sourceRow}:${s.key}`;
    case 'matrix': return `matrix:${s.r}:${s.c}`;
  }
}

/** 한 파일 안에서 모든 칸이 같은 줄이 또 나오면 물어본다 (기본 = 둘 다 넣기) */
function sameRowTwice(rows: RowRecord[], fileId: string): Question[] {
  const seen = new Map<string, number>();
  const qs: Question[] = [];
  for (const r of rows) {
    const key = JSON.stringify(r.values);
    if (Object.values(r.values).every((v) => v === null)) continue;
    const first = seen.get(key);
    if (first === undefined) { seen.set(key, r.sourceRow); continue; }
    qs.push({
      id: `twice:${fileId}:${r.sourceRow}`, fileId, kind: 'same-row-twice', sourceRow: r.sourceRow,
      message: `${r.sourceRow}행이 ${first}행과 모든 칸이 같아요`,
      choices: [{ id: 'both', label: '둘 다 넣기' }, { id: 'one', label: '하나만 넣기' }], defaultChoice: 'both',
    });
  }
  return qs;
}

/** 본부 취합본: _records를 풀어 제출본 여러 개로 (②~④ 건너뜀, 3.2 마지막 문단) */
export function expandAggregate(f: IdentifiedFile): ParsedSubmission[] {
  const json = f.workbook ? readChunkSheet(f.workbook, RECORDS_SHEET, RECORDS_MARK) : null;
  let recs: NormalizedSubmission[] = [];
  try { recs = json ? (JSON.parse(json) as NormalizedSubmission[]) : []; } catch { recs = []; }
  return recs.map((r, i) => {
    const fileId = `${f.file.id}#${i}`;
    const read: ReadResult = {
      fileId, sheetName: '', org: r.org, header: {}, rows: [], excludedRows: [], extraColumns: [], authorNotes: [],
      unreadSheets: [], totalRowChecks: [], infos: [], questions: [], readCount: r.rows.length,
    };
    return { ...r, fileId, file: f, read, sourceFile: `${f.file.fileName} › ${r.sourceFile}`, issues: [], autoFixed: [], fromAggregate: true };
  });
}
