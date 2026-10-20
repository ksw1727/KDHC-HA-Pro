import ExcelJS from 'exceljs';
import { BORDER_COLOR, cellStyle, type SheetModel } from '@contract/layout';
import type { CellValue, NormalizedSubmission } from '@contract/meta';
import { buildMeta, writeChunkSheet, writeMeta } from '@contract/metaIO';
import { kdhcProps, patchXlsx } from '@contract/xlsxPatch';
import { CONTRACT_VERSION } from '@contract/version';
import { availableAggregations, requiredAggregations, type AggregationId } from '@contract/aggregationIds';
import { blockFields, orgLabel, type Field, type FormSchema } from '@contract/schema';
import { FIELD_TYPES } from '@contract/fieldTypes';
import { buildSameFrame, fmtTime, spreadTable, statusTable, type SameFrame, type Table } from './aggregate';
import { RECORDS_MARK, RECORDS_SHEET } from './parse';
import { STATUS_LABEL, type FinalSubmission, type Resolved } from './resolve';
import { verify, type VerifyResult } from './verify';

/** ⑧ 결과 파일 쓰기 (03-aggregator.md 3.9). 결과 파일은 보호하지 않는다 */

const argb = (hex: string) => 'FF' + hex.replace('#', '').toUpperCase();
const FORBIDDEN = /[\\/?*[\]:]/g;

const stamp = (d: Date) => fmtTime(d.toISOString()).replace(/[-:]/g, '').replace(' ', '-');

/** 엑셀 시트 이름 규칙: 31자, 금지 문자 → _, 같은 이름이면 (2) */
export function sheetNamer() {
  const used = new Set<string>();
  return (name: string) => {
    const base = (name.replace(FORBIDDEN, '_').trim() || '시트').slice(0, 31);
    let s = base;
    for (let i = 2; used.has(s.toLowerCase()); i++) s = `${base.slice(0, 31 - `(${i})`.length)}(${i})`;
    used.add(s.toLowerCase());
    return s;
  };
}

/** SheetModel → 워크시트 (빈 양식과 같은 role 스타일. 입력 규칙·보호는 넣지 않음) */
function writeModel(ws: ExcelJS.Worksheet, model: SheetModel, fieldOf: Map<string, Field>) {
  model.columns.forEach((c, i) => { ws.getColumn(i + 1).width = c.width; });
  const side = { style: 'thin' as const, color: { argb: argb(BORDER_COLOR) } };
  // 오른쪽 자동 칸 중 위쪽 정보 항목(점검일 등)은 그 항목의 서식으로: 날짜는 엑셀 날짜로 넣어야 정렬·필터가 된다
  const byLabel = new Map([...fieldOf.values()].map((f) => [f.label.trim(), f]));
  const autoField = new Map<string, Field>();
  for (const c of model.cells) if (c.role === 'auto-header' && typeof c.value === 'string' && byLabel.has(c.value.trim())) autoField.set(c.address.replace(/\d+$/, ''), byLabel.get(c.value.trim())!);
  for (const c of model.cells) {
    const cell = ws.getCell(c.address);
    const af = c.role === 'auto-value' ? autoField.get(c.address.replace(/\d+$/, '')) : undefined;
    cell.value = excelValue(c.value, c.fieldKey ? fieldOf.get(c.fieldKey) : af);
    if (af && !c.numFmt && af.type !== 'calc') c.numFmt = FIELD_TYPES[af.type].excelNumFmt(af);
    else if (af?.type === 'calc' && !c.numFmt) c.numFmt = FIELD_TYPES.calc.excelNumFmt(af);
    const st = cellStyle(c.role, c.required, c.mark);
    cell.font = { name: '맑은 고딕', size: st.size ?? 10, bold: st.bold, italic: st.italic, strike: st.strike, color: st.color ? { argb: argb(st.color) } : undefined };
    if (st.fill) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: argb(st.fill) } };
    if (st.border) cell.border = { top: side, left: side, bottom: side, right: side };
    cell.alignment = { vertical: 'middle', horizontal: st.align, wrapText: c.wrap || undefined };
    if (c.numFmt) cell.numFmt = c.numFmt;
    if (c.note) cell.note = c.note;
  }
  for (const m of model.merges) ws.mergeCells(m);
  if (model.freeze) ws.views = [{ state: 'frozen', ySplit: model.freeze.row, xSplit: 0 }];
  ws.pageSetup = { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, ...(model.printArea ? { printArea: model.printArea } : {}) };
}

/** 날짜 칸은 엑셀 날짜로(연도형은 숫자), 나머지는 그대로 */
function excelValue(v: string | number | undefined | null, field?: Field): ExcelJS.CellValue {
  if (v === undefined || v === null) return null;
  if (field?.type === 'date' && typeof v === 'string') {
    if (/^\d{4}$/.test(v)) return Number(v);
    const m = /^(\d{4})-(\d{2})(?:-(\d{2}))?$/.exec(v);
    if (m) return new Date(Date.UTC(+m[1], +m[2] - 1, m[3] ? +m[3] : 1));
  }
  return v;
}

function writeTable(ws: ExcelJS.Worksheet, t: Table, fieldOf?: Map<string, Field>, keys?: (string | undefined)[]) {
  ws.addRow(t.columns.map((c) => c.header));
  for (const r of t.rows) ws.addRow(r.map((v, i) => excelValue(v, keys?.[i] ? fieldOf?.get(keys[i]!) : undefined)));
  keys?.forEach((k, i) => { const f = k ? fieldOf?.get(k) : undefined; if (f && f.type !== 'text' && f.type !== 'memo') ws.getColumn(i + 1).numFmt = FIELD_TYPES[f.type].excelNumFmt(f) ?? ''; });
  const head = ws.getRow(1);
  head.font = { bold: true };
  head.eachCell((c) => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: argb('#EEF2F7') } }; });
  t.columns.forEach((c, i) => {
    const longest = Math.max(c.header.length * 2, ...t.rows.slice(0, 200).map((r) => String(r[i] ?? '').length * 1.6));
    ws.getColumn(i + 1).width = c.width ?? Math.min(50, Math.max(8, Math.ceil(longest) + 2));
  });
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  if (t.rows.length) ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1 + t.rows.length, column: t.columns.length } };
}

const table = (name: string, headers: string[], rows: CellValue[][]): Table => ({ name, columns: headers.map((header) => ({ header })), rows });
const show = (v: unknown) => (v === null || v === undefined ? '' : v instanceof Date ? v.toISOString().slice(0, 10) : typeof v === 'object' ? JSON.stringify(v) : String(v));

export interface ResultInput {
  schema: FormSchema;
  res: Resolved;
  methods: AggregationId[];
  workbooks: Map<string, ExcelJS.Workbook>;     // fileId → 원본 (시트 모으기용)
  now: Date;
}

export interface ResultFile {
  fileName: string; bytes: Uint8Array; verify: VerifyResult;
  review?: { fileName: string; bytes: Uint8Array };   // 검토 파일 (시트 모으기형이 아닐 때): 출처·상태가 붙은 같은 틀 시트 + 오류·파일목록·검산·판단 기록·메모
}

/** 검토 화면용: 같은 틀 시트를 만들어 검산까지 (내려받기 전) */
export function preview(schema: FormSchema, res: Resolved, now: Date): { frame?: SameFrame; verify: VerifyResult } {
  if (schema.layout === 'collect') return { verify: verify(schema, res) };
  const frame = buildSameFrame(schema, res, '', now);
  return { frame, verify: verify(schema, res, frame.model) };
}

const newBook = (now: Date) => {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'KDHC-HA-Pro';
  wb.created = now;
  wb.modified = now;
  return wb;
};

/**
 * 취합 결과. 시트 모으기형이 아니면 파일 두 개:
 * - 결과 파일: 같은 틀 시트(자동 칸은 제출처만, 값만) + 고른 방식(펼치기·제출 현황) + 다시 취합용 숨김 시트
 * - 검토 파일: 같은 틀 시트(출처 파일·원본 줄·상태, 표시·메모) + 오류·파일목록·검산·판단 기록·메모·추가 칸
 * 시트 모으기형은 지금처럼 한 파일(목차·제출처별 시트·제출 현황·파일목록·판단 기록).
 */
export async function writeResult({ schema, res, methods, workbooks, now }: ResultInput): Promise<ResultFile> {
  const wb = newBook(now);
  const name = sheetNamer();
  const fieldOf = new Map<string, Field>();
  for (const b of schema.blocks) for (const f of blockFields(b)) fieldOf.set(f.key, f);
  const allowed = availableAggregations(schema);
  const chosen = [...new Set([...requiredAggregations(schema), ...methods])].filter((m) => allowed.includes(m));
  const collect = schema.layout === 'collect';
  const title = schema.title.replace(/[\\/:*?"<>|]/g, '_').trim() || '양식';
  const day = fmtTime(now.toISOString()).slice(0, 10);
  let vr: VerifyResult;
  let review: ResultFile['review'];

  if (collect) {
    vr = verify(schema, res);
    writeCollectSheets(wb, schema, res, workbooks, name, now, true);
    if (chosen.includes('submission-status') && schema.org.mode !== 'none') writeTable(wb.addWorksheet(name('제출 현황')), statusTable(schema, res));
    writeReviewSheets(wb, name, schema, res, vr, fieldOf);
  } else {
    // 검산은 출처가 다 붙은 같은 틀 시트로 한다
    const first = buildSameFrame(schema, res, '', now);
    vr = verify(schema, res, first.model);

    // 결과 파일: 값만
    const who = schema.org.mode === 'none' ? `파일 ${res.included.length}개` : `${orgLabel(schema)} ${res.included.length}곳${res.missingOrgs.length ? ` (미제출 ${res.missingOrgs.length}곳)` : ''}`;
    const clean = buildSameFrame(schema, res, `취합일 ${day} · ${who}`, now, true);
    writeModel(wb.addWorksheet(name(clean.model.sheetName)), clean.model, fieldOf);
    if (chosen.includes('spread')) {
      const t = spreadTable(schema, res);
      const byLabel = new Map([...fieldOf.values()].map((f) => [f.label.trim(), f.key]));
      writeTable(wb.addWorksheet(name(t.name)), t, fieldOf, t.columns.map((c) => byLabel.get(c.header.trim())));
    }
    if (chosen.includes('submission-status') && schema.org.mode !== 'none') writeTable(wb.addWorksheet(name('제출 현황')), statusTable(schema, res));

    // 검토 파일
    const rb = newBook(now);
    const rname = sheetNamer();
    const errors = res.valueIssues.filter((i) => i.choice === '적혀 있던 값 그대로').length + res.crossIssues.length;
    const frame = buildSameFrame(schema, res, `취합일 ${day} · 파일 ${res.included.length}개 · 오류 ${errors} · 검산 ${vr.ok ? '일치' : '불일치'}`, now);
    const ws = rb.addWorksheet(rname(frame.model.sheetName));
    writeModel(ws, frame.model, fieldOf);
    copyAuthorNotes(ws, schema, res, frame);
    writeReviewSheets(rb, rname, schema, res, vr, fieldOf);
    review = { fileName: `${title}_검토_${stamp(now)}.xlsx`, bytes: new Uint8Array(await rb.xlsx.writeBuffer()) };
  }

  // _records (다시 취합용 원자료), _meta
  const records: NormalizedSubmission[] = collect ? [] : res.included.map((s) => ({
    ...(s.org ? { org: s.org } : {}), sourceFile: s.sourceFile, savedAt: s.savedAt, header: s.header, rows: s.rows,
    ...matrixRecord(schema, s.matrices), ...(s.grid ? { grid: s.grid } : {}), ...(s.gridSpareRows ? { gridSpareRows: s.gridSpareRows } : {}),
  }));
  writeChunkSheet(wb, RECORDS_SHEET, RECORDS_MARK, JSON.stringify(records));
  writeMeta(wb, await buildMeta({
    contractVersion: CONTRACT_VERSION, kind: 'aggregate', schema, generatedAt: now.toISOString(),
    aggregate: { includedSources: res.included.map((s) => ({ ...(s.org ? { org: s.org } : {}), sourceFile: s.sourceFile, savedAt: s.savedAt })), methods: chosen, recordsSheet: '_records' },
  }));

  const raw = await wb.xlsx.writeBuffer();
  const bytes = await patchXlsx(raw as ArrayBuffer, { customProps: kdhcProps({ formId: schema.formId, formVersion: schema.formVersion, kind: 'aggregate' }) });
  return { fileName: `${title}_취합_${stamp(now)}.xlsx`, bytes, verify: vr, ...(review ? { review } : {}) };
}

/** 오류 · 파일목록 · 검산 · 판단 기록 · 메모 · 추가 칸 */
function writeReviewSheets(wb: ExcelJS.Workbook, name: (s: string) => string, schema: FormSchema, res: Resolved, vr: VerifyResult, fieldOf: Map<string, Field>) {
  const collect = schema.layout === 'collect';
  const lbl = orgLabel(schema);
  const labelOf = (fileId: string) => res.files.find((f) => f.fileId === fileId)?.label ?? '';
  const nameOf = (fileId: string) => res.files.find((f) => f.fileId === fileId)?.fileName ?? '';
  const infoIssues = res.included.flatMap((s) => s.issues.filter((i) => i.severity === 'info'));
  const errRows: CellValue[][] = [
    ...res.valueIssues.map((i) => [labelOf(i.fileId), nameOf(i.fileId), i.location, i.fieldLabel ?? '', show(i.raw), i.message, i.choice]),
    ...res.crossIssues.map((i) => { const f = res.included.find((x) => x.fileId === i.fileId); return [f?.label ?? '(전체)', f?.sourceFile ?? '', i.location, i.fieldLabel ?? '', '', i.message, '그대로']; }),
    ...infoIssues.map((i) => [labelOf(i.fileId), nameOf(i.fileId), i.location, '', '', i.message, '자동']),
  ];
  if (!collect || errRows.length) writeTable(wb.addWorksheet(name('오류')), table('오류', [lbl, '파일명', '위치', '항목', '입력값', '내용', '처리'], errRows));

  writeTable(wb.addWorksheet(name('파일목록')), fileListTable(schema, res));
  if (!collect) writeTable(wb.addWorksheet(name('검산')), table('검산', ['검사', '내용', '결과'], vr.lines.map((l) => [l.check, l.detail, l.ok ? '일치' : '불일치'])));
  writeTable(wb.addWorksheet(name('판단 기록')), table('판단 기록', ['항목', '대상', '결정', '기본값 적용'], res.log.map((l) => [l.what, l.target, l.choice, l.defaulted ? '예' : ''])));

  if (!collect) {
    const notes = res.included.flatMap((s) => s.read.authorNotes.map((n) => [s.label, s.sourceFile, n.address, n.fieldKey ? fieldOf.get(n.fieldKey)?.label ?? '' : '', n.sourceRow ?? null, n.text]));
    if (notes.length) writeTable(wb.addWorksheet(name('메모')), table('메모', [lbl, '파일명', '위치', '항목', '원본 줄', '메모 내용'], notes));
    const extra = res.included.flatMap((s) => [...s.read.extraColumns.filter((e) => !s.droppedExtra.includes(e.header)), ...s.extraFromAlias].flatMap((e) => e.values.map((v) => [s.label, s.sourceFile, v.sourceRow, e.header, show(v.value)])));
    if (extra.length) writeTable(wb.addWorksheet(name('추가 칸')), table('추가 칸', [lbl, '파일명', '원본 줄', '칸 이름', '값'], extra));
  }
}

/** 작성자가 단 엑셀 메모를 같은 틀 시트의 같은 칸에 옮긴다 (우리 [자동] 메모가 있으면 그 위에) */
function copyAuthorNotes(ws: ExcelJS.Worksheet, schema: FormSchema, res: Resolved, frame: SameFrame) {
  const add = (address: string, text: string) => {
    const cell = ws.getCell(address);
    const old = typeof cell.note === 'string' ? cell.note : '';
    cell.note = old ? `${text}\n${old}` : text;
  };
  const byFile = new Map(res.included.map((s) => [s.fileId, s]));
  for (const b of schema.blocks) {
    const m = frame.model.cellMap.blocks[b.id];
    if (b.kind === 'list' && m?.kind === 'list') {
      frame.rowRefs.forEach((ref, i) => {
        for (const n of byFile.get(ref.fileId)?.read.authorNotes ?? []) {
          if (n.sourceRow === ref.sourceRow && n.fieldKey && m.columns[n.fieldKey]) add(`${m.columns[n.fieldKey]}${m.firstDataRow + i}`, `${byFile.get(ref.fileId)!.label}: ${n.text}`);
        }
      });
    }
    if (b.kind === 'matrix' && m?.kind === 'matrix') {
      m.cells.forEach((row, r) => row.forEach((a, c) => { const t = frame.matrixNotes[`${b.id}:${r}:${c}`]; if (t) add(a, t); }));
      for (const s of res.included) for (const n of s.read.authorNotes) {
        const at = s.read.matrices?.[b.id]?.flatMap((row, r) => row.map((cell, c) => ({ cell, r, c }))).find((x) => x.cell?.address === n.address);
        if (at) add(m.cells[at.r][at.c], `${s.label}: ${n.text}`);
      }
    }
    if (b.kind === 'grid' && m?.kind === 'grid') {
      for (const s of res.included) for (const n of s.read.authorNotes) {
        if (n.sourceRow === undefined && n.fieldKey && m.inputCells[n.fieldKey]) add(m.inputCells[n.fieldKey], `${s.label}: ${n.text}`);
      }
      frame.spareRefs.forEach((ref, i) => {
        for (const n of byFile.get(ref.fileId)?.read.authorNotes ?? []) {
          const col = n.fieldKey ? (b.spareColumns ?? []).findIndex((f) => f.key === n.fieldKey) : -1;
          if (n.sourceRow === ref.sourceRow && col >= 0 && m.spare) add(`${m.columns[col]}${m.spare.firstRow + i}`, `${byFile.get(ref.fileId)!.label}: ${n.text}`);
        }
      });
    }
  }
}

function fileListTable(schema: FormSchema, res: Resolved): Table {
  const rows: CellValue[][] = res.files.map((f) => {
    const s = res.included.find((x) => x.fileId === f.fileId);
    const r = f.parsed?.read;
    const count = (reason: string) => (r?.excludedRows.filter((e) => e.reason === reason).length ?? 0) + (s?.removedRows.filter((e) => e.reason === reason).length ?? 0);
    const kept = s ? s.rows.length + (s.gridSpareRows?.length ?? 0) : null;
    const listy = schema.blocks.some((b) => b.kind === 'list');
    return [
      f.label, f.fileName, f.status === 'included' && kept === 0 && listy ? '제출 · 해당 없음' : STATUS_LABEL[f.status], f.reason ?? '', fmtTime(f.savedAt),
      r?.readCount ?? null, kept, count('blank') || null, count('example') || null, count('total') || null, count('operator') || null, count('duplicate') || null, count('hidden') || null,
      [...(r?.unreadSheets ?? [])].join(', '), r?.collectSheets?.join(', ') ?? '', [...(f.parsed?.file.notes ?? [])].join(' / '),
    ];
  });
  for (const o of res.missingOrgs) rows.push([o, '', '미제출', '', '', null, null, null, null, null, null, null, null, '', '', '']);
  return table('파일목록', [orgLabel(schema), '파일명', '상태', '사유', '저장 시각', '읽은 줄', '반영 줄', '빈 줄', '예시 줄', '합계 줄', '운영자 제외', '중복 줄', '숨긴 줄 제외', '읽지 않은 시트', '모은 시트', '알림'], rows);
}

/** 시트 모으기: 원본 시트를 값·서식·합친 셀·열 너비·줄 높이 그대로 복사. collect 양식이면 맨 앞에 목차 */
function writeCollectSheets(wb: ExcelJS.Workbook, schema: FormSchema, res: Resolved, workbooks: Map<string, ExcelJS.Workbook>, name: (s: string) => string, now: Date, withToc: boolean) {
  const toc = withToc ? wb.addWorksheet(name('목차')) : undefined;
  const entries: { s: FinalSubmission; sheets: string[] }[] = [];
  for (const s of res.included) {
    const src = workbooks.get(s.file.file.id);
    if (!src) continue;
    const want = s.read.collectSheets ?? [s.read.sheetName];
    const made: string[] = [];
    want.forEach((sheetName, i) => {
      const from = src.getWorksheet(sheetName);
      if (!from) return;
      const to = wb.addWorksheet(name(i === 0 ? s.label : `${s.label}_${sheetName}`));
      copySheet(from, to);
      to.getCell('A1').note = `[자동] 원본: ${s.sourceFile} · 저장 ${fmtTime(s.savedAt)}`;
      made.push(to.name);
    });
    entries.push({ s, sheets: made });
  }
  if (!toc) return;
  const lbl = schema.org.mode !== 'none' ? orgLabel(schema) : '번호';
  toc.getCell('A1').value = schema.title;
  toc.getCell('A1').font = { bold: true, size: 14 };
  toc.getCell('A2').value = `취합일 ${fmtTime(now.toISOString()).slice(0, 10)} · 파일 ${res.included.length}개 · 미제출 ${res.missingOrgs.length}`;
  const head = toc.getRow(4);
  head.values = [lbl, '상태', '원본 파일', '저장 시각', '모은 시트', '바로가기'];
  head.font = { bold: true };
  let r = 5;
  entries.forEach(({ s, sheets }, i) => {
    toc.getRow(r).values = [schema.org.mode !== 'none' ? s.label : i + 1, '제출', s.sourceFile, fmtTime(s.savedAt), sheets.join(', ')];
    if (sheets[0]) toc.getCell(r, 6).value = { text: '열기', hyperlink: `#'${sheets[0].replace(/'/g, "''")}'!A1` };
    r++;
  });
  for (const f of res.files.filter((x) => x.status !== 'included')) toc.getRow(r++).values = [f.label, '제외', f.fileName, fmtTime(f.savedAt), '', ''];
  for (const o of res.missingOrgs) toc.getRow(r++).values = [o, '미제출'];
  [12, 8, 30, 18, 24, 10].forEach((w, i) => { toc.getColumn(i + 1).width = w; });
}

export function copySheet(from: ExcelJS.Worksheet, to: ExcelJS.Worksheet) {
  from.columns?.forEach((c, i) => { if (c.width) to.getColumn(i + 1).width = c.width; });
  from.eachRow({ includeEmpty: true }, (row, r) => {
    const t = to.getRow(r);
    if (row.height) t.height = row.height;
    row.eachCell({ includeEmpty: true }, (cell, c) => {
      const d = t.getCell(c);
      const v = cell.value;
      // 수식은 결과 값으로 (다른 시트를 가리키는 수식이 깨지지 않게)
      d.value = v && typeof v === 'object' && ('formula' in v || 'sharedFormula' in v) ? ((v as ExcelJS.CellFormulaValue).result ?? null) as ExcelJS.CellValue : v;
      d.style = JSON.parse(JSON.stringify(cell.style ?? {}));
      if (cell.note) d.note = cell.note;
    });
  });
  for (const m of (from.model as { merges?: string[] }).merges ?? []) {
    try { to.mergeCells(m); } catch { /* 겹치는 병합은 건너뜀 */ }
  }
}


/** _records의 숫자 표: 계약대로 첫 표는 matrix에. 표가 여러 개면(자유 제작형) 전부를 matrixBy에도 (계약 보완 제안 중) */
function matrixRecord(schema: FormSchema, matrices?: Record<string, CellValue[][]>) {
  if (!matrices) return {};
  const ids = schema.blocks.filter((b) => b.kind === 'matrix').map((b) => b.id);
  const first = ids[0] ? matrices[ids[0]] : undefined;
  return { ...(first ? { matrix: first } : {}), ...(ids.length > 1 ? { matrixBy: matrices } : {}) };
}
