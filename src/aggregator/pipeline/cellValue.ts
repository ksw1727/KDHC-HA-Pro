import type ExcelJS from 'exceljs';
import type { FormSchema } from '@contract/schema';

/** 엑셀 칸 값을 다루기 쉬운 모양으로: 서식 글자는 글자로, 수식은 결과 값으로, 오류는 { error } */
export function plainValue(v: ExcelJS.CellValue): unknown {
  if (v === null || v === undefined) return null;
  if (v instanceof Date || typeof v !== 'object') return v;
  if ('richText' in v) return v.richText.map((t) => t.text).join('');
  if ('formula' in v || 'sharedFormula' in v) {
    const r = (v as ExcelJS.CellFormulaValue).result;
    return r === undefined ? null : plainValue(r as ExcelJS.CellValue);
  }
  if ('error' in v) return { error: v.error };
  if ('text' in v) return (v as ExcelJS.CellHyperlinkValue).text;
  return null;
}

export function cellText(v: ExcelJS.CellValue): string {
  const p = plainValue(v);
  if (p === null) return '';
  if (p instanceof Date) return p.toISOString().slice(0, 10);
  if (typeof p === 'object') return String((p as { error: string }).error);
  return String(p);
}

export const isBlank = (p: unknown) => p === null || p === undefined || (typeof p === 'string' && p.trim() === '');

/** 칸 이름 비교용: 앞뒤·사이 공백, 끝의 필수 표시 *, 대소문자를 무시 */
export const normLabel = (s: string) => s.replace(/\*+\s*$/, '').replace(/\s+/g, '').toLowerCase();

/** 셀 메모 글자. 우리가 단 자동 메모([자동]으로 시작하는 줄)는 뺀다 */
export function noteText(note: ExcelJS.Cell['note']): string {
  if (!note) return '';
  const t = typeof note === 'string' ? note : (note.texts ?? []).map((x) => x.text).join('');
  return t.split('\n').filter((l) => !l.startsWith('[자동]')).join('\n').trim();
}

/** 비슷한 칸 이름: 한쪽이 다른 쪽을 품거나, 한 글자만 다름 */
export function similar(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (Math.min(a.length, b.length) >= 2 && (a.includes(b) || b.includes(a))) return true;   // 한 글자 이름은 품기 비교를 하지 않음
  if (Math.abs(a.length - b.length) > 1) return false;
  let diff = 0;
  for (let i = 0, j = 0; i < a.length || j < b.length; ) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++diff > 1) return false;
    if (a.length > b.length) i++; else if (b.length > a.length) j++; else { i++; j++; }
  }
  return true;
}

/** 양식 시트에 보이는 칸 이름들 (양식 시트 찾기·머리글 일치율용). 계산 칸은 뺀다 */
export function formLabels(schema: FormSchema): string[] {
  return schema.blocks.flatMap((b): string[] => {
    switch (b.kind) {
      case 'fields': return b.fields.filter((f) => f.type !== 'calc').map((f) => f.label);
      case 'list': return b.columns.filter((f) => f.type !== 'calc').map((f) => f.label);
      case 'matrix': return [...b.rowLabels, ...b.colLabels];
      case 'grid': return [...b.colLabels, ...b.rows.flat().flatMap((c) => (c.kind === 'fixed' && typeof c.value === 'string' ? [c.value] : []))];
    }
  }).map(normLabel).filter(Boolean);
}
