import { evaluate, formulaProblem, formulaRefs, parseFormula, printFormula, refsOnlyInAggregates, renameRef, toExcel, FormulaError } from '../formula';

const env = (vals: Record<string, number | string | null | (number | null)[]>) => (name: string) => vals[name];
const calc = (src: string, vals: Record<string, number | string | null | (number | null)[]>) => evaluate(parseFormula(src), env(vals));

describe('읽기와 출력', () => {
  test('우선순위·괄호·한글 함수', () => {
    const n = parseFormula('[여] ÷ ([남] + [여]) × 100');
    expect(printFormula(n)).toBe('[여] ÷ ([남] + [여]) × 100');
    expect(printFormula(n, { ko: false })).toBe('[여] / ([남] + [여]) * 100');
    expect(printFormula(parseFormula('반올림(평균([a],[b]),1)'))).toBe('반올림(평균([a], [b]), 1)');
    expect(printFormula(parseFormula('IF([점수]>=80,"적합","부적합")'))).toBe('조건([점수] >= 80, "적합", "부적합")');
    expect(printFormula(parseFormula('[a]-([b]-[c])'))).toBe('[a] - ([b] - [c])');
  });
  test('칸 이름 목록과 합계 안에서만 쓰인 이름', () => {
    const n = parseFormula('합계([금액]) / [인원] + [인원]');
    expect(formulaRefs(n)).toEqual(['금액', '인원']);
    expect([...refsOnlyInAggregates(n)]).toEqual(['금액']);
  });
  test.each([
    ['', /비어/],
    ['[여', /닫는/],
    ['[여] +', /끝나지 않았/],
    ['여 + 1', /모르는 함수/],
    ['반올림()', /값이 필요/],
    ['조건([a]>1, 2)', /조건\(비교/],
    ['1 2', /끝나야/],
    ['[a] @ 2', /쓸 수 없는 글자/],
  ])('오류: %s', (src, re) => {
    expect(() => parseFormula(src)).toThrow(FormulaError);
    expect(() => parseFormula(src)).toThrow(re);
  });
  test('이름 바꾸기', () => {
    expect(renameRef('[이름] + [ 이름 ] + [이름2]', '이름', '성명')).toBe('[성명] + [성명] + [이름2]');
  });
  test('검사 문구', () => {
    expect(formulaProblem('[a]+[b]', (n) => n === 'a')).toBe('[b] 칸을 찾을 수 없어요.');
    expect(formulaProblem('', () => true)).toBe('계산식을 입력해 주세요.');
    expect(formulaProblem('[a]*2', () => true)).toBeNull();
  });
});

describe('엑셀 수식', () => {
  const at: Record<string, string> = { 남: 'B7', 여: 'C7', 단가: '$B$6', 금액: 'D10:D109' };
  const r = (name: string) => at[name];
  test('IFERROR로 감싸고 주소로 바꿈', () => {
    expect(toExcel(parseFormula('[여] ÷ ([남] + [여]) × 100'), r)).toBe('IFERROR(C7/(B7+C7)*100,"")');
    expect(toExcel(parseFormula('[남] × [단가]'), r)).toBe('IFERROR(B7*$B$6,"")');
    expect(toExcel(parseFormula('합계([금액])'), r)).toBe('IFERROR(SUM(D10:D109),"")');
    expect(toExcel(parseFormula('조건([남] >= 10, "많음", "적음")'), r)).toBe('IFERROR(IF(B7>=10,"많음","적음"),"")');
    expect(toExcel(parseFormula('반올림([남] / 3, 1)'), r)).toBe('IFERROR(ROUND(B7/3,1),"")');
  });
  test('여러 값 함수 안인지 알려 준다', () => {
    const seen: [string, boolean][] = [];
    toExcel(parseFormula('[a] + 합계([b])'), (n, agg) => { seen.push([n, agg]); return 'A1'; });
    expect(seen).toEqual([['a', false], ['b', true]]);
  });
  test('없는 칸이면 오류', () => {
    expect(() => toExcel(parseFormula('[없음]'), r)).toThrow(/찾을 수 없어요/);
  });
});

describe('계산', () => {
  test('사칙연산·비율', () => {
    expect(calc('[여] ÷ ([남] + [여]) × 100', { 남: 45, 여: 41 })).toBeCloseTo(47.674, 2);
  });
  test('0으로 나누기·글자는 null (엑셀 IFERROR와 같음)', () => {
    expect(calc('[a] / [b]', { a: 1, b: 0 })).toBeNull();
    expect(calc('[a] / [b]', { a: 1, b: null })).toBeNull();
    expect(calc('[a] * 2', { a: '열' })).toBeNull();
  });
  test('빈칸은 엑셀처럼 0으로 본다 (할인율이 비면 할인 0)', () => {
    expect(calc('[a] + 1', { a: null })).toBe(1);
    expect(calc('[수량] × [단가] × (1 − [할인율])', { 수량: 2, 단가: 1000, 할인율: null })).toBe(2000);
    expect(calc('-[a]', { a: null })).toBe(0);
    expect(calc('조건([a] > 0, "있음", "없음")', { a: null })).toBe('없음');
    expect(calc('조건([a], 1, 2)', { a: null })).toBe(2);
    expect(calc('[a] = "적합"', { a: null })).toBe(0);
    expect(calc('반올림([a], 1)', { a: null })).toBe(0);
  });
  test('합계·평균·최소·최대는 빈칸을 건너뜀', () => {
    expect(calc('합계([x])', { x: [1, 2, null, 3] })).toBe(6);
    expect(calc('평균([x])', { x: [2, null, 4] })).toBe(3);
    expect(calc('최대([a], [b], 10)', { a: 3, b: 12 })).toBe(12);
    expect(calc('평균([x])', { x: [null] })).toBeNull();
  });
  test('반올림(.5는 올림)과 조건', () => {
    expect(calc('반올림([a], 1)', { a: 2.25 })).toBe(2.3);
    expect(calc('반올림([a])', { a: -2.5 })).toBe(-3);
    expect(calc('조건([점수] >= 80, "적합", "부적합")', { 점수: 85 })).toBe('적합');
    expect(calc('조건([점수] >= 80, "적합", "부적합")', { 점수: 70 })).toBe('부적합');
  });
  test('없는 칸이면 오류', () => {
    expect(() => calc('[없음] + 1', {})).toThrow(/찾을 수 없어요/);
  });
});

import { computeHeader, computeListRow, computeSpareRow, formulaErrors } from '../formula';
import { validateSchema, type FormSchema, type ListBlock } from '../schema';
import { SAMPLE, f } from './fixtures';

describe('계산 칸 값 (compute)', () => {
  const list: ListBlock = {
    kind: 'list', id: 'b1', maxRows: 10, columns: [
      f('q', '수량', { type: 'number' }), f('p', '단가', { type: 'number' }),
      f('amt', '금액', { type: 'calc', formula: '[수량] × [단가]' }),
      f('vat', '부가세', { type: 'calc', formula: '반올림([금액] × 0.1)' }),
    ],
  };
  test('같은 줄, 계산 칸끼리 이어서', () => {
    expect(computeListRow(list, { q: 3, p: 1001 })).toMatchObject({ amt: 3003, vat: 300 });
  });
  test('위쪽 정보: 목록 열 합계', () => {
    const s = structuredClone(SAMPLE['header-list']) as FormSchema;
    const h = s.blocks[0];
    if (h.kind !== 'fields') throw new Error();
    h.fields.push(f('tot', '총 교육비', { type: 'calc', formula: '합계([교육비])' }));
    expect(computeHeader(s, {}, [{ fee: 100 }, { fee: 50 }, { fee: null }]).tot).toBe(150);
  });
  test('여유 줄 계산 칸', () => {
    const g = { kind: 'grid' as const, id: 'b1', colLabels: ['a', 'b'], rows: [], spareRows: 1, spareColumns: [f('a', 'a', { type: 'number' }), f('b', 'b', { type: 'calc', formula: '[a] × 2' })] };
    expect(computeSpareRow(g, [4, null])).toEqual([4, 8]);
  });
});

describe('계산식 검사 (validateSchema)', () => {
  const withCols = (...cols: ReturnType<typeof f>[]) => {
    const s = structuredClone(SAMPLE.list) as FormSchema;
    const l = s.blocks[0];
    if (l.kind !== 'list') throw new Error();
    l.columns.push(...cols);
    return s;
  };
  const errs = (s: FormSchema) => { const r = validateSchema(s); return r.ok ? [] : r.errors; };
  test('정상', () => {
    expect(errs(withCols(f('n', '수량', { type: 'number' }), f('c', '두배', { type: 'calc', formula: '[수량] × 2' })))).toEqual([]);
  });
  test('없는 칸·자기 자신', () => {
    expect(errs(withCols(f('c', '두배', { type: 'calc', formula: '[두배] × 2' })))).toEqual(['두배: [두배] 칸을 찾을 수 없어요.']);
  });
  test('서로를 가리키면 순환 오류', () => {
    const e = formulaErrors(withCols(f('a', 'A', { type: 'calc', formula: '[B] + 1' }), f('b', 'B', { type: 'calc', formula: '[A] + 1' })));
    expect(e.join()).toMatch(/서로를 가리키고/);
  });
  test('위쪽 정보에서 목록 칸은 합계 등 안에서만', () => {
    const s = structuredClone(SAMPLE['header-list']) as FormSchema;
    const h = s.blocks[0];
    if (h.kind !== 'fields') throw new Error();
    h.fields.push(f('x', '이상', { type: 'calc', formula: '[교육비] + 1' }));
    expect(errs(s).join()).toMatch(/합계·평균·최소·최대·개수 안에서만/);
  });
});
