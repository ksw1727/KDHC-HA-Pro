import type { FormSchema } from '@contract/schema';

/** 브라우저에 저장하는 양식 한 건. 실패해도 화면은 계속 동작한다(편의 기능). */
export interface StoredForm {
  schema: FormSchema;
  lastExported?: FormSchema;   // 마지막으로 엑셀을 내보낸 시점의 양식 (버전 판단용)
  savedAt: string;
}

const PREFIX = 'hanan-moa:forms:';
const CURRENT = 'hanan-moa:current';

function store(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

export function saveForm(entry: Omit<StoredForm, 'savedAt'>, now: Date): boolean {
  const s = store();
  if (!s) return false;
  try {
    const value: StoredForm = { ...entry, savedAt: now.toISOString() };
    s.setItem(PREFIX + entry.schema.formId, JSON.stringify(value));
    s.setItem(CURRENT, entry.schema.formId);
    // AI로 만들기 화면이 같은 양식 카드를 바로 바꿀 수 있게 (같은 탭이라 storage 이벤트가 오지 않음)
    if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('hanan-moa:form-saved', { detail: value.schema }));
    return true;
  } catch {
    return false;
  }
}

export function loadForm(formId: string): StoredForm | null {
  const s = store();
  if (!s) return null;
  try {
    const raw = s.getItem(PREFIX + formId);
    return raw ? (JSON.parse(raw) as StoredForm) : null;
  } catch {
    return null;
  }
}

export function loadCurrent(): StoredForm | null {
  const s = store();
  try {
    const id = s?.getItem(CURRENT);
    return id ? loadForm(id) : null;
  } catch {
    return null;
  }
}

export function listForms(): StoredForm[] {
  const s = store();
  if (!s) return [];
  const out: StoredForm[] = [];
  try {
    for (let i = 0; i < s.length; i++) {
      const k = s.key(i);
      if (!k?.startsWith(PREFIX)) continue;
      const v = loadForm(k.slice(PREFIX.length));
      if (v) out.push(v);
    }
  } catch {
    return out;
  }
  return out.sort((a, b) => b.savedAt.localeCompare(a.savedAt));
}

export function removeForm(formId: string): void {
  try {
    store()?.removeItem(PREFIX + formId);
  } catch {
    /* 무시 */
  }
}
