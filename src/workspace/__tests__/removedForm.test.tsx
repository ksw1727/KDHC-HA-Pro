import { render } from '@testing-library/react';
import { SAMPLE } from '@contract/__tests__/fixtures';
import { loadForm, removeForm, saveForm } from '@gen/storage/localForms';
import { isRemoved } from '@gen/storage/removedForms';
import { AiPage } from '../../ai/AiPage';

beforeEach(() => {
  localStorage.clear();
  Element.prototype.scrollIntoView = vi.fn();
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('no server')));
});
afterEach(() => vi.unstubAllGlobals());

const opened = () => {
  const got: unknown[] = [];
  window.addEventListener('hanan-moa:open-form', (e) => got.push((e as CustomEvent).detail));
  return got;
};

test('지운 양식은 표시가 남고, 다시 저장하면 표시가 지워진다', () => {
  const s = structuredClone(SAMPLE.list);
  saveForm({ schema: s }, new Date());
  removeForm(s.formId);
  expect(loadForm(s.formId)).toBeNull();
  expect(isRemoved(s.formId)).toBe(true);
  saveForm({ schema: s }, new Date());
  expect(isRemoved(s.formId)).toBe(false);
});

test('AI 대화의 마지막 양식이 지운 양식이면 새로고침 때 패널에 다시 열지 않는다 (자동 저장으로 되살아나지 않게)', () => {
  const s = structuredClone(SAMPLE.list);
  localStorage.setItem('hanan-moa:ai-chat', JSON.stringify({ chatId: null, msgs: [{ role: 'ai', opened: true, form: s }], aiVersion: null }));
  saveForm({ schema: s }, new Date());
  removeForm(s.formId);
  const got = opened();
  render(<AiPage />);
  expect(got).toHaveLength(0);
});

test('지우지 않은 양식은 그대로 다시 연다', () => {
  const s = structuredClone(SAMPLE.list);
  localStorage.setItem('hanan-moa:ai-chat', JSON.stringify({ chatId: null, msgs: [{ role: 'ai', opened: true, form: s }], aiVersion: null }));
  const got = opened();
  render(<AiPage />);
  expect(got).toHaveLength(1);
});
