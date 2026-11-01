import { render, screen } from '@testing-library/react';
import type { FormulaScope } from '@contract/formula';
import { FormulaEditor } from '../builder/FormulaEditor';

const scope: FormulaScope = { names: ['남', '여', '점수'], aggregateOnly: [] };
const show = (formula: string, decimals: number) =>
  render(<FormulaEditor value={formula} decimals={decimals} onChange={() => {}} scope={scope} />);
const hint = () => screen.queryByText(/반올림\(계산식/);

test('소수 자릿수를 고르면 반올림으로 감싸라고 알려 준다', () => {
  show('[여] ÷ ([남] + [여]) × 100', 1);
  expect(hint()?.textContent).toContain('반올림(계산식, 1)');
});

test('이미 반올림으로 감쌌으면 알리지 않는다', () => {
  show('반올림([여] ÷ ([남] + [여]) × 100, 1)', 1);
  expect(hint()).toBeNull();
});

test('정수 칸(자릿수 0)이면 알리지 않는다', () => {
  show('[여] ÷ ([남] + [여]) × 100', 0);
  expect(hint()).toBeNull();
});

test('글자를 내놓는 계산 칸이면 알리지 않는다', () => {
  show('조건([점수] ≥ 80, "적합", "부적합")', 1);
  expect(hint()).toBeNull();
});

test('계산식이 비어 있으면 알리지 않는다', () => {
  show('', 1);
  expect(hint()).toBeNull();
});
