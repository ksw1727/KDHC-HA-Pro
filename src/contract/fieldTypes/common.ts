import type { DataValidation } from 'exceljs';
import type { Field } from '../schema';

/** 오류·안내 메시지 공통 부분. 오류는 막기(stop), 안내는 help가 있을 때만. */
export function messages(field: Field, rule: string): Pick<DataValidation,
  'showErrorMessage' | 'errorStyle' | 'errorTitle' | 'error' | 'showInputMessage' | 'promptTitle' | 'prompt'> {
  return {
    showErrorMessage: true,
    errorStyle: 'stop',
    errorTitle: '입력 형식 확인',
    error: `${field.label}: ${rule}`,
    ...(field.help ? { showInputMessage: true, promptTitle: field.label, prompt: field.help } : {}),
  };
}

/** 규칙은 없고 안내만 있을 때 쓰는 항상 참인 검사. */
export function promptOnly(field: Field): DataValidation | null {
  if (!field.help) return null;
  return { type: 'custom', allowBlank: true, formulae: ['TRUE'], showInputMessage: true, promptTitle: field.label, prompt: field.help };
}

/** 'today', 'today+30', 'today-7', 'YYYY-MM-DD' → Date (UTC 자정). 해석 불가면 undefined. */
export function resolveDate(spec: string | undefined, today: Date): Date | undefined {
  if (!spec) return undefined;
  const rel = /^today(?:([+-])(\d+))?$/.exec(spec.trim());
  if (rel) {
    const d = new Date(Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()));
    if (rel[1]) d.setUTCDate(d.getUTCDate() + (rel[1] === '+' ? 1 : -1) * Number(rel[2]));
    return d;
  }
  const abs = /^(\d{4})-(\d{2})-(\d{2})$/.exec(spec.trim());
  if (abs) return new Date(Date.UTC(+abs[1], +abs[2] - 1, +abs[3]));
  return undefined;
}

export const fmtKoDate = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;

export const numText = (n: number) => n.toLocaleString('ko-KR');
