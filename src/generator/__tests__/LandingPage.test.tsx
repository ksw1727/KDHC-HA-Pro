import { fireEvent, render, screen, within } from '@testing-library/react';
import { GeneratorRoot } from '../index';
import { listForms, saveForm } from '../storage/localForms';
import { SAMPLE } from '@contract/__tests__/fixtures';

beforeEach(() => localStorage.clear());

test('처음 온 사람: 안내 한 줄, 질문으로 고르면 추천 카드, 시작하면 빌더', () => {
  render(<><span id="app-header-slot" /><GeneratorRoot /></>);
  expect(screen.getByText(/처음 오셨네요/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: /질문으로 고르기/ }));
  fireEvent.click(screen.getByText('여러 줄 명단이나 내역'));
  fireEvent.click(screen.getByText('네, 위쪽에 한 번 받아요'));
  const card = screen.getByRole('radio', { name: /혼합형/ });
  expect(card.getAttribute('aria-checked')).toBe('true');
  expect(within(card).getByText('추천')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '혼합형으로 새 양식 만들기 →' }));
  expect(screen.getByRole('grid', { name: '엑셀 미리보기' })).toBeTruthy();
});

test('최근 양식: 열기·복제, 빌더에서 처음 화면으로 돌아오기', () => {
  saveForm({ schema: SAMPLE.list, lastExported: SAMPLE.list }, new Date());
  render(<><span id="app-header-slot" /><GeneratorRoot /></>);
  const recent = screen.getByRole('region', { name: '최근 양식' });
  expect(within(recent).getByText(SAMPLE.list.title)).toBeTruthy();
  fireEvent.click(within(recent).getByRole('button', { name: '복제' }));
  fireEvent.click(screen.getByRole('button', { name: '← 처음 화면' }));
  expect(listForms().map((f) => f.schema.title).sort()).toEqual([SAMPLE.list.title, `${SAMPLE.list.title} (복사)`].sort());
  expect(screen.getByText(`${SAMPLE.list.title} (복사)`)).toBeTruthy();
  expect(screen.getByText('내보내기 전')).toBeTruthy();
});
