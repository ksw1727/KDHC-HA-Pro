import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { BuilderPage } from '../pages/BuilderPage';

beforeEach(() => localStorage.clear());

test('빌더가 뜨고, 미리보기 머리글을 누르면 왼쪽 항목 편집이 열린다', () => {
  render(<BuilderPage />);
  const grid = screen.getByRole('grid', { name: '엑셀 미리보기' });
  // 기본 양식(혼합형)의 목록 머리글 "이름 *"
  const header = within(grid).getByText('이름 *');
  fireEvent.click(header);
  expect(screen.getByDisplayValue('이름')).toBeTruthy(); // 항목 편집 칸의 이름 입력
});

test('항목을 추가하면 미리보기에 바로 나온다', () => {
  render(<BuilderPage />);
  const addButtons = screen.getAllByText('+ 항목 추가');
  fireEvent.click(addButtons[1]);
  fireEvent.click(screen.getByRole('button', { name: '숫자' }));
  const grid = screen.getByRole('grid', { name: '엑셀 미리보기' });
  expect(within(grid).getByText('항목 2')).toBeTruthy();
});

test('[엑셀 내보내기]를 누르면 검사 창: 제목·지사 목록이 비어 있음', () => {
  render(<><span id="app-header-slot" /><BuilderPage /></>);
  act(() => fireEvent.click(screen.getByRole('button', { name: /엑셀 내보내기/ })));
  const dialog = screen.getByRole('dialog');
  expect(within(dialog).getByText('제목을 입력해 주세요.')).toBeTruthy();
  expect(within(dialog).getByText(/지사 목록이 비어 있어요/)).toBeTruthy();
});
