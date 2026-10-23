import ExcelJS from 'exceljs';
import { layoutSheet, type SheetModel } from '@contract/layout';
import { buildMeta, writeMeta } from '@contract/metaIO';
import { kdhcProps, patchXlsx } from '@contract/xlsxPatch';
import { CONTRACT_VERSION } from '@contract/version';
import type { FormSchema } from '@contract/schema';
import type { LoadedFile } from '../pipeline/types';

/**
 * 시험용 회신 파일 만들기 — 취합 파트는 생성 파트 코드를 쓰지 않으므로(03-aggregator.md 머리말),
 * 공통 계약(layoutSheet·metaIO·xlsxPatch)만으로 "양식대로 만든 빈 양식 + 작성자가 채운 값"을 흉내 낸다.
 */
export const NOW = new Date('2026-10-13T05:00:00Z');

export interface MakeOptions {
  orgName?: string;
  shared?: boolean;              // 공용 파일 1개로 받은 것 (제출처명은 작성자가 B4에서 고름, 메타·속성에 없음)
  fill?: (ws: ExcelJS.Worksheet, model: SheetModel) => void;   // 작성자가 한 일
  workbook?: (wb: ExcelJS.Workbook) => void;                   // 시트 추가·이름 바꾸기 등
  dropMeta?: boolean;            // _meta 시트 지우기
  dropProps?: boolean;           // 파일 속성도 없음 (새 파일에 복사한 것처럼)
  tamper?: boolean;              // 메타 JSON을 손으로 고친 것처럼
  unprotected?: boolean;         // 시트 보호 없음
  savedAt?: Date;
}

export async function makeFile(schema: FormSchema, name: string, o: MakeOptions = {}): Promise<LoadedFile> {
  const model = layoutSheet(schema, { mode: 'template', orgName: o.orgName, shared: o.shared }, { today: NOW });
  const wb = new ExcelJS.Workbook();
  wb.created = NOW;
  wb.modified = o.savedAt ?? NOW;
  const ws = wb.addWorksheet(model.sheetName);
  for (const c of model.cells) if (c.value !== undefined && !c.formula) ws.getCell(c.address).value = c.value;
  for (const m of model.merges) ws.mergeCells(m);
  o.fill?.(ws, model);
  if (!o.unprotected) await ws.protect('', {});
  o.workbook?.(wb);
  if (!o.dropMeta) {
    const meta = await buildMeta({
      contractVersion: CONTRACT_VERSION, kind: 'submission', schema, generatedAt: NOW.toISOString(),
      ...(o.orgName ? { orgName: o.orgName } : {}), sheetName: model.sheetName, cellMap: model.cellMap,
    });
    if (o.tamper) meta.schema = { ...meta.schema, title: meta.schema.title + ' (고침)' };
    writeMeta(wb, meta);
  }
  const raw = new Uint8Array(await wb.xlsx.writeBuffer());
  const bytes = o.dropProps ? raw : await patchXlsx(raw, {
    customProps: kdhcProps({ formId: schema.formId, formVersion: schema.formVersion, kind: 'submission', org: o.orgName }),
  });
  return { id: name, fileName: name, bytes, lastModified: NOW.getTime() };
}

/** 열 문자: 목록 블록의 항목 key → 열 (layoutSheet가 정한 자리) */
export function listCol(model: SheetModel, key: string, blockId = 'b1'): string {
  const m = model.cellMap.blocks[blockId];
  if (m?.kind !== 'list') throw new Error('목록 블록이 아니에요');
  return m.columns[key];
}

export function firstRow(model: SheetModel, blockId = 'b1'): number {
  const m = model.cellMap.blocks[blockId];
  if (m?.kind !== 'list') throw new Error('목록 블록이 아니에요');
  return m.firstDataRow;
}
