import { fireEvent, render, screen, within } from '@testing-library/react';
import { SAMPLE } from '@contract/__tests__/fixtures';
import { listForms, saveForm } from '@gen/storage/localForms';
import { WorkspacePage } from '../WorkspacePage';

beforeEach(() => localStorage.clear());

test('내 양식 삭제: 확인 창에서 [삭제]를 눌러야 지워지고, 목록에서 바로 사라진다', () => {
  const now = new Date();
  saveForm({ schema: { ...structuredClone(SAMPLE.list), formId: 'keep', title: '남길 양식' } }, now);
  saveForm({ schema: { ...structuredClone(SAMPLE.list), formId: 'gone', title: '[TEST] 지울 양식' } }, now);
  render(<WorkspacePage />);

  fireEvent.click(screen.getByRole('button', { name: '[TEST] 지울 양식 삭제' }));
  const dlg = screen.getByRole('dialog');
  fireEvent.click(within(dlg).getByRole('button', { name: '취소' }));
  expect(listForms()).toHaveLength(2);

  fireEvent.click(screen.getByRole('button', { name: '[TEST] 지울 양식 삭제' }));
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '삭제' }));
  expect(listForms().map((f) => f.schema.formId)).toEqual(['keep']);
  expect(screen.queryByText('[TEST] 지울 양식')).toBeNull();
  expect(screen.getAllByText('남길 양식').length).toBeGreaterThan(0);
});

test('취합 기다리는 양식 카드의 [삭제]: 확인 창을 거쳐 양식을 지우고 기다리는 목록·달력에서 바로 사라진다', () => {
  const now = new Date();
  const s = { ...structuredClone(SAMPLE.list), formId: 'wait', title: '[TEST] 기다리는 양식', createdAt: now.toISOString() };
  saveForm({ schema: s, lastExported: s }, now);
  render(<WorkspacePage />);
  fireEvent.click(screen.getByRole('button', { name: '취합 기다리는 양식 [TEST] 기다리는 양식 삭제' }));
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '삭제' }));
  expect(listForms()).toHaveLength(0);
  expect(screen.queryByText('[TEST] 기다리는 양식')).toBeNull();
  expect(screen.getByText(/기다리는 양식이 없어요/)).toBeTruthy();
});
