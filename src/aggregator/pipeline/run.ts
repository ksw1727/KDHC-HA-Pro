import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { layoutSheet } from '@contract/layout';
import { validateSchema, type FormSchema } from '@contract/schema';
import { kdhcProps, patchXlsx, readCustomProps } from '@contract/xlsxPatch';
import { chooseBase, classify, identifyFile } from './identify';
import { readSubmission } from './read';
import { expandAggregate, parseSubmission } from './parse';
import type { Ctx } from './normalize';
import { fmtTime } from './aggregate';
import type { Resolved } from './resolve';
import type { BaseForm, IdentifiedFile, LoadedFile, ParsedSubmission } from './types';

/** 파이프라인 묶음: 파일 넣기 → ①~④ (결정과 상관없는 부분, 한 번만) */

export interface InputFile { name: string; bytes: Uint8Array; lastModified: number }

/** zip은 풀어서 안의 xlsx만, 양식 JSON(.json)은 따로 (2.1) */
export async function loadInputs(inputs: InputFile[]): Promise<{ files: LoadedFile[]; schemas: FormSchema[]; notes: string[] }> {
  const files: LoadedFile[] = [];
  const schemas: FormSchema[] = [];
  const notes: string[] = [];
  const add = (name: string, bytes: Uint8Array, lastModified: number) => {
    if (files.some((f) => f.fileName === name && f.bytes.length === bytes.length)) return;   // 같은 파일 두 번
    files.push({ id: `${files.length}:${name}`, fileName: name, bytes, lastModified });
  };
  for (const f of inputs) {
    const lower = f.name.toLowerCase();
    if (lower.endsWith('.zip')) {
      try {
        const zip = await JSZip.loadAsync(f.bytes);
        for (const entry of Object.values(zip.files)) {
          const base = entry.name.split('/').pop() ?? '';
          if (entry.dir || entry.name.startsWith('__MACOSX') || base.startsWith('~$') || !/\.(xlsx|xls|csv)$/i.test(base)) continue;
          add(base, await entry.async('uint8array'), entry.date?.getTime() ?? f.lastModified);
        }
      } catch { notes.push(`${f.name}: zip 파일을 풀 수 없어요`); }
    } else if (lower.endsWith('.json')) {
      try {
        const v = validateSchema(JSON.parse(new TextDecoder().decode(f.bytes)));
        if (v.ok) schemas.push(v.schema); else notes.push(`${f.name}: 양식 파일이 아니에요`);
      } catch { notes.push(`${f.name}: 양식 파일을 읽을 수 없어요`); }
    } else if (!f.name.startsWith('~$')) add(f.name, f.bytes, f.lastModified);
  }
  return { files, schemas, notes };
}

export interface Analysis {
  base: BaseForm | null;
  identified: IdentifiedFile[];
  parsed: ParsedSubmission[];
}

/** 메타가 없어도 칸 지도를 쓸 수 있게: 양식으로 빈 양식 배치를 다시 계산 */
function withMap(base: BaseForm, today: Date): BaseForm {
  if (base.meta?.cellMap || base.schema.layout === 'collect') return base;
  const m = layoutSheet(base.schema, { mode: 'template' }, { today });
  return { schema: base.schema, meta: { contractVersion: 1, kind: 'submission', schema: base.schema, generatedAt: '', checksum: '', sheetName: m.sheetName, cellMap: m.cellMap } };
}

export async function analyze(files: LoadedFile[], schemas: FormSchema[], fallback: FormSchema | null, today: Date): Promise<Analysis> {
  const ids = await Promise.all(files.map(identifyFile));
  const json = schemas.at(-1) ?? null;
  let base = chooseBase(ids);
  // 양식 JSON을 넣었거나(우선), 메타 있는 파일이 없으면 양식 만들기에서 넘어온 양식으로
  if (json && (!base || base.schema.formId === json.formId)) base = { schema: json };
  if (!base && fallback) base = { schema: fallback };
  if (base) base = withMap(base, today);
  const identified = classify(ids, base);
  const ctx: Ctx = { year: today.getFullYear(), today };
  const parsed: ParsedSubmission[] = [];
  for (const f of identified) {
    if (f.status !== 'ok' || !base) continue;
    if (f.kind === 'aggregate') { parsed.push(...expandAggregate(f)); continue; }
    parsed.push(parseSubmission(f, readSubmission(f, base), base.schema, ctx));
  }
  return { base, identified, parsed };
}

/** ⑨ 수정된 회신 파일 사본: 직접 수정한 칸(+ 원하면 수정안 칸)을 원본 사본에 고쳐 zip으로 (3.10) */
export async function patchCopies(res: Resolved, files: LoadedFile[], includeProposals: boolean, now: Date, title: string): Promise<{ fileName: string; bytes: Uint8Array; count: number } | null> {
  const fixes = res.valueIssues.filter((i) => i.address && (i.choice === '직접 고침' || (includeProposals && i.choice === '자동으로 고친 값')));
  const byFile = new Map<string, typeof fixes>();
  for (const f of fixes) byFile.set(f.fileId, [...(byFile.get(f.fileId) ?? []), f]);
  const manualFiles = new Set(fixes.filter((f) => f.choice === '직접 고침').map((f) => f.fileId));
  if (!manualFiles.size) return null;

  const zip = new JSZip();
  const day = fmtTime(now.toISOString()).slice(0, 10);
  for (const [fileId, list] of byFile) {
    if (!manualFiles.has(fileId)) continue;
    const src = files.find((f) => f.id === fileId);
    const fin = res.included.find((s) => s.fileId === fileId);
    if (!src || !fin) continue;
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(src.bytes as unknown as ArrayBuffer);
    for (const i of list) {
      const ws = wb.getWorksheet(i.sheet);
      if (!ws || !i.address) continue;
      const cell = ws.getCell(i.address);
      const v = slotValue(fin, i.slot!);
      cell.value = typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(`${v}T00:00:00Z`) : v;
      cell.note = `[자동] 취합 시 수정 (${day}): 원래 값 '${i.raw ?? ''}'`;
    }
    const raw = await wb.xlsx.writeBuffer();
    const props = await readCustomProps(src.bytes).catch(() => ({} as Record<string, string>));
    const bytes = props['kdhc.formId']
      ? await patchXlsx(raw as ArrayBuffer, { customProps: kdhcProps({ formId: props['kdhc.formId'], formVersion: Number(props['kdhc.formVersion']) || 1, kind: 'submission', org: props['kdhc.org'] }) })
      : new Uint8Array(raw as ArrayBuffer);
    zip.file(src.fileName.replace(/\.xlsx$/i, '') + '_수정.xlsx', bytes);
  }
  const safe = title.replace(/[\\/:*?"<>|]/g, '_').trim() || '양식';
  const stamp = fmtTime(now.toISOString()).replace(/[-:]/g, '').replace(' ', '-');
  return { fileName: `${safe}_수정본_${stamp}.zip`, bytes: await zip.generateAsync({ type: 'uint8array' }), count: manualFiles.size };
}

function slotValue(s: Resolved['included'][number], slot: NonNullable<Resolved['valueIssues'][number]['slot']>) {
  switch (slot.part) {
    case 'header': return s.header[slot.key] ?? null;
    case 'grid': return s.grid?.[slot.key] ?? null;
    case 'row': return s.rows.find((r) => r.sourceRow === slot.sourceRow)?.values[slot.key] ?? null;
    case 'spare': return s.gridSpareRows?.find((r) => r.sourceRow === slot.sourceRow)?.values[slot.key] ?? null;
    case 'matrix': return s.matrix?.[slot.r]?.[slot.c] ?? null;
  }
}
