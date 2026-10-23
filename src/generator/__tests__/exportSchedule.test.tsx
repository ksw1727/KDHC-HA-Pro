import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { SAMPLE } from '@contract/__tests__/fixtures';
import { BuilderPage } from '../pages/BuilderPage';
import { FormPanel } from '../FormPanel';
import { needsSchedule, quickDeadlines, shortDate } from '../state/schedule';

beforeEach(() => localStorage.clear());

describe('일정 정보 계산', () => {
  const today = new Date(2026, 9, 23);   // 10/23 금
  test('기한이 비었거나 지났으면 묻는다', () => {
    expect(needsSchedule({}, today)).toBe(true);
    expect(needsSchedule({ deadline: '2026-10-22' }, today)).toBe(true);
    expect(needsSchedule({ deadline: '2026-10-23' }, today)).toBe(false);
  });
  test('빠른 버튼: 3일·1주·2주 뒤, 이번 달 말 (말일이면 다음 달 말)', () => {
    expect(quickDeadlines(today).map(([, v]) => v)).toEqual(['2026-10-26', '2026-10-30', '2026-11-06', '2026-10-31']);
    expect(quickDeadlines(new Date(2026, 9, 31))[3][1]).toBe('2026-11-30');
  });
  test('짧은 날짜', () => expect(shortDate('2026-10-30')).toBe('10/30(금)'));
});

const exportFrom = (schema: typeof SAMPLE.list) => {
  render(<><span id="app-header-slot" /><BuilderPage start={{ schema, savedAt: '' }} /></>);
  fireEvent.click(screen.getByRole('button', { name: /^엑셀 내보내기/ }));
  return screen.getByRole('dialog');
};

test('기한이 없으면 ① 일정 정보부터: 빠른 버튼으로 고르면 ② 확인에 그 기한', () => {
  const d = exportFrom({ ...SAMPLE.list, deadline: undefined });
  expect(within(d).getByText(/에 올리려면 제출 기한이 필요해요/)).toBeTruthy();
  const next = within(d).getByRole('button', { name: '다음 →' }) as HTMLButtonElement;
  expect(next.disabled).toBe(true);
  fireEvent.click(within(d).getByRole('button', { name: /^1주 뒤/ }));
  expect(next.disabled).toBe(false);
  fireEvent.click(next);
  const confirm = screen.getByRole('dialog');
  expect(within(confirm).getByText(/^내보내기 \(/)).toBeTruthy();
  expect(within(confirm).getByText(/^\d+\/\d+\(.\)$/)).toBeTruthy();   // 고른 기한
});

test('기한 없이 내보내기: ② 확인에 "기한 없음"', () => {
  const d = exportFrom({ ...SAMPLE.list, deadline: undefined });
  fireEvent.click(within(d).getByRole('button', { name: '기한 없이 내보내기' }));
  expect(within(screen.getByRole('dialog')).getByText('기한 없음')).toBeTruthy();
});

test('지난 기한이면 알리고 다시 고르게', () => {
  const d = exportFrom({ ...SAMPLE.list, deadline: '2020-01-01' });
  expect(within(d).getByRole('alert').textContent).toContain('이미 지났어요');
});

test('기한이 들어 있으면 ①을 건너뛰고 바로 ② 확인', () => {
  const d = exportFrom({ ...SAMPLE.list, deadline: '2999-12-31' });
  expect(within(d).queryByRole('button', { name: '다음 →' })).toBeNull();
  expect(within(d).getByText(/^내보내기 \(/)).toBeTruthy();
});

test('대화 카드의 [엑셀 내보내기] → 패널이 그 양식을 열고 내보내기 창을 띄운다', () => {
  render(<FormPanel />);
  act(() => { window.dispatchEvent(new CustomEvent('hanan-moa:export-form', { detail: { schema: { ...SAMPLE.list, deadline: undefined } } })); });
  expect(within(screen.getByRole('dialog')).getByText(/에 올리려면 제출 기한이 필요해요/)).toBeTruthy();
});
