import type { FormSchema } from '@contract/schema';
import { canonicalJSON } from '@contract/checksum';
import { scopedStorageKey } from '../../cloud/runtime';
import { queueForm, reportStorageFailure } from '../../cloud/forms';
import { markRemoved } from './removedForms';

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
  if (!s) { reportStorageFailure(); return false; }
  try {
    const value: StoredForm = { ...entry, savedAt: now.toISOString() };
    s.setItem(scopedStorageKey(PREFIX + entry.schema.formId), JSON.stringify(value));
    s.setItem(scopedStorageKey(CURRENT), entry.schema.formId);
    queueForm(entry.schema.formId, value);
    markRemoved(entry.schema.formId, false);
    // AI로 만들기 화면이 같은 양식 카드를 바로 바꿀 수 있게 (같은 탭이라 storage 이벤트가 오지 않음)
    if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('hanan-moa:form-saved', { detail: value.schema }));
    return true;
  } catch {
    reportStorageFailure();
    return false;
  }
}

export function loadForm(formId: string): StoredForm | null {
  const s = store();
  if (!s) return null;
  try {
    const raw = s.getItem(scopedStorageKey(PREFIX + formId));
    return raw ? (JSON.parse(raw) as StoredForm) : null;
  } catch {
    return null;
  }
}

/** 저장시각(updatedAt)만 빼고 같은 양식인가 */
const sameContent = (a?: FormSchema, b?: FormSchema) => (!a && !b) || (!!a && !!b && canonicalJSON({ ...a, updatedAt: '' }) === canonicalJSON({ ...b, updatedAt: '' }));

/**
 * 이 브라우저에 이미 똑같이 저장돼 있나. 양식을 열기만 하고 고치지 않았으면 다시 저장하지 않는다:
 * 열 때마다 저장하면 서버 버전만 올라가 다른 탭·기기의 수정과 충돌한다.
 */
export function isSavedAsIs(entry: Omit<StoredForm, 'savedAt'>): boolean {
  const s = loadForm(entry.schema.formId);
  return !!s && sameContent(s.schema, entry.schema) && sameContent(s.lastExported, entry.lastExported);
}

export function loadCurrent(): StoredForm | null {
  const s = store();
  try {
    const id = s?.getItem(scopedStorageKey(CURRENT));
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
    const prefix = scopedStorageKey(PREFIX);
    for (let i = 0; i < s.length; i++) {
      const k = s.key(i);
      if (!k?.startsWith(prefix)) continue;
      const v = loadForm(k.slice(prefix.length));
      if (v) out.push(v);
    }
  } catch {
    return out;
  }
  return out.sort((a, b) => b.savedAt.localeCompare(a.savedAt));
}

export function removeForm(formId: string): void {
  try {
    const previous = loadForm(formId);
    store()?.removeItem(scopedStorageKey(PREFIX + formId));
    markRemoved(formId, true);
    queueForm(formId, null, previous ?? undefined);
    // 설정 패널에 열려 있으면 닫게 한다 (열린 채로 고치면 자동 저장으로 되살아난다)
    if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('hanan-moa:form-removed', { detail: { formId } }));
  } catch {
    reportStorageFailure();
  }
}
