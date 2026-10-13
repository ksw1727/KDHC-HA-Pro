import { FIELD_TYPES, numberFormat, resolveDate, selectNeedsRange } from '../fieldTypes';
import { f } from './fixtures';

const today = new Date(2026, 9, 13); // 2026-10-13 (로컬)

describe('숫자 서식', () => {
  test.each([
    [{}, '#,##0'],
    [{ thousands: false }, '0'],
    [{ decimals: 2 }, '#,##0.00'],
    [{ decimals: 1, thousands: false }, '0.0'],
    [{ unit: '원' }, '#,##0"원"'],
    [{ unit: '%', decimals: 1 }, '#,##0.0"%"'],
    [{ unit: '개', thousands: false }, '0"개"'],
    [{ decimals: 9 }, '#,##0.0000'],
  ])('%j → %s', (extra, fmt) => {
    expect(numberFormat(f('n', '수량', { type: 'number', ...extra }))).toBe(fmt);
  });

  test('범위 규칙: 0~999 정수', () => {
    const v = FIELD_TYPES.number.excelValidation(f('n', '수량', { type: 'number', min: 0, max: 999 }), today)!;
    expect(v).toMatchObject({ type: 'whole', operator: 'between', formulae: [0, 999] });
    expect(v.error).toBe('수량: 0 이상 999 이하의 정수를 입력하세요');
  });

  test('소수는 decimal, 최소만 있으면 이상', () => {
    const v = FIELD_TYPES.number.excelValidation(f('n', '비율', { type: 'number', decimals: 2, min: 0 }), today)!;
    expect(v).toMatchObject({ type: 'decimal', operator: 'greaterThanOrEqual', formulae: [0] });
  });
});

describe('날짜', () => {
  test.each([
    ['yyyy-mm-dd', 'yyyy-mm-dd'],
    ['yyyy.mm.dd', 'yyyy.mm.dd'],
    ['yyyy-mm', 'yyyy-mm'],
    ['yyyy', '0'],
  ] as const)('표시 형식 %s → %s', (df, fmt) => {
    expect(FIELD_TYPES.date.excelNumFmt(f('d', '날짜', { type: 'date', dateFormat: df }))).toBe(fmt);
  });

  test('상대 날짜 계산', () => {
    expect(resolveDate('today', today)?.toISOString().slice(0, 10)).toBe('2026-10-13');
    expect(resolveDate('today+30', today)?.toISOString().slice(0, 10)).toBe('2026-11-12');
    expect(resolveDate('today-7', today)?.toISOString().slice(0, 10)).toBe('2026-10-06');
    expect(resolveDate('2026-01-31', today)?.toISOString().slice(0, 10)).toBe('2026-01-31');
    expect(resolveDate('내일', today)).toBeUndefined();
  });

  test('오늘 이후 규칙과 메시지', () => {
    const v = FIELD_TYPES.date.excelValidation(f('d', '참가일', { type: 'date', minDate: 'today' }), today)!;
    expect(v.type).toBe('date');
    expect((v.formulae[0] as Date).toISOString().slice(0, 10)).toBe('2026-10-13');
    expect(v.error).toBe('참가일: 2026-10-13 이후 날짜를 입력하세요 (예: 2026-11-01)');
  });

  test('연도형은 정수 1900~9999', () => {
    const v = FIELD_TYPES.date.excelValidation(f('y', '연도', { type: 'date', dateFormat: 'yyyy' }), today)!;
    expect(v).toMatchObject({ type: 'whole', formulae: [1900, 9999] });
  });
});

describe('목록 선택', () => {
  test('드롭다운 목록 문자열', () => {
    const v = FIELD_TYPES.select.excelValidation(f('s', '직급', { type: 'select', options: ['사원', '대리'] }), today)!;
    expect(v).toMatchObject({ type: 'list', formulae: ['"사원,대리"'] });
  });
  test('선택지 없으면 규칙 없음', () => {
    expect(FIELD_TYPES.select.excelValidation(f('s', '직급', { type: 'select', options: [] }), today)).toBeNull();
  });
  test('쉼표가 있거나 길면 범위 참조가 필요', () => {
    expect(selectNeedsRange(f('s', 'x', { options: ['a,b'] }))).toBe(true);
    expect(selectNeedsRange(f('s', 'x', { options: ['가'.repeat(260)] }))).toBe(true);
    expect(selectNeedsRange(f('s', 'x', { options: ['a', 'b'] }))).toBe(false);
  });
});

describe('텍스트·메모·패턴', () => {
  test('텍스트 글자 수 제한', () => {
    const v = FIELD_TYPES.text.excelValidation(f('t', '이름', { maxLength: 20 }), today)!;
    expect(v).toMatchObject({ type: 'textLength', operator: 'lessThanOrEqual', formulae: [20] });
    expect(FIELD_TYPES.text.excelNumFmt(f('t', '이름'))).toBe('@');
  });
  test('규칙 없고 안내만 있으면 안내용 검사', () => {
    const v = FIELD_TYPES.memo.excelValidation(f('m', '비고', { type: 'memo', help: '자유롭게' }), today)!;
    expect(v).toMatchObject({ type: 'custom', showInputMessage: true, prompt: '자유롭게' });
    expect(FIELD_TYPES.memo.excelValidation(f('m', '비고', { type: 'memo' }), today)).toBeNull();
  });
  test('휴대폰 패턴: 글자 서식과 길이 규칙', () => {
    const fld = f('p', '연락처', { type: 'pattern', pattern: 'mobile' });
    expect(FIELD_TYPES.pattern.excelNumFmt(fld)).toBe('@');
    const v = FIELD_TYPES.pattern.excelValidation(fld, today)!;
    expect(v).toMatchObject({ type: 'textLength', formulae: [10, 13] });
    expect(v.error).toContain('010-1234-5678');
  });
  test('안내가 있으면 입력 메시지 포함', () => {
    const v = FIELD_TYPES.number.excelValidation(f('n', '교육비', { type: 'number', help: '1인당 금액' }), today)!;
    expect(v).toMatchObject({ showInputMessage: true, promptTitle: '교육비', prompt: '1인당 금액' });
  });
});

test('normalize는 취합 파트 몫이라 아직 없음', () => {
  expect(() => FIELD_TYPES.text.normalize('x', f('t', 'x'), { year: 2026, today })).toThrow(/개발자 2/);
});
