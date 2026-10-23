import ExcelJS from 'exceljs';
import type { Field, FormSchema } from '@contract/schema';
import { blockFields } from '@contract/schema';
import { selectNeedsRange } from '@contract/fieldTypes';
import { cellStyle, layoutSheet, BORDER_COLOR, type SheetModel } from '@contract/layout';
import { buildMeta, writeMeta } from '@contract/metaIO';
import { kdhcProps, patchXlsx } from '@contract/xlsxPatch';
import { PROTECT_PASSWORD, CONTRACT_VERSION } from '@contract/version';

const argb = (hex: string) => 'FF' + hex.replace('#', '').toUpperCase();
const LISTS_SHEET = '_lists';

/** SheetModel → 워크시트 (02-generator.md 4절) */
export function fillWorksheet(ws: ExcelJS.Worksheet, model: SheetModel, fieldsByKey: Map<string, Field>, listsSheet: () => ExcelJS.Worksheet) {
  model.columns.forEach((c, i) => { ws.getColumn(i + 1).width = c.width; });

  for (const c of model.cells) {
    const cell = ws.getCell(c.address);
    if (c.formula) cell.value = { formula: c.formula, date1904: false } as ExcelJS.CellFormulaValue;
    else if (c.value !== undefined) cell.value = c.value;
    const st = cellStyle(c.role, c.required, c.mark);
    cell.font = { name: '맑은 고딕', size: st.size ?? 10, bold: st.bold, italic: st.italic, strike: st.strike, color: st.color ? { argb: argb(st.color) } : undefined };
    if (st.fill) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: argb(st.fill) } };
    if (st.border) {
      const side = { style: 'thin' as const, color: { argb: argb(BORDER_COLOR) } };
      cell.border = { top: side, left: side, bottom: side, right: side };
    }
    cell.alignment = { vertical: 'middle', horizontal: st.align, wrapText: c.wrap || undefined };
    if (c.numFmt) cell.numFmt = c.numFmt;
    cell.protection = { locked: st.locked };
    if (c.note) cell.note = c.note;
  }
  for (const m of model.merges) ws.mergeCells(m);

  // 입력 규칙: 선택지가 길거나 쉼표가 있으면 숨김 목록 시트 범위를 참조
  let listCol = 0;
  for (const v of model.validations) {
    let rule = v.rule;
    if (rule.type === 'list') {
      const first = model.cells.find((c) => c.address === v.address.split(':')[0]);
      const field = first?.fieldKey ? fieldsByKey.get(first.fieldKey) : undefined;
      if (field && selectNeedsRange(field)) {
        const ls = listsSheet();
        listCol += 1;
        const opts = field.options ?? [];
        opts.forEach((o, i) => { ls.getCell(i + 1, listCol).value = o; });
        const col = ls.getColumn(listCol).letter;
        rule = { ...rule, formulae: [`'${LISTS_SHEET}'!$${col}$1:$${col}$${Math.max(1, opts.length)}`] };
      }
    }
    // ExcelJS 타입 정의에는 없지만 4.x에 있는 범위 단위 입력 규칙 API
    (ws as unknown as { dataValidations: { add(address: string, v: ExcelJS.DataValidation): void } }).dataValidations.add(v.address, rule);
  }

  if (model.freeze) ws.views = [{ state: 'frozen', ySplit: model.freeze.row, xSplit: 0 }];
  ws.pageSetup = { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, ...(model.printArea ? { printArea: model.printArea } : {}) };
}

type Hash = { algorithmName: string; saltValue: string; spinCount: number; hashValue: string };
type Protected = ExcelJS.Worksheet & { sheetProtection?: Partial<Hash> };
let hashCache: Hash | undefined;
/**
 * 시트 보호. 암호 해시(SHA-512 10만 번)는 브라우저에서 파일마다 1초 넘게 걸려서,
 * 처음 한 번만 계산하고 같은 해시를 다른 파일에도 쓴다 (지사 20곳 zip이 25~30초 걸리던 원인)
 */
async function protect(ws: ExcelJS.Worksheet) {
  const options = {
    selectLockedCells: true, selectUnlockedCells: true, formatCells: false, formatColumns: true, formatRows: true,
    insertRows: false, deleteRows: false, insertColumns: false, deleteColumns: false, sort: false, autoFilter: false,
  };
  const p = ws as Protected;
  if (hashCache) { await ws.protect('', options); Object.assign(p.sheetProtection!, hashCache); return; }
  await ws.protect(PROTECT_PASSWORD, options);
  const { algorithmName, saltValue, spinCount, hashValue } = p.sheetProtection ?? {};
  if (algorithmName && saltValue && spinCount !== undefined && hashValue) hashCache = { algorithmName, saltValue, spinCount, hashValue };
}

export interface WriteOptions {
  orgName?: string;      // preset 모드의 이 파일 지사명
  shared?: boolean;      // preset 모드의 공용 파일 1개 (지사명을 목록에서 고름, 메타·속성에 지사 없음)
  now: Date;
}

/**
 * 빈 양식 xlsx 한 개 (02-generator.md 4절).
 * 통합문서 구조 보호는 넣지 않는다: 작성자가 계산용 시트를 추가할 수 있게 (01-contract.md 4.3, 개발자 2 합의).
 * 시트 모으기형은 시트 잠금·입력 규칙도 없이(셀 합치기를 막지 않음) 메타만 넣는다.
 */
export async function writeWorkbook(schema: FormSchema, opts: WriteOptions): Promise<Uint8Array> {
  const model = layoutSheet(schema, { mode: 'template', orgName: opts.orgName, shared: opts.shared }, { today: opts.now });
  const collect = schema.layout === 'collect';
  const wb = new ExcelJS.Workbook();
  wb.creator = 'KDHC-HA-Pro';
  wb.created = opts.now;
  wb.modified = opts.now;

  const ws = wb.addWorksheet(model.sheetName);
  const fieldsByKey = new Map<string, Field>();
  for (const b of schema.blocks) for (const f of blockFields(b)) fieldsByKey.set(f.key, f);
  let lists: ExcelJS.Worksheet | undefined;
  fillWorksheet(ws, model, fieldsByKey, () => (lists ??= wb.addWorksheet(LISTS_SHEET, { state: 'veryHidden' })));

  if (!collect) await protect(ws);

  const orgName = schema.org.mode === 'preset' && !opts.shared ? opts.orgName : undefined;
  const meta = await buildMeta({
    contractVersion: CONTRACT_VERSION,
    kind: 'submission',
    schema,
    generatedAt: opts.now.toISOString(),
    ...(orgName ? { orgName } : {}),
    sheetName: model.sheetName,
    ...(collect ? {} : { cellMap: model.cellMap }),
  });
  writeMeta(wb, meta);

  const raw = await wb.xlsx.writeBuffer();
  return patchXlsx(raw as ArrayBuffer, {
    customProps: kdhcProps({ formId: schema.formId, formVersion: schema.formVersion, kind: 'submission', org: orgName }),
    lockStructure: false,
  });
}
