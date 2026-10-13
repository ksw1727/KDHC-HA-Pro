import { fireEvent, render, screen } from '@testing-library/react';
import { parseFormula, evaluate } from '@contract/formula';
import { layoutSheet } from '@contract/layout';
import type { FormSchema } from '@contract/schema';
import { SAMPLE, f } from '@contract/__tests__/fixtures';
import { sampleAggregate } from '../preview/sampleAggregate';
import { dropHeader, parseCsvLine, parseOrgList } from '../builder/OrgPanel';
import { applyToInputs, relabel, setInputs, setValue, type GridData } from '../builder/gridOps';
import { formReducer } from '../state/formReducer';
import { FormatEditor } from '../builder/FormatEditor';

// Aside 시험(2026-10-13)에서 찾은 기능 버그 7개

test('1. 날짜 허용 범위 "날짜 지정"을 고르면 날짜 입력칸이 나온다', () => {
  let field = f('d', '점검일', { type: 'date' });
  const { rerender } = render(<FormatEditor f={field} set={(p) => { field = { ...field, ...p }; }} />);
  fireEvent.click(screen.getByRole('radio', { name: '날짜 지정' }));
  expect(field.minDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  rerender(<FormatEditor f={field} set={(p) => { field = { ...field, ...p }; }} />);
  expect(screen.getByLabelText('시작 날짜')).toBeTruthy();
  expect(screen.getByRole('radio', { name: '날짜 지정' }).getAttribute('aria-checked')).toBe('true');
});

test('2. 화면에 보이는 기호 ≥ ≤ ≠ − 를 계산식에 직접 쳐도 된다', () => {
  expect(() => parseFormula('조건([점수] ≥ 80, "합격", "불합격")')).not.toThrow();
  const n = parseFormula('[가] − [나]');
  expect(evaluate(n, (name) => (name === '가' ? 10 : 3))).toBe(7);
  expect(evaluate(parseFormula('[가] ≠ [나]'), (name) => (name === '가' ? 1 : 2))).toBe(1);   // 비교 결과는 엑셀처럼 1·0
  expect(evaluate(parseFormula('[가] ≤ 1'), () => 1)).toBe(1);
});

test('3. 취합본 미리보기 계산값은 가짜 값이 아니라 실제로 계산한 값', () => {
  const s: FormSchema = structuredClone(SAMPLE['header-list']);
  const list = s.blocks[1];
  if (list.kind !== 'list') throw new Error();
  list.columns.push(f('hrs', '시간', { type: 'number' }), f('amt', '금액', { type: 'calc', formula: '[교육비] × [시간]' }), f('far', '구분', { type: 'calc', formula: '조건([시간] >= 10, "장시간", "단시간")' }));
  if (s.blocks[0].kind === 'fields') s.blocks[0].fields.push(f('tot', '총액', { type: 'calc', formula: '합계([금액])' }));
  const { data } = sampleAggregate(s);
  const row = data.rows![0].values;
  expect(row.amt).toBe((row.fee as number) * (row.hrs as number));
  expect(['장시간', '단시간']).toContain(row.far);
  const totIdx = data.autoColumns.indexOf('총액');
  const seoulRows = data.rows!.filter((r) => r.auto[0] === data.rows![0].auto[0]);
  expect(data.rows![0].auto[totIdx]).toBe(seoulRows.reduce((n, r) => n + (r.values.amt as number), 0));
  // 같은 틀 시트에도 그 값이 그대로
  const m = layoutSheet(s, { mode: 'aggregate', info: '', data }, { today: new Date() });
  expect(m.cells.some((c) => c.fieldKey === 'amt' && c.value === row.amt)).toBe(true);
});

test('4. CSV: 따옴표 안 쉼표, 머리글 줄 빼기, 여러 열 붙여넣기는 첫 열만', () => {
  expect(parseCsvLine('"부산정보산업진흥원, 본원",비고')).toEqual(['부산정보산업진흥원, 본원', '비고']);
  expect(parseCsvLine('"따옴표 ""안"" 글자",x')[0]).toBe('따옴표 "안" 글자');
  expect(dropHeader(['기관명', '서울', '부산'])).toEqual(['서울', '부산']);
  expect(dropHeader(['서울', '부산'])).toEqual(['서울', '부산']);
  expect(parseOrgList('서울\t비고1\n부산\t비고2')).toEqual(['서울', '부산']);
  expect(parseOrgList('서울\t부산\t대구')).toEqual(['서울', '부산', '대구']);
});

describe('빈칸채우기 표', () => {
  const k = () => { let n = 0; return () => `k${++n}`; };
  const base: GridData = {
    colLabels: ['날짜', '근무자'],
    rows: [[{ kind: 'fixed', value: '12/24' }, { kind: 'blank' }], [{ kind: 'fixed', value: '12/24' }, { kind: 'blank' }]],
    spareRows: 0,
  };

  test('6. 행 첫 칸이 같아도 자동 이름이 겹치지 않고, 머리글·행 제목을 바꾸면 따라 바뀐다', () => {
    const g = relabel(base, setInputs(base, { r1: 0, c1: 1, r2: 1, c2: 1 }, k()));
    const names = g.rows.map((r) => (r[1].kind === 'input' ? r[1].field.label : ''));
    expect(names).toEqual(['12/24 · 근무자 (1행)', '12/24 · 근무자 (2행)']);
    const g2 = relabel(g, setValue({ ...g, colLabels: ['날짜', '담당'] }, 1, 0, '12/25'));
    expect(g2.rows.map((r) => (r[1].kind === 'input' ? r[1].field.label : ''))).toEqual(['12/24 · 담당', '12/25 · 담당']);
  });

  test('6. 직접 고친 이름은 그대로, 자동 이름이 바뀌면 계산식 안 이름도 바뀜', () => {
    const s = structuredClone(SAMPLE['fill-in']);
    const grid = s.blocks[0];
    if (grid.kind !== 'grid') throw new Error();
    grid.rows[0].push({ kind: 'calc', field: f('c1', '교육 · 합', { type: 'calc', formula: '[교육 · 서울] × 2' }) });
    grid.rows[1].push({ kind: 'blank' });
    grid.colLabels.push('합');
    const g: GridData = { colLabels: grid.colLabels, rows: grid.rows, spareRows: 0 };
    const next = relabel(g, { ...g, colLabels: ['사업', '예산', '부산', '합'] });
    const s2 = formReducer(s, { type: 'grid/replace', blockId: 'b1', grid: next });
    const b2 = s2.blocks[0];
    if (b2.kind !== 'grid') throw new Error();
    expect(b2.rows[0][2]).toMatchObject({ field: { label: '교육 · 부산' } });
    expect(b2.rows[0][3]).toMatchObject({ field: { formula: '[교육 · 부산] × 2' } });
  });

  test('7. 고른 입력칸 여러 개에 서식을 한꺼번에 (이름은 그대로)', () => {
    const g = setInputs(base, { r1: 0, c1: 1, r2: 1, c2: 1 }, k());
    const g2 = applyToInputs(g, { r1: 0, c1: 0, r2: 1, c2: 1 }, { type: 'number', unit: '명', label: '무시' });
    for (const r of g2.rows) {
      expect(r[0].kind).toBe('fixed');
      expect(r[1]).toMatchObject({ kind: 'input', field: { type: 'number', unit: '명' } });
      if (r[1].kind === 'input') expect(r[1].field.label).not.toBe('무시');
    }
  });
});
