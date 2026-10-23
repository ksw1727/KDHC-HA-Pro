import { scopedStorageKey } from '../../cloud/runtime';

/**
 * 지운 양식 표시. AI 대화 카드에는 지운 양식이 남아 있어서, 새로고침 때 패널이 그 양식을 다시 열고
 * 자동 저장으로 되살리지 않게 한다. 같은 양식을 다시 저장하면(파일로 다시 열어 고침 등) 표시를 지운다.
 */
const KEY = 'hanan-moa:removed-forms';

function read(): string[] {
  try {
    const raw = localStorage.getItem(scopedStorageKey(KEY));
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}

export function markRemoved(formId: string, removed: boolean): void {
  try {
    const now = read();
    if (!removed && !now.includes(formId)) return;
    const ids = [...now.filter((id) => id !== formId), ...(removed ? [formId] : [])];
    localStorage.setItem(scopedStorageKey(KEY), JSON.stringify(ids.slice(-200)));
  } catch { /* 표시를 못 남겨도 지우기는 된다 */ }
}

export const isRemoved = (formId: string): boolean => read().includes(formId);
