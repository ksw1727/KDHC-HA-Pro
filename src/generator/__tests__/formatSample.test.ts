import { formatNumber, formatSample, normalizeHint } from '../preview/formatSample';
import type { Field } from '@contract/schema';

const f = (extra: Partial<Field>): Field => ({ key: 'k', label: '항목', type: 'text', required: false, ...extra });

test('숫자 예시: 단위·쉼표·소수', () => {
  expect(formatSample(f({ type: 'number', unit: '원' }))).toBe('120,000원');
  expect(formatSample(f({ type: 'number', unit: '%', decimals: 2 }))).toBe('12.50%');
  expect(formatSample(f({ type: 'number', thousands: false }))).toBe('1000');
  expect(formatSample(f({ type: 'number', max: 500 }))).toBe('500');
});

test('formatNumber는 엑셀 서식과 같은 모양', () => {
  expect(formatNumber(1234.5, { decimals: 1, unit: '개' })).toBe('1,234.5개');
});

test('날짜·패턴·선택·이름 예시', () => {
  expect(formatSample(f({ type: 'date', dateFormat: 'yyyy.mm.dd' }))).toBe('2026.11.01');
  expect(formatSample(f({ type: 'pattern', pattern: 'mobile' }))).toBe('010-1234-5678');
  expect(formatSample(f({ type: 'select', options: ['사원', '대리'] }), 1)).toBe('대리');
  expect(formatSample(f({ label: '이름' }), 2)).toBe('박지훈');
});

test('정리 안내 문구', () => {
  expect(normalizeHint(f({ type: 'number', unit: '원' }))).toContain('1,000원');
  expect(normalizeHint(f({ type: 'pattern', pattern: 'mobile' }))).toContain('010-1234-5678');
});
