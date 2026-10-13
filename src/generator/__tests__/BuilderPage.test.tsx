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

test('시트 모으기형: 제작한 양식으로 보내기 → 표 그리기, 미리보기 4행부터 반영', () => {
  render(<BuilderPage />);
  fireEvent.click(screen.getByRole('button', { name: /양식 구조/ }));
  fireEvent.click(screen.getByRole('radio', { name: /시트 모으기형/ }));
  fireEvent.click(screen.getByRole('button', { name: /시트 모으기형으로 바꾸기/ }));
  fireEvent.click(screen.getByRole('button', { name: /시트 시작 모양/ }));
  fireEvent.click(screen.getByRole('radio', { name: '제작한 양식으로 보내기' }));
  fireEvent.change(screen.getByLabelText('2행 1열'), { target: { value: '소화기' } });
  const grid = screen.getByRole('grid', { name: '엑셀 미리보기' });
  expect(within(grid).getByText('항목')).toBeTruthy();
  expect(within(grid).getByText('소화기')).toBeTruthy();
  expect(screen.queryByText(/붙여넣으세요/)).toBeNull();
});

test('② 양식 구조: 지금 구조의 미리보기 애니메이션, 올려 둔 구조로 바뀜', () => {
  render(<BuilderPage />);
  fireEvent.click(screen.getByRole('button', { name: /양식 구조/ }));
  expect(screen.getByLabelText('구조 미리보기 애니메이션')).toBeTruthy();
  expect(screen.getByText('지금 구조')).toBeTruthy();
  fireEvent.mouseEnter(screen.getByRole('radio', { name: /빈칸채우기형/ }));
  expect(screen.getByText('미리 보기 · 누르면 바뀌어요')).toBeTruthy();
});

test('목록에 계산 칸 추가: 칸 이름 버튼으로 계산식을 만들고 미리보기에 수식이 보인다', () => {
  render(<BuilderPage />);
  const addButtons = screen.getAllByText('+ 항목 추가');
  fireEvent.click(addButtons[1]);
  fireEvent.click(screen.getByRole('button', { name: '숫자' }));
  fireEvent.change(screen.getByDisplayValue('항목 2'), { target: { value: '수량' } });
  fireEvent.click(screen.getAllByText('+ 항목 추가')[1]);
  fireEvent.click(screen.getByRole('button', { name: '계산' }));
  const group = screen.getByRole('group', { name: '칸 이름' });
  fireEvent.click(within(group).getByRole('button', { name: '수량' }));
  fireEvent.click(within(screen.getByRole('group', { name: '연산' })).getByRole('button', { name: '×' }));
  fireEvent.change(screen.getByLabelText('넣을 숫자나 글자'), { target: { value: '2' } });
  fireEvent.click(screen.getByRole('button', { name: '넣기' }));
  expect((screen.getByLabelText('계산식') as HTMLInputElement).value).toBe('[수량] × 2');
  expect(screen.getByText(/예시\(.*\)로 계산하면/)).toBeTruthy();
  const grid = screen.getByRole('grid', { name: '엑셀 미리보기' });
  expect(within(grid).getAllByText('= [수량] × 2').length).toBeGreaterThan(0);
});
