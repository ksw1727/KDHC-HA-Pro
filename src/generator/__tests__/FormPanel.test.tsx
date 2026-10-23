import { act, fireEvent, render, screen } from '@testing-library/react';
import type { FormSchema } from '@contract/schema';
import { FormPanel } from '../FormPanel';
import { newSchema } from '../state/newSchema';

beforeEach(() => localStorage.clear());

function listen(name: string) {
  const got: unknown[] = [];
  const on = (e: Event) => got.push((e as CustomEvent).detail);
  window.addEventListener(name, on);
  return got;
}

test('열린 양식이 없으면 안내 + 빈 양식 만들기 → 대화에 카드를 붙이라고 알림', () => {
  const opened = listen('hanan-moa:form-opened');
  render(<FormPanel />);
  expect(screen.getByText('열린 양식이 없어요')).toBeTruthy();
  fireEvent.change(screen.getByLabelText('양식 구조'), { target: { value: 'header-list' } });
  fireEvent.click(screen.getByRole('button', { name: '빈 양식 만들기' }));
  expect(opened).toHaveLength(1);
  expect((opened[0] as { schema: FormSchema; how: string }).schema.layout).toBe('header-list');
  // 미리보기 없이 ①~⑤ 설정만
  expect(screen.getByLabelText('양식 설정')).toBeTruthy();
  expect(screen.queryByLabelText('미리보기')).toBeNull();
});

test('대화의 양식을 열고, 고칠 때마다 바로 알림 · 밖에서 항목 고르기', () => {
  const edits = listen('hanan-moa:form-edit');
  const picked = listen('hanan-moa:field-selected');
  const schema = { ...newSchema('list', new Date('2026-10-22'), { formId: 'f-1', key: (() => { let n = 0; return () => `k${++n}`; })() }), title: '교육 명단' };
  render(<FormPanel incoming={{ schema, at: 1 }} />);
  fireEvent.click(screen.getByRole('button', { name: /기본 정보/ }));
  fireEvent.change(screen.getByDisplayValue('교육 명단'), { target: { value: '동절기 교육 명단' } });
  expect((edits.at(-1) as FormSchema).title).toBe('동절기 교육 명단');

  const key = schema.blocks.flatMap((b) => (b.kind === 'list' ? b.columns : []))[0].key;
  act(() => { window.dispatchEvent(new CustomEvent('hanan-moa:select-field', { detail: { key } })); });
  expect(picked.at(-1)).toEqual({ key });
});

test('내 업무공간에서 지운 양식이 패널에 열려 있으면 닫는다 (열린 채로 고치면 자동 저장으로 되살아나므로)', async () => {
  const { saveForm, removeForm, loadForm } = await import('../storage/localForms');
  const schema = { ...newSchema('list', new Date('2026-10-22'), { formId: 'f-del', key: (() => { let n = 0; return () => `k${++n}`; })() }), title: '지울 양식' };
  const other = { ...schema, formId: 'f-other', title: '다른 양식' };
  saveForm({ schema }, new Date());
  const { rerender } = render(<FormPanel incoming={{ schema, at: 1 }} />);
  act(() => removeForm('f-other'));
  expect(screen.queryByText('열린 양식이 없어요')).toBeNull();   // 다른 양식을 지우면 그대로
  act(() => removeForm('f-del'));
  expect(screen.getByText('열린 양식이 없어요')).toBeTruthy();
  await act(() => new Promise((r) => setTimeout(r, 600)));         // 자동 저장 시간이 지나도
  expect(loadForm('f-del')).toBeNull();
  rerender(<FormPanel incoming={{ schema: other, at: 2 }} />);       // 다른 양식은 다시 열린다
  expect(screen.queryByText('열린 양식이 없어요')).toBeNull();
});
