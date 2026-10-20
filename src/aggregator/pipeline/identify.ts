import ExcelJS from 'exceljs';
import { META_SHEET, readMeta } from '@contract/metaIO';
import { readCustomProps } from '@contract/xlsxPatch';
import type { FormSchema } from '@contract/schema';
import type { BaseForm, IdentifiedFile, LoadedFile } from './types';
import { cellText, formLabels, normLabel, similar } from './cellValue';

/** 03-aggregator.md 3.2 ① 식별 */

const HIDDEN_SHEETS = new Set([META_SHEET, '_records', '_lists']);
const OLE_MAGIC = [0xd0, 0xcf, 0x11, 0xe0];   // 암호 걸린 xlsx와 옛 .xls는 이 머리로 시작한다

function skipped(file: LoadedFile, reason: string): IdentifiedFile {
  return {
    file, source: 'none', kind: 'unknown', savedAt: new Date(file.lastModified).toISOString(),
    contentHash: '', status: 'unreadable', skipReason: reason, notes: [],
  };
}

async function sha256(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** 보이는 시트의 값만으로 만든 해시. 같은 내용을 두 번 넣었는지 알아보는 데 쓴다 */
async function contentHashOf(wb: ExcelJS.Workbook): Promise<string> {
  const parts: string[] = [];
  wb.eachSheet((ws) => {
    if (HIDDEN_SHEETS.has(ws.name) || ws.state !== 'visible') return;
    parts.push(`#${ws.name}`);
    ws.eachRow({ includeEmpty: false }, (row, r) => {
      row.eachCell({ includeEmpty: false }, (cell, c) => { parts.push(`${r},${c}=${cellText(cell.value)}`); });
    });
  });
  return sha256(parts.join('\n'));
}

/** 파일 한 개를 열어 어떤 양식의 파일인지 알아본다 (기준 양식과 비교는 classify에서) */
export async function identifyFile(file: LoadedFile): Promise<IdentifiedFile> {
  const ext = /\.([^.]+)$/.exec(file.fileName)?.[1]?.toLowerCase() ?? '';
  if (ext === 'xls') return skipped(file, '옛날 엑셀(.xls) 형식이에요. 엑셀에서 .xlsx로 다시 저장해서 보내 달라고 해 주세요');
  if (ext !== 'xlsx') return skipped(file, `.${ext || '?'} 파일은 받지 않아요. 엑셀(.xlsx)로 다시 저장해서 보내 달라고 해 주세요`);
  if (OLE_MAGIC.every((b, i) => file.bytes[i] === b)) return skipped(file, '암호가 걸린 파일이에요. 암호를 풀어서 다시 보내 달라고 해 주세요');

  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(file.bytes as unknown as ArrayBuffer);
  } catch {
    return skipped(file, '파일이 깨져서 열 수 없어요. 다시 저장해서 보내 달라고 해 주세요');
  }

  const savedAt = wb.modified instanceof Date && !Number.isNaN(wb.modified.getTime())
    ? wb.modified.toISOString() : new Date(file.lastModified).toISOString();
  const base: IdentifiedFile = {
    file, source: 'none', kind: 'unknown', savedAt, contentHash: await contentHashOf(wb),
    status: 'ok', notes: [], workbook: wb,
  };

  const m = await readMeta(wb);
  if (m.status === 'ok') {
    return {
      ...base, source: 'meta-sheet', kind: m.meta.kind, meta: m.meta,
      formId: m.meta.schema.formId, formVersion: m.meta.schema.formVersion, orgFromFile: m.meta.orgName,
    };
  }
  if (m.status === 'tampered') base.notes.push('숨김 정보가 바뀌어 있어서 믿지 않았어요(메타 변조)');

  const props = await readCustomProps(file.bytes).catch(() => ({} as Record<string, string>));
  if (props['kdhc.formId']) {
    return {
      ...base, source: 'doc-props',
      kind: props['kdhc.kind'] === 'aggregate' ? 'aggregate' : 'submission',
      formId: props['kdhc.formId'], formVersion: Number(props['kdhc.formVersion']) || undefined,
      orgFromFile: props['kdhc.org'] || undefined,
      notes: [...base.notes, m.status === 'missing' ? '숨김 정보 시트가 없어 파일 속성으로 알아봤어요' : '파일 속성으로 알아봤어요'],
    };
  }
  return base;
}

/** 기준 양식: 메타가 있는 파일 중 가장 많은 formId, 그중 가장 높은 버전 (3.2) */
export function chooseBase(files: IdentifiedFile[]): BaseForm | null {
  const withMeta = files.filter((f) => f.status === 'ok' && f.meta);
  if (!withMeta.length) return null;
  const count = new Map<string, number>();
  for (const f of withMeta) count.set(f.formId!, (count.get(f.formId!) ?? 0) + 1);
  const formId = [...count].sort((a, b) => b[1] - a[1])[0][0];
  const best = withMeta.filter((f) => f.formId === formId).sort((a, b) => b.formVersion! - a.formVersion!)[0];
  return { schema: best.meta!.schema, meta: best.meta };
}

/** 머리글 이름 일치율: 메타도 파일 속성도 없는 파일이 기준 양식의 목록 칸 이름을 얼마나 갖고 있나 */
export function headerMatchRatio(wb: ExcelJS.Workbook, schema: FormSchema): number {
  const labels = formLabels(schema);
  if (!labels.length) return 0;
  const seen = new Set<string>();
  wb.eachSheet((ws) => {
    if (HIDDEN_SHEETS.has(ws.name) || ws.state !== 'visible') return;
    ws.eachRow({ includeEmpty: false }, (row) => row.eachCell({ includeEmpty: false }, (c) => { seen.add(normLabel(cellText(c.value))); }));
  });
  // 이름이 똑같거나 비슷하면("수량"과 "수량(개)") 맞은 것으로 센다 — 읽기 단계에서 비슷한 이름은 다시 물어본다
  const seenList = [...seen];
  return labels.filter((l) => seen.has(l) || seenList.some((x) => similar(l, x))).length / labels.length;
}

/** 파일마다 기준 양식과 비교해 상태를 정한다: 다른 양식, 버전 다름, 메타 없음, 내용 같음 */
export function classify(files: IdentifiedFile[], base: BaseForm | null): IdentifiedFile[] {
  const seenHash = new Map<string, string>();
  return files.map((f0) => {
    const f: IdentifiedFile = { ...f0, notes: [...f0.notes] };
    if (f.status !== 'ok') return f;
    if (!base) return { ...f, status: 'unreadable', skipReason: '한난MOA 양식 파일을 찾지 못했어요. 양식 파일(.form.json)을 함께 넣어 주세요' };
    const collect = base.schema.layout === 'collect';

    if (f.formId) {
      if (f.formId !== base.schema.formId) return { ...f, status: 'other-form', skipReason: '다른 양식의 파일이에요' };
      if (f.formVersion && f.formVersion !== base.schema.formVersion)
        f.notes.push(`양식 v${f.formVersion}으로 작성된 파일이에요(지금 v${base.schema.formVersion}). 칸 이름으로 맞춰 읽어요`);
    } else if (collect) {
      return { ...f, status: 'other-form', skipReason: '한난MOA 양식 파일이 아니에요' };
    } else if (f.workbook && headerMatchRatio(f.workbook, base.schema) >= 0.7) {
      f.source = 'header-match';
      f.kind = 'submission';
      const tampered = f.notes.some((n) => n.includes('메타 변조'));
      f.notes.push(tampered ? '그래서 칸 이름으로 알아봤어요' : '숨김 정보가 없어 칸 이름으로 알아봤어요(새 파일에 복사해서 보낸 것 같아요)');
    } else {
      return { ...f, status: 'unreadable', skipReason: '한난MOA 양식 파일이 아니거나 칸 이름이 너무 많이 달라요' };
    }

    const dup = seenHash.get(f.contentHash);
    if (dup) return { ...f, status: 'duplicate-content', skipReason: `"${dup}"와 내용이 완전히 같아요` };
    seenHash.set(f.contentHash, f.file.fileName);
    return f;
  });
}
