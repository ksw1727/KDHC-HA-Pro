import { fireEvent, render, screen } from '@testing-library/react';
import { AiPage } from '../AiPage';

beforeEach(() => {
  localStorage.clear();
  Element.prototype.scrollIntoView = vi.fn();
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ openai: true, openaiModels: ['gpt-test'] }), { headers: { 'content-type': 'application/json' } })));
});
afterEach(() => vi.unstubAllGlobals());

test('빈 화면: [말로 만들기]가 기본이고, 예시를 누르면 입력창에 들어간다', async () => {
  render(<AiPage />);
  await screen.findByText('무엇을 받고 싶으세요?');
  expect(screen.getByRole('tab', { name: /말로 만들기/ }).getAttribute('aria-selected')).toBe('true');
  fireEvent.click(screen.getByRole('button', { name: /2027 사업예산 요구표/ }));
  expect((screen.getByRole('textbox', { name: 'AI에게 보낼 말' }) as HTMLTextAreaElement).value).toMatch(/사업별로 지사마다/);
  expect(screen.getByRole('button', { name: '새 대화' })).toBeTruthy();
});

test('[쓰던 엑셀로 만들기]: 끌어다 놓는 칸이 나오고, 파일을 넣으면 그 파일과 입력창이 보인다', async () => {
  render(<AiPage />);
  await screen.findByText('무엇을 받고 싶으세요?');
  fireEvent.click(screen.getByRole('tab', { name: /쓰던 엑셀로 만들기/ }));
  expect(screen.getByText('쓰던 엑셀을 여기에 끌어다 놓기')).toBeTruthy();
  expect(screen.queryByRole('textbox', { name: 'AI에게 보낼 말' })).toBeNull();
  const file = new File(['x'], '교육명단.xlsx');
  fireEvent.change(screen.getByLabelText('엑셀 파일 고르기'), { target: { files: [file] } });
  expect(await screen.findByText('교육명단.xlsx')).toBeTruthy();
  expect(screen.getByRole('textbox', { name: 'AI에게 보낼 말' })).toBeTruthy();
});
