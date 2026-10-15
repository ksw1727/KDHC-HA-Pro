import { validateSchema, blockFields, aggregationLabel, type FormSchema } from '../schema';
import { availableAggregations } from '../aggregationIds';
import { SAMPLE, f } from './fixtures';

const clone = <T,>(x: T): T => structuredClone(x);
const errorsOf = (s: unknown) => {
  const r = validateSchema(s);
  return r.ok ? [] : r.errors;
};

describe('validateSchema', () => {
  test.each(Object.keys(SAMPLE) as FormSchema['layout'][])('올바른 %s 양식은 통과', (layout) => {
    expect(errorsOf(SAMPLE[layout])).toEqual([]);
  });

  test('객체가 아니면 실패', () => {
    expect(validateSchema(null).ok).toBe(false);
    expect(validateSchema('x').ok).toBe(false);
  });

  test('혼합형 블록 순서가 [list, fields]면 실패', () => {
    const s = clone(SAMPLE['header-list']);
    s.blocks.reverse();
    expect(errorsOf(s).join()).toMatch(/fields, list/);
  });

  test('블록 id는 b1, b2 순서', () => {
    const s = clone(SAMPLE.list);
    s.blocks[0].id = 'x';
    expect(errorsOf(s).join()).toMatch(/b1/);
  });

  test('시트 모으기형은 collect 설정 필요, 지사명 입력 불가', () => {
    const s = clone(SAMPLE.collect);
    delete s.collect;
    s.org = { mode: 'input' };
    s.aggregations = ['collect-sheets'];
    const e = errorsOf(s).join('\n');
    expect(e).toMatch(/collect 설정/);
    expect(e).toMatch(/지사명 입력/);
  });

  test('빈칸채우기형 입력칸 0개이고 여유 줄 0이면 실패', () => {
    const s = clone(SAMPLE['fill-in']);
    const g = s.blocks[0];
    if (g.kind !== 'grid') throw new Error();
    g.rows = [[{ kind: 'fixed', value: 'a' }, { kind: 'blank' }, { kind: 'blank' }]];
    expect(errorsOf(s).join()).toMatch(/입력칸이 1개 이상/);
  });

  test('여유 줄이 있으면 열 규칙 수가 머리글 수와 같아야 함', () => {
    const s = clone(SAMPLE['fill-in']);
    const g = s.blocks[0];
    if (g.kind !== 'grid') throw new Error();
    g.spareRows = 3;
    g.spareColumns = [f('s1', '사업')];
    expect(errorsOf(s).join()).toMatch(/여유 줄의 열 규칙/);
  });

  test('preset인데 지사 0곳이면 실패', () => {
    const s = clone(SAMPLE.list);
    s.org.orgs = [];
    expect(errorsOf(s).join()).toMatch(/1곳 이상/);
  });

  test('필수 취합 방식이 빠지면 실패', () => {
    const s = clone(SAMPLE.matrix);
    s.aggregations = ['same-frame'];
    expect(errorsOf(s).join()).toMatch(/spread/);
  });

  test('식별 안 함인데 제출 현황표를 고르면 실패', () => {
    const s = clone(SAMPLE['fill-in']);
    s.aggregations = ['same-frame', 'submission-status'];
    expect(errorsOf(s).join()).toMatch(/submission-status/);
  });

  test('항목 key 중복이면 실패', () => {
    const s = clone(SAMPLE['header-list']);
    const l = s.blocks[1];
    if (l.kind !== 'list') throw new Error();
    l.columns[0].key = 'manager';
    expect(errorsOf(s).join()).toMatch(/key가 겹쳐요/);
  });

  test('표형 칸은 숫자', () => {
    const s = clone(SAMPLE.matrix);
    const m = s.blocks[0];
    if (m.kind !== 'matrix') throw new Error();
    m.cell.type = 'text';
    expect(errorsOf(s).join()).toMatch(/숫자/);
  });
});

describe('availableAggregations', () => {
  test('식별 안 함이면 제출 현황표 없음', () => {
    expect(availableAggregations(SAMPLE['fill-in'])).not.toContain('submission-status');
  });
  test('시트 모으기형은 같은 틀 시트 없음', () => {
    expect(availableAggregations(SAMPLE.collect)).toEqual(['collect-sheets', 'submission-status']);
  });
  test('표형은 네 가지 모두', () => {
    expect(availableAggregations(SAMPLE.matrix)).toEqual(['same-frame', 'spread', 'collect-sheets', 'submission-status']);
  });
});

test('blockFields: 빈칸채우기형은 입력칸만', () => {
  expect(blockFields(SAMPLE['fill-in'].blocks[0]).map((x) => x.key)).toEqual(['g1', 'g2']);
});

describe('aggregationLabel', () => {
  it('제출처를 부르는 말로 바꾸고, 식별 안 함이면 파일별', () => {
    expect(aggregationLabel({ org: { mode: 'preset', orgs: ['A'] } }, 'spread')).toBe('지사별 펼치기');
    expect(aggregationLabel({ org: { mode: 'input', label: '부서' } }, 'spread')).toBe('부서별 펼치기');
    expect(aggregationLabel({ org: { mode: 'none', label: '부서' } }, 'spread')).toBe('파일별 펼치기');
    expect(aggregationLabel({ org: { mode: 'none' } }, 'same-frame')).toBe('같은 틀 시트');
  });
});
