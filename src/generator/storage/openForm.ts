import { validateSchema } from '@contract/schema';
import { readMeta } from '@contract/metaIO';
import { loadForm, type StoredForm } from './localForms';
import { sameForm } from '../state/versioning';

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
  // 같은 번호를 쓰는 다른 양식의 내보내기 기록은 이어받지 않는다 (버전이 엉뚱하게 오르지 않게)
  const prev = loadForm(r.schema.formId)?.lastExported;
  return { ok: true, entry: { schema: r.schema, lastExported: prev && sameForm(prev, r.schema) ? prev : undefined, savedAt: '' } };
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
