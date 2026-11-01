import { newSchema } from '../state/newSchema';
import { validateForExport } from '../state/validateForExport';
import { instructions } from '../../../server/ai';
import type { Field, FormSchema } from '@contract/schema';

let n = 0;
const mk = (layout: 'list' | 'header-list', labels: string[], org: Partial<FormSchema['org']> = {}): FormSchema => {
  const s = newSchema(layout, new Date('2026-11-01'), { formId: 'org-test', key: () => `f_${(n++).toString(36).padStart(4, '0')}` });
  s.title = '사용자 인입배관 보수지원 현황';
  s.org = { ...s.org, mode: 'preset', orgs: [{ id: 'a', name: '중앙지사' }] as never, ...org };
  const list = s.blocks.find((b) => b.kind === 'list')!;
  if (list.kind === 'list') list.columns = labels.map((label, i) => ({ key: `f_c${i}00`.slice(0, 6), label, type: 'text', required: false } as Field));
  return s;
};
const msgs = (s: FormSchema) => validateForExport(s).map((p) => p.message);

test('제출처 이름 열(지사·지사명·사업소 등)은 고칠 곳으로 알린다: 위쪽 지사명 칸과 취합 자동 칸이 따로 있다', () => {
  for (const label of ['지사', '지사명', ' 지사 · 사업소 ', '사업소명']) {
    const m = msgs(mk('list', ['연번', label, '관경']));
    expect(m.some((x) => x.includes('항목은 지워 주세요') && x.includes("'지사명' 칸"))).toBe(true);
  }
  expect(msgs(mk('list', ['연번', '구분', '관경']))).toEqual([]);
});

test('제출처를 식별하지 않거나(none) 제출처 이름이 다르면(부서) 지사 열은 그대로 둔다', () => {
  expect(msgs(mk('list', ['지사', '관경'], { mode: 'none' })).some((x) => x.includes('항목은 지워'))).toBe(false);
  const dept = mk('list', ['지사', '관경'], { label: '부서' });
  expect(msgs(dept).some((x) => x.includes('"지사" 항목'))).toBe(false);
  expect(msgs(mk('list', ['부서명', '관경'], { label: '부서' })).some((x) => x.includes('"부서명" 항목은 지워'))).toBe(true);
});

test('AI 지시문: 제출처 열을 옮기지 않고, 열 위치는 지금 양식 기준으로 답한다', () => {
  expect(instructions).toContain('제출처 이름은 항목으로 만들지 않는다');
  expect(instructions).toContain('원본 엑셀이 아니라 지금 양식');
});
