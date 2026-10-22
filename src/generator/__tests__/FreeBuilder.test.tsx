import { fireEvent, render, screen, within } from '@testing-library/react';
import { BuilderPage } from '../pages/BuilderPage';
import { newSchema, randomFormId, randomKey } from '../state/newSchema';

beforeEach(() => localStorage.clear());

const renderFree = () => render(<><span id="app-header-slot" /><BuilderPage start={{ schema: newSchema('free', new Date(), { formId: randomFormId(), key: randomKey }), savedAt: '' }} /></>);

const cell = (name: string) => within(screen.getByRole('grid', { name: '그리는 판' })).getByLabelText(new RegExp(`^${name}( 입력| 숫자|$)`));

test('자유 제작형: 영역 칸에서 타자 치면 막고 안내', () => {
  renderFree();
  fireEvent.mouseDown(cell('B6'));
  fireEvent.change(screen.getByLabelText('B6 글자'), { target: { value: 'ㄱ' } });
  expect(screen.getByRole('status').textContent).toContain('왼쪽 ③에서 고쳐요');
});

test('자유 제작형: 판에 글자 쓰고 입력 칸 지정 → ③ 이름, 줄 영역 아래로 옮기면 ④에서 고치면 됨', () => {
  renderFree();

  // 화면 주소(판 A1 = 6행): C6을 고르고 바로 "점검일"을 친 뒤 D6을 입력 칸으로
  fireEvent.mouseDown(cell('C6'));
  const input = screen.getByLabelText('C6 글자');
  fireEvent.change(input, { target: { value: '점검일' } });
  fireEvent.keyDown(input, { key: 'Enter' });
  expect(cell('C6').textContent).toBe('점검일');
  fireEvent.mouseDown(cell('D6'));
  fireEvent.mouseUp(cell('D6'));
  fireEvent.click(screen.getByRole('button', { name: /^입력 칸$/ }));
  expect(screen.getByDisplayValue('점검일')).toBeTruthy();   // ③ 고른 영역의 이름

  // 줄 영역(A8:B13) 아래 B14로 옮기면 같은 틀 시트가 "고치면 됨", 안내도 화면 주소로
  fireEvent.click(screen.getAllByRole('button', { name: '↦ 옮기기' })[0]);
  fireEvent.click(screen.getAllByRole('button', { name: '+ 행' })[0]);
  fireEvent.mouseDown(cell('B14'));
  fireEvent.click(screen.getByRole('button', { name: /취합 방식/ }));
  expect(screen.getByText(/아래 B14 '점검일'을 덮어써요/)).toBeTruthy();
  expect(screen.getAllByText(/고칠 것 \d/).length).toBeGreaterThan(0);
});
