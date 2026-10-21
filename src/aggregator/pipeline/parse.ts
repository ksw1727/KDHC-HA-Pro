import type { CellValue, NormalizedSubmission, RowRecord } from '@contract/meta';
import { readChunkSheet } from '@contract/metaIO';
import { gridOwners, sameOrg, type Field, type FormSchema } from '@contract/schema';
import type { IssueCode } from '@contract/fieldTypes';
import { josa } from '@contract/josa';
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
    if (b.kind === 'matrix' && read.matrices?.[b.id]) {
      const m = read.matrices[b.id];
      const where = b.title?.trim() || '표';
      (out.matrices ??= {})[b.id] = b.rowLabels.map((rl, r) => b.colLabels.map((cl, c) =>
        take(m[r]?.[c], b.cell, { part: 'matrix', key: b.cell.key, blockId: b.id, r, c }, `${where} · ${rl} ${cl}`)));
    }
    if (b.kind === 'grid') {
      out.grid = {};
      const owners = gridOwners(schema);
      for (const cell of b.rows.flat()) {
        if (cell.kind !== 'input' || !read.grid?.[cell.field.key]) continue;
        // 작성처가 정해진 칸은 그 제출처 파일에서만 읽는다. 남의 칸에 적은 값은 쓰지 않고 알린다
        const owner = owners.get(cell.field.key);
        if (owner && read.org && !sameOrg(owner, read.org)) {
          const rc = read.grid[cell.field.key];
          out.issues.push({ id: `${f.file.id}|other|${cell.field.key}`, fileId: f.file.id, code: 'OTHER_ORG_CELL', severity: 'info', sheet, address: rc.address, location: cell.field.label, fieldLabel: cell.field.label, raw: rc.raw,
            message: `${owner} 칸에 적은 값 ${josa(`'${String(rc.raw)}'`, '은', '는')} 쓰지 않았어요 (이 칸은 ${josa(owner, '이', '가')} 채워요)` });
          continue;
        }
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
    case 'matrix': return `matrix:${s.blockId}:${s.r}:${s.c}`;
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
export function expandAggregate(f: IdentifiedFile, schema: FormSchema): ParsedSubmission[] {
  const firstMatrix = schema.blocks.find((b) => b.kind === 'matrix')?.id;
  const json = f.workbook ? readChunkSheet(f.workbook, RECORDS_SHEET, RECORDS_MARK) : null;
  let recs: NormalizedSubmission[] = [];
  try { recs = json ? (JSON.parse(json) as NormalizedSubmission[]) : []; } catch { recs = []; }
  return recs.map((r, i) => {
    const fileId = `${f.file.id}#${i}`;
    const read: ReadResult = {
      fileId, sheetName: '', org: r.org, header: {}, rows: [], excludedRows: [], extraColumns: [], authorNotes: [],
      unreadSheets: [], totalRowChecks: [], infos: [], questions: [], readCount: r.rows.length,
    };
    // 계약의 matrix는 숫자 표 하나. 자유 제작형처럼 여러 개면 우리가 덧붙인 matrixBy를 쓴다
    const by = (r as NormalizedSubmission & { matrixBy?: Record<string, CellValue[][]> }).matrixBy;
    const matrices = by ?? (r.matrix && firstMatrix ? { [firstMatrix]: r.matrix } : undefined);
    return { ...r, ...(matrices ? { matrices } : {}), fileId, file: f, read, sourceFile: `${f.file.fileName} › ${r.sourceFile}`, issues: [], autoFixed: [], fromAggregate: true };
  });
}
