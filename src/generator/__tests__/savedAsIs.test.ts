import { SAMPLE } from '@contract/__tests__/fixtures';
import { isSavedAsIs, saveForm } from '../storage/localForms';

beforeEach(() => localStorage.clear());

test('열기만 하고 고치지 않은 양식은 이미 저장된 것으로 본다 (저장시각만 다른 것은 같은 양식)', () => {
  const s = structuredClone(SAMPLE.list);
  expect(isSavedAsIs({ schema: s })).toBe(false);
  saveForm({ schema: s }, new Date('2026-10-01'));
  expect(isSavedAsIs({ schema: { ...s, updatedAt: '2026-10-26T00:00:00.000Z' } })).toBe(true);
  expect(isSavedAsIs({ schema: { ...s, title: '고친 제목' } })).toBe(false);
  expect(isSavedAsIs({ schema: s, lastExported: s })).toBe(false);
});
