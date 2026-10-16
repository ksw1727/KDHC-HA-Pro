import { validateSchema, blockFields, aggregationLabel, gridOwners, type FormSchema } from '../schema';
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

describe('gridOwners (빈칸채우기 작성처)', () => {
  const grid = (org: FormSchema['org'], owner?: string): Pick<FormSchema, 'org' | 'blocks'> => ({
    org,
    blocks: [{
      kind: 'grid', id: 'b1', colLabels: ['사업', '수원 지사', '대구지사'], spareRows: 0,
      rows: [
        [{ kind: 'fixed', value: '교육' }, { kind: 'input', field: { key: 'a', label: 'a', type: 'number', required: false } }, { kind: 'input', field: { key: 'b', label: 'b', type: 'number', required: false, owner } }],
        [{ kind: 'fixed', value: '강남지사' }, { kind: 'input', field: { key: 'c', label: 'c', type: 'number', required: false } }, { kind: 'blank' }],
      ],
    }],
  });
  const preset = { mode: 'preset' as const, orgs: ['강남지사', '수원지사', '대구지사'] };
  it('직접 지정 > 열 머리글(띄어쓰기 무시) > 행 첫 칸', () => {
    expect([...gridOwners(grid(preset))]).toEqual([['a', '수원지사'], ['b', '대구지사'], ['c', '수원지사']]);
    expect(gridOwners(grid(preset, '강남지사')).get('b')).toBe('강남지사');
  });
  it('목록에 없는 직접 지정은 작성처 없음, preset이 아니면 비어 있다', () => {
    expect(gridOwners(grid(preset, '청주지사')).has('b')).toBe(false);
    expect(gridOwners(grid({ mode: 'none' })).size).toBe(0);
  });
});

describe('빈칸채우기 작성처는 지사가 아니어도 된다', () => {
  it('담당자별 행: 행 첫 칸이 담당자 이름이면 그 사람 칸, 펼치기는 빠진다', () => {
    const s = {
      layout: 'fill-in' as const,
      org: { mode: 'preset' as const, label: '담당자', orgs: ['김현우', '박소영'] },
      blocks: [{
        kind: 'grid' as const, id: 'b1', colLabels: ['담당자', '점검 건수', '비고'], spareRows: 0,
        rows: ['김현우', '박 소영'].map((n, r) => [
          { kind: 'fixed' as const, value: n },
          { kind: 'input' as const, field: { key: `n${r}`, label: 'n', type: 'number' as const, required: false } },
          { kind: 'input' as const, field: { key: `m${r}`, label: 'm', type: 'text' as const, required: false } },
        ]),
      }],
    };
    expect([...gridOwners(s)]).toEqual([['n0', '김현우'], ['m0', '김현우'], ['n1', '박소영'], ['m1', '박소영']]);
    expect(availableAggregations(s)).not.toContain('spread');
    expect(availableAggregations({ ...s, org: { mode: 'none' } })).toContain('spread');
  });
});
