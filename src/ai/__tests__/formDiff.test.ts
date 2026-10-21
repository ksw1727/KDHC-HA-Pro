import { SAMPLE, f } from '@contract/__tests__/fixtures';
import { describeChanges } from '../formDiff';

describe('빌더에서 고친 내용 (describeChanges)', () => {
  test('제출처 추가·빼기, 부르는 말', () => {
    const a = structuredClone(SAMPLE.list);
    const b = structuredClone(a);
    b.org = { ...b.org, label: '부서', orgs: ['서울', '대구', '광주', '울산'] };
    expect(describeChanges(a, b)).toEqual(['제출처를 부르는 말: 지사 → 부서', '부서 3곳 → 4곳 (추가: 광주, 울산) (뺌: 부산)']);
  });
  test('항목 추가·뺌·이름·필수', () => {
    const a = structuredClone(SAMPLE.list);
    const b = structuredClone(a);
    const list = b.blocks[0];
    if (list.kind !== 'list') throw new Error('list');
    list.columns = [{ ...list.columns[0], label: '성명', required: false }, f('phone', '연락처')];
    expect(describeChanges(a, b)).toEqual(['항목 추가: 연락처', '항목 뺌: 직급', '이름 → 성명: 필수 아님으로']);
  });
  test('같으면 빈 목록 (저장 시각만 다름)', () => {
    const a = structuredClone(SAMPLE.list);
    expect(describeChanges(a, { ...a, updatedAt: '2030-01-01T00:00:00Z' })).toEqual([]);
  });
});
