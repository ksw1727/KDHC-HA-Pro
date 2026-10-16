import { f } from '@contract/__tests__/fixtures';
import { normalize } from '../pipeline/normalize';

const ctx = { year: 2026, today: new Date('2026-10-13T00:00:00Z') };
const run = (raw: unknown, field: Parameters<typeof normalize>[1]) => normalize(raw, field, ctx);

describe('③ 값 정리 (01-contract.md 5절 표)', () => {
  test('text · memo: 앞뒤 공백은 자동, 길이 초과는 오류', () => {
    expect(run(' 김민수 ', f('a', '이름'))).toMatchObject({ status: 'auto', value: '김민수' });
    expect(run('가나다라', f('a', '이름', { maxLength: 3 }))).toMatchObject({ status: 'invalid', issue: 'TOO_LONG' });
    expect(run(' 긴 메모 ', f('a', '메모', { type: 'memo' }))).toMatchObject({ status: 'auto', value: '긴 메모' });
  });

  test('number', () => {
    const n = f('n', '수량', { type: 'number' });
    expect(run(3, n)).toEqual({ status: 'ok', value: 3 });
    expect(run('1,000개', n)).toMatchObject({ status: 'auto', value: 1000 });
    expect(run('₩5,000', n)).toMatchObject({ status: 'auto', value: 5000 });
    expect(run('15%', n)).toMatchObject({ status: 'auto', value: 15 });
    expect(run('약 10', n)).toMatchObject({ status: 'proposal', proposal: 10, issue: 'NOT_NUMBER' });
    expect(run('다섯', n)).toMatchObject({ status: 'proposal', proposal: 5 });
    expect(run(3.456, f('n', '점수', { type: 'number', decimals: 2 }))).toMatchObject({ status: 'proposal', proposal: 3.46 });
    expect(run('10~20', n)).toMatchObject({ status: 'invalid', issue: 'NOT_NUMBER' });
    expect(run(200, f('n', '수량', { type: 'number', max: 100 }))).toMatchObject({ status: 'invalid', issue: 'OUT_OF_RANGE' });
    expect(run({ error: '#REF!' }, n)).toMatchObject({ status: 'invalid', issue: 'FORMULA_ERROR', value: null });
  });

  test('number: 한글 자릿수 단위 (만·천·억)', () => {
    const won = f('w', '교육비', { type: 'number', unit: '원' });
    expect(run('3만원', won)).toMatchObject({ status: 'auto', value: 30000 });
    expect(run('6만 5천원', won)).toMatchObject({ status: 'auto', value: 65000 });
    expect(run('2.5만', won)).toMatchObject({ status: 'auto', value: 25000 });
    expect(run('1억 2천만원', won)).toMatchObject({ status: 'auto', value: 120000000 });
    expect(run('-3만', won)).toMatchObject({ status: 'auto', value: -30000 });
    expect(run('약 6만', won)).toMatchObject({ status: 'proposal', proposal: 60000, issue: 'NOT_NUMBER' });
    expect(run('10명 정도', f('n', '인원', { type: 'number' }))).toMatchObject({ status: 'proposal', proposal: 10 });
    expect(run('3만~4만', won)).toMatchObject({ status: 'invalid', issue: 'NOT_NUMBER' });
  });

  test('date', () => {
    const d = f('d', '참가일', { type: 'date' });
    expect(run(new Date(Date.UTC(2026, 10, 1)), d)).toEqual({ status: 'ok', value: '2026-11-01' });
    expect(run('2026.11.1', d)).toMatchObject({ status: 'auto', value: '2026-11-01' });
    expect(run('2026/11/01', d)).toMatchObject({ status: 'auto', value: '2026-11-01' });
    expect(run('11월 1일', d)).toMatchObject({ status: 'auto', value: '2026-11-01' });
    expect(run('11/1', d)).toMatchObject({ status: 'auto', value: '2026-11-01' });
    expect(run(46327, d)).toMatchObject({ status: 'auto', value: '2026-11-01' });   // 엑셀 날짜 숫자
    expect(run('다음주', d)).toMatchObject({ status: 'invalid', issue: 'NOT_DATE' });
    const y = f('y', '연도', { type: 'date', dateFormat: 'yyyy' });
    expect(run('2026년', y)).toMatchObject({ status: 'auto', value: '2026' });
    expect(run('26', y)).toMatchObject({ status: 'proposal', proposal: '2026' });
    expect(run('2026-01-01', f('d', '참가일', { type: 'date', minDate: 'today' }))).toMatchObject({ status: 'invalid', issue: 'OUT_OF_RANGE' });
  });

  test('select', () => {
    const s = f('s', '직급', { type: 'select', options: ['사원', '대리', 'Manager'] });
    expect(run('대리', s)).toEqual({ status: 'ok', value: '대리' });
    expect(run(' manager ', s)).toMatchObject({ status: 'auto', value: 'Manager' });
    expect(run('대리님', s)).toMatchObject({ status: 'proposal', proposal: '대리' });
    expect(run('부장', s)).toMatchObject({ status: 'invalid', issue: 'NOT_IN_OPTIONS' });
  });

  test('pattern', () => {
    expect(run('0212345678', f('p', '전화', { type: 'pattern', pattern: 'phone' }))).toMatchObject({ status: 'auto', value: '02-1234-5678' });
    expect(run('01012345678', f('p', '휴대폰', { type: 'pattern', pattern: 'mobile' }))).toMatchObject({ status: 'auto', value: '010-1234-5678' });
    expect(run(1012345678, f('p', '휴대폰', { type: 'pattern', pattern: 'mobile' }))).toMatchObject({ status: 'auto', value: '010-1234-5678' });
    expect(run('1248100998', f('p', '사업자', { type: 'pattern', pattern: 'bizno' }))).toMatchObject({ status: 'auto', value: '124-81-00998' });
    expect(run('1234567890', f('p', '사업자', { type: 'pattern', pattern: 'bizno' }))).toMatchObject({ status: 'invalid', issue: 'BAD_PATTERN' });
    expect(run(' Kim@Example.COM ', f('p', '메일', { type: 'pattern', pattern: 'email' }))).toMatchObject({ status: 'auto', value: 'Kim@example.com' });
  });
});
