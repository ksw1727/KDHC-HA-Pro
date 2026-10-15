import type { FormSchema } from '@contract/schema';
import { validateSchema } from '@contract/schema';
import { readMeta } from '@contract/metaIO';
import { loadForm, type StoredForm } from '../storage/localForms';

export type OpenResult = { ok: true; entry: StoredForm } | { ok: false; message: string };

/** [양식 파일 불러오기]: .form.json → 양식. 이 브라우저에 같은 양식이 있으면 마지막 내보내기 기록을 이어받는다 */
export function openFormJson(text: string): OpenResult {
  let r: ReturnType<typeof validateSchema>;
  try {
    r = validateSchema(JSON.parse(text));
  } catch {
    return { ok: false, message: '이 파일은 양식 파일이 아니에요.' };
  }
  if (!r.ok) return { ok: false, message: '이 파일은 양식 파일이 아니에요.' };
  return { ok: true, entry: { schema: r.schema, lastExported: loadForm(r.schema.formId)?.lastExported, savedAt: '' } };
}

/** [엑셀에서 양식 되살리기]: 한난MOA로 만든 빈 양식·제출본·취합본 xlsx의 _meta → 양식. 내보낸 파일이므로 그 양식을 마지막 내보내기로 본다 */
export async function openFormXlsx(bytes: ArrayBuffer): Promise<OpenResult> {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(bytes);
  } catch {
    return { ok: false, message: '엑셀 파일을 읽지 못했어요. .xlsx 파일인지 확인해 주세요.' };
  }
  const m = await readMeta(wb);
  if (m.status === 'missing') return { ok: false, message: '한난MOA로 만든 파일이 아니에요.' };
  const r = m.meta ? validateSchema(m.meta.schema) : null;
  if (!r?.ok) return { ok: false, message: '양식 정보가 손상돼 되살릴 수 없어요.' };
  return { ok: true, entry: { schema: r.schema, lastExported: r.schema, savedAt: '' } };
}

/** [복제]: "{이름} (복사)", 새 formId, 버전 1, 내보내기 기록 없음 */
export function duplicateForm(s: FormSchema, now: Date, formId: string): StoredForm {
  const at = now.toISOString();
  return { schema: { ...structuredClone(s), formId, formVersion: 1, title: `${s.title || '양식'} (복사)`, createdAt: at, updatedAt: at }, savedAt: '' };
}

/** 최근 양식 카드의 시각: 오늘이면 "오늘 14:20", 아니면 "10/13" */
export function shortTime(iso: string, now: Date): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return d.toDateString() === now.toDateString() ? `오늘 ${pad(d.getHours())}:${pad(d.getMinutes())}` : `${d.getMonth() + 1}/${pad(d.getDate())}`;
}
