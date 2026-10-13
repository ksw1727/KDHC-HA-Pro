import { CONTRACT_VERSION } from '../version';

test('계약 버전은 1이다', () => {
  expect(CONTRACT_VERSION).toBe(1);
});
