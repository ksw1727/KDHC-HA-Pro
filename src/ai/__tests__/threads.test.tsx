import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { SAMPLE } from '@contract/__tests__/fixtures';
import { saveForm } from '@gen/storage/localForms';
import { findThreadForForm, listThreads, saveThread, threadTitle } from '../threads';
import { AiPage } from '../AiPage';

const formX = { ...structuredClone(SAMPLE.list), formId: 'form-x', title: '지금 대화 양식' };
const formY = { ...structuredClone(SAMPLE.list), formId: 'form-y', title: '예전 대화 양식' };
const formZ = { ...structuredClone(SAMPLE.list), formId: 'form-z', title: '대화 없는 양식' };

beforeEach(() => {
  localStorage.clear();
  Element.prototype.scrollIntoView = vi.fn();
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ openai: true, openaiModels: ['gpt-test'] }), { headers: { 'content-type': 'application/json' } })));
});
afterEach(() => vi.unstubAllGlobals());

const openFromWorkspace = (schema: unknown) => act(() => { window.dispatchEvent(new CustomEvent('hanan-moa:open-form', { detail: { schema, from: 'workspace' } })); });

test('대화 보관함: 남기고, 양식 번호로 찾고, 목록은 최근 순. 내용이 같으면 다시 쓰지 않는다', async () => {
  const a = [{ role: 'user', text: '명단 받고 싶어요' }, { role: 'ai', text: '만들었어요', form: formX }];
  await saveThread({ threadId: 't-a', chatId: 'c-a', msgs: a, aiVersion: null });
  const first = (await listThreads()).list[0];
  await saveThread({ threadId: 't-a', chatId: 'c-a', msgs: a, aiVersion: null });
  expect((await listThreads()).list[0].updatedAt).toBe(first.updatedAt);
  await new Promise((r) => setTimeout(r, 5));
  await saveThread({ threadId: 't-b', chatId: null, msgs: [{ role: 'ai', text: '', form: formY }], aiVersion: null });
  expect((await listThreads()).list.map((t) => t.threadId)).toEqual(['t-b', 't-a']);
  expect((await findThreadForForm('form-x'))?.threadId).toBe('t-a');
  expect(await findThreadForForm('nope')).toBeNull();
  expect(threadTitle(a)).toBe('지금 대화 양식');
  expect(threadTitle([{ role: 'user', text: '그냥 질문' }])).toBe('그냥 질문');
});

test('내 업무공간에서 연 양식: 그 양식을 만든 예전 대화와 미리보기 카드로 바꾸고, 지금 대화는 목록에 남는다', async () => {
  localStorage.setItem('hanan-moa:ai-chat', JSON.stringify({ chatId: 'c-now', threadId: 't-now', aiVersion: null, msgs: [{ role: 'user', text: '지금 하던 말' }, { role: 'ai', text: '지금 답', form: formX }] }));
  await saveThread({ threadId: 't-old', chatId: 'c-old', aiVersion: null, msgs: [{ role: 'user', text: '예전에 부탁한 말' }, { role: 'ai', text: '예전 답', form: formY }] });
  saveForm({ schema: formY, lastExported: formY }, new Date());
  render(<AiPage />);
  await screen.findByText('지금 하던 말');
  openFromWorkspace(formY);
  await screen.findByText('예전에 부탁한 말');
  expect(screen.queryByText('지금 하던 말')).toBeNull();
  expect(screen.getAllByText('예전 대화 양식').length).toBeGreaterThan(0);   // 양식 카드(미리보기)
  // 지금 대화는 보관함에 남아 [대화 목록]으로 돌아갈 수 있다
  fireEvent.click(screen.getByRole('button', { name: '대화 목록' }));
  const item = await screen.findByRole('menuitem', { name: /지금 대화 양식/ });
  fireEvent.click(item);
  await screen.findByText('지금 하던 말');
});

test('예전 대화 안에 있지만 마지막 카드가 아닌 양식이면 그 양식 카드를 끝에 붙여 패널과 잇는다', async () => {
  await saveThread({ threadId: 't-two', chatId: null, aiVersion: null, msgs: [{ role: 'ai', text: '첫 양식', form: formY }, { role: 'ai', text: '둘째 양식', form: formX }] });
  render(<AiPage />);
  await screen.findByText('무엇을 받고 싶으세요?');
  openFromWorkspace(formY);
  await screen.findByText('둘째 양식');
  await waitFor(() => expect(screen.getByText(/내 업무공간에서 연 양식이에요/)).toBeTruthy());
});

test('대화 기록이 없는 양식은 양식 카드만 띄우고 그렇다고 알린다', async () => {
  render(<AiPage />);
  await screen.findByText('무엇을 받고 싶으세요?');
  openFromWorkspace(formZ);
  await screen.findByText(/대화 기록이 남아 있지 않아 양식만 불러왔어요/);
  expect(screen.getAllByText('대화 없는 양식').length).toBeGreaterThan(0);
});
