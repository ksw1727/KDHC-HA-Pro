import type { Field, FieldType } from '../../contract/schema';

/** 타입별 서식 속성. 타입을 바꾸면 다른 타입의 서식 값은 지운다. */
const FORMAT_PROPS: Record<FieldType, (keyof Field)[]> = {
  text: ['maxLength'],
  number: ['decimals', 'thousands', 'unit', 'min', 'max'],
  date: ['dateFormat', 'minDate', 'maxDate'],
  select: ['options'],
  memo: [],
  pattern: ['pattern'],
  calc: ['formula', 'decimals', 'thousands', 'unit'],
};
const ALL_FORMAT_PROPS = [...new Set(Object.values(FORMAT_PROPS).flat())];

export function typeDefaults(type: FieldType): Partial<Field> {
  switch (type) {
    case 'number': return { thousands: true, decimals: 0 };
    case 'date': return { dateFormat: 'yyyy-mm-dd' };
    case 'select': return { options: [] };
    case 'pattern': return { pattern: 'mobile' };
    case 'calc': return { formula: '', thousands: true, decimals: 0 };
    default: return {};
  }
}

export function newField(key: string, type: FieldType, label: string): Field {
  return { key, label, type, required: false, ...typeDefaults(type) };
}

/** 항목 수정. 타입이 바뀌면 이전 타입의 서식을 지우고 새 타입 기본값을 넣는다. */
export function patchField(field: Field, patch: Partial<Field>): Field {
  const next: Field = { ...field, ...patch, key: field.key };
  if (patch.type && patch.type !== field.type) {
    for (const p of ALL_FORMAT_PROPS) if (!FORMAT_PROPS[patch.type].includes(p)) delete next[p];
    Object.assign(next, typeDefaults(patch.type), pick(patch, FORMAT_PROPS[patch.type]));
  }
  if (next.type === 'calc') next.required = false;
  for (const k of Object.keys(next) as (keyof Field)[]) if (next[k] === undefined) delete next[k];
  return next;
}

function pick(o: Partial<Field>, keys: (keyof Field)[]): Partial<Field> {
  const out: Partial<Field> = {};
  for (const k of keys) if (o[k] !== undefined) (out as Record<string, unknown>)[k] = o[k];
  return out;
}
