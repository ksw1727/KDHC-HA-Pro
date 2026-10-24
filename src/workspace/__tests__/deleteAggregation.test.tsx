import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { listLocalAggregations, recordAggregation, type AggregationSummary } from '../history';
import { WorkspacePage } from '../WorkspacePage';

beforeEach(() => localStorage.clear());

const summary = (title: string): AggregationSummary => ({
  formId: 'f1', formVersion: 1, title, layout: 'list', unit: '지사', total: 3, got: 3, missing: [], rows: 5, checked: 0, verifyOk: true,
});

test('취합 이력 삭제: 확인 창에서 [삭제]를 눌러야 지워지고, 목록에서 바로 사라진다', async () => {
  recordAggregation(summary('남길 취합'), new Date('2026-10-20T01:00:00Z'));
  recordAggregation(summary('[TEST] 지울 취합'), new Date('2026-10-23T01:00:00Z'));
  render(<WorkspacePage />);
  fireEvent.click(screen.getByRole('tab', { name: /취합 이력/ }));

  fireEvent.click(screen.getByRole('button', { name: '[TEST] 지울 취합 10/23 취합 기록 삭제' }));
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '취소' }));
  expect(listLocalAggregations()).toHaveLength(2);

  fireEvent.click(screen.getByRole('button', { name: '[TEST] 지울 취합 10/23 취합 기록 삭제' }));
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '삭제' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(listLocalAggregations().map((a) => a.title)).toEqual(['남길 취합']);
  expect(screen.queryByText('[TEST] 지울 취합')).toBeNull();
  expect(screen.getByRole('tab', { name: /취합 이력/ }).textContent).toContain('1');
});
