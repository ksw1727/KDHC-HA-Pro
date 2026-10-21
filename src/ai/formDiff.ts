import { LAYOUT_LABELS, blockFields, orgLabel, type Field, type FormSchema } from '@contract/schema';
import { FIELD_TYPES } from '@contract/fieldTypes';

const names = (xs: string[], max = 5) => (xs.length > max ? `${xs.slice(0, max).join(', ')} 외 ${xs.length - max}곳` : xs.join(', '));
const MODE: Record<FormSchema['org']['mode'], string> = { preset: '목록 있음', input: '이름 직접 입력', none: '식별 안 함' };

/**
 * AI가 만든 양식(before)과 빌더에서 고친 양식(after)의 차이를 사람이 읽는 문장으로.
 * AI 화면에서 카드 아래에 보여 주고, 다음 말과 함께 AI에게도 넘긴다.
 */
export function describeChanges(before: FormSchema, after: FormSchema): string[] {
  const out: string[] = [];
  if (before.title !== after.title) out.push(`제목: "${before.title}" → "${after.title}"`);
  if (before.layout !== after.layout) out.push(`구조: ${LAYOUT_LABELS[before.layout]} → ${LAYOUT_LABELS[after.layout]}`);
  for (const [k, label] of [['guide', '작성 안내'], ['deadline', '제출 기한'], ['contact', '문의처']] as const) {
    if ((before[k] ?? '') !== (after[k] ?? '')) out.push(after[k] ? `${label}: ${after[k]}` : `${label} 지움`);
  }

  // 제출처
  const L = orgLabel(after);
  if (orgLabel(before) !== L) out.push(`제출처를 부르는 말: ${orgLabel(before)} → ${L}`);
  if (before.org.mode !== after.org.mode) out.push(`제출처 방식: ${MODE[before.org.mode]} → ${MODE[after.org.mode]}`);
  const bo = before.org.orgs ?? [], ao = after.org.orgs ?? [];
  const added = ao.filter((o) => !bo.includes(o)), removed = bo.filter((o) => !ao.includes(o));
  if (added.length || removed.length) {
    out.push(`${L} ${bo.length}곳 → ${ao.length}곳${added.length ? ` (추가: ${names(added)})` : ''}${removed.length ? ` (뺌: ${names(removed)})` : ''}`);
  }

  // 항목 (key로 같은 항목을 찾는다)
  const fields = (s: FormSchema) => new Map(s.blocks.flatMap((b) => blockFields(b)).map((f) => [f.key, f] as const));
  const bf = fields(before), af = fields(after);
  const newF = [...af.values()].filter((f) => !bf.has(f.key)).map((f) => f.label);
  const goneF = [...bf.values()].filter((f) => !af.has(f.key)).map((f) => f.label);
  if (newF.length) out.push(`항목 추가: ${names(newF, 8)}`);
  if (goneF.length) out.push(`항목 뺌: ${names(goneF, 8)}`);
  for (const [k, a] of af) {
    const b = bf.get(k);
    if (!b) continue;
    const what: string[] = [];
    if (b.type !== a.type) what.push(`타입 ${FIELD_TYPES[b.type].label} → ${FIELD_TYPES[a.type].label}`);
    if (b.required !== a.required) what.push(a.required ? '필수로' : '필수 아님으로');
    if (JSON.stringify(b.options ?? []) !== JSON.stringify(a.options ?? [])) what.push(`선택지 ${(a.options ?? []).join('·')}`);
    const fmt = (f: Field) => JSON.stringify([f.unit, f.decimals, f.thousands, f.min, f.max, f.dateFormat, f.minDate, f.maxDate, f.pattern, f.maxLength, f.formula, f.help, f.owner]);
    if (!what.length && fmt(b) !== fmt(a)) what.push('서식');
    const renamed = b.label !== a.label;
    if (renamed || what.length) out.push(`${renamed ? `${b.label} → ${a.label}` : a.label}${what.length ? `: ${what.join(', ')}` : ''}`);
  }
  // 순서만 바뀐 경우
  const order = (m: Map<string, Field>) => [...m.keys()].filter((k) => bf.has(k) && af.has(k)).join(',');
  if (!newF.length && !goneF.length && order(bf) !== order(af)) out.push('항목 순서를 바꿨어요');

  if (!out.length && JSON.stringify({ ...before, updatedAt: '' }) !== JSON.stringify({ ...after, updatedAt: '' })) out.push('그 밖의 설정을 바꿨어요 (표 모양·취합 방식 등)');
  return out;
}
