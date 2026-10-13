import { fireEvent, render, screen, within } from '@testing-library/react';
import { GeneratorRoot } from '../index';

beforeEach(() => localStorage.clear());

const cell = (name: string) => within(screen.getByRole('grid', { name: '그리는 판' })).getByLabelText(new RegExp(`^${name}( |$)`));

test('자유 제작형: 판에 글자 쓰고 입력 칸 지정 → ③ 이름, 줄 영역 아래로 옮기면 ④에서 고치면 됨', () => {
  render(<><span id="app-header-slot" /><GeneratorRoot /></>);
  fireEvent.click(screen.getByRole('button', { name: '자유 제작형 크게 보기' }));
  fireEvent.click(screen.getByRole('button', { name: '자유 제작형으로 새 양식 만들기 →' }));

  // C1에 "점검일"을 쓰고 D1을 입력 칸으로
  fireEvent.doubleClick(cell('C1'));
  const input = screen.getByLabelText('C1 글자');
  fireEvent.change(input, { target: { value: '점검일' } });
  fireEvent.keyDown(input, { key: 'Enter' });
  fireEvent.mouseDown(cell('D1'));
  fireEvent.mouseUp(cell('D1'));
  fireEvent.click(screen.getByRole('button', { name: /^입력 칸$/ }));
  expect(screen.getByDisplayValue('점검일')).toBeTruthy();   // ③ 고른 영역의 이름

  // 줄 영역(A3:B8) 아래 B9로 옮기면 같은 틀 시트가 "고치면 됨"
  fireEvent.click(screen.getAllByRole('button', { name: '↦ 옮기기' })[0]);
  fireEvent.click(screen.getAllByRole('button', { name: '+ 행' })[0]);
  fireEvent.mouseDown(cell('B9'));
  fireEvent.click(screen.getByRole('button', { name: /취합 방식/ }));
  expect(screen.getByText(/덮어써요/)).toBeTruthy();
  expect(screen.getAllByText(/고칠 것 \d/).length).toBeGreaterThan(0);
});
