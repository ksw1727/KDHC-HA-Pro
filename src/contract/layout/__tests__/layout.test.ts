import { layoutSheet, sheetNameOf, colLetter, colNumber, range, expandRange, type SheetModel, type AggregateFill } from '..';
import { ROLE_STYLES } from '../styles';
import { SAMPLE, f } from '../../__tests__/fixtures';
import type { FormSchema } from '../../schema';

const today = new Date(2026, 9, 13);
const tpl = (s: FormSchema, orgName?: string) => layoutSheet(s, { mode: 'template', orgName }, { today });
const at = (m: SheetModel, a: string) => m.cells.find((c) => c.address === a);
const clone = <T,>(x: T): T => structuredClone(x);

describe('주소 도우미', () => {
  test('열 문자', () => {
    expect([1, 26, 27, 52, 53].map(colLetter)).toEqual(['A', 'Z', 'AA', 'AZ', 'BA']);
    expect(colNumber('AA')).toBe(27);
  });
  test('범위', () => {
    expect(range(2, 7, 2, 106)).toBe('B7:B106');
    expect(range(1, 1, 1, 1)).toBe('A1');
    expect(expandRange('A1:B2')).toEqual(['A1', 'B1', 'A2', 'B2']);
  });
  test('스타일 표에 모든 role이 있음', () => {
    expect(Object.keys(ROLE_STYLES)).toHaveLength(12);
  });
});

describe('공통 머리 (B2)', () => {
  test('preset: 제목·정보칸·지사명 잠금 값', () => {
    const m = tpl(SAMPLE.list, '부산');
    expect(at(m, 'A1')).toMatchObject({ role: 'title', value: '2026 하반기 교육 참가자 조사' });
    expect(at(m, 'A2')?.value).toBe('11월 5일까지 회신 · 제출 기한 10월 20일 · 문의 인사팀 02-000-0000');
    expect(at(m, 'A4')).toMatchObject({ value: '지사명', role: 'label' });
    expect(at(m, 'B4')).toMatchObject({ value: '부산', role: 'locked-value' });
    expect(m.cellMap.orgCell).toBe('B4');
    expect(m.merges).toContain('A1:C1');
  });

  test('input: 필수 입력칸, 목록 있으면 드롭다운', () => {
    const s = clone(SAMPLE.matrix);
    s.org = { mode: 'input', orgs: ['서울', '부산'] };
    const m = tpl(s);
    expect(at(m, 'B4')).toMatchObject({ role: 'input', required: true });
    expect(m.validations.find((v) => v.address === 'B4')?.rule).toMatchObject({ type: 'list', formulae: ['"서울,부산"'] });
  });

  test('none: 제출처 줄 없음, 블록이 4행부터', () => {
    const m = tpl(SAMPLE['fill-in']);
    expect(m.cellMap.orgCell).toBeUndefined();
    expect(at(m, 'A4')).toMatchObject({ value: '사업', role: 'header' });
  });

  test('부르는 말이 부서면 "부서명"', () => {
    const s = clone(SAMPLE.list);
    s.org.label = '부서';
    expect(at(tpl(s), 'A4')?.value).toBe('부서명');
  });

  test('정보칸: 비어 있는 값은 뺀다', () => {
    const s = clone(SAMPLE.list);
    delete s.guide;
    delete s.contact;
    expect(at(tpl(s), 'A2')?.value).toBe('제출 기한 10월 20일');
    delete s.deadline;
    expect(at(tpl(s), 'A2')?.value).toBeUndefined();
  });

  test('시트 이름 규칙', () => {
    expect(sheetNameOf('a/b:c?d*e[f]g\\h')).toBe('a_b_c_d_e_f_g_h');
    expect(sheetNameOf('가'.repeat(40))).toHaveLength(31);
    expect(sheetNameOf('  ')).toBe('양식');
  });
});

describe('목록형 (B3)', () => {
  test('머리글·입력 줄·유효성 검사·인쇄영역·틀 고정', () => {
    const m = tpl(SAMPLE.list);
    expect(at(m, 'A6')).toMatchObject({ value: '번호', role: 'header' });
    expect(at(m, 'B6')).toMatchObject({ value: '이름 *', required: true, fieldKey: 'name' });
    expect(at(m, 'C6')).toMatchObject({ value: '직급' });
    expect(at(m, 'A7')).toMatchObject({ value: 1, role: 'row-number' });
    expect(at(m, 'B7')).toMatchObject({ role: 'input', required: true, numFmt: '@' });
    expect(at(m, 'A106')?.value).toBe(100);
    expect(m.cellMap.blocks.b1).toEqual({ kind: 'list', headerRow: 6, firstDataRow: 7, lastDataRow: 106, columns: { name: 'B', rank: 'C' } });
    expect(m.validations.map((v) => v.address)).toEqual(['C7:C106']); // 이름은 글자 수 제한 없음 → 규칙 없음
    expect(m.printArea).toBe('A1:C106');
    expect(m.freeze).toEqual({ row: 6 });
  });

  test('예시 줄이 있으면 입력 줄이 한 칸 내려감', () => {
    const s = clone(SAMPLE.list);
    const l = s.blocks[0];
    if (l.kind !== 'list') throw new Error();
    l.exampleRow = { name: '김민수', rank: '대리' };
    l.maxRows = 3;
    const m = tpl(s);
    expect(at(m, 'B7')).toMatchObject({ role: 'example', value: '김민수' });
    expect(m.cellMap.blocks.b1).toMatchObject({ exampleRow: 7, firstDataRow: 8, lastDataRow: 10 });
  });
});

describe('혼합형 (B4)', () => {
  test('항목:값 줄과 그 아래 목록', () => {
    const m = tpl(SAMPLE['header-list']);
    expect(at(m, 'A6')).toMatchObject({ value: '담당자', role: 'label', required: true });
    expect(at(m, 'B6')).toMatchObject({ role: 'input', required: true });
    expect(m.merges).toContain('B6:C6');
    expect(m.cellMap.blocks.b1).toEqual({ kind: 'fields', cells: { manager: { labelCell: 'A6', valueCell: 'B6' }, phone: { labelCell: 'A7', valueCell: 'B7' } } });
    expect(m.cellMap.blocks.b2).toMatchObject({ headerRow: 9, firstDataRow: 10 });
    expect(at(m, 'C10')?.numFmt).toBe('#,##0"원"');
    expect(m.validations.find((v) => v.address === 'B7')?.rule.type).toBe('textLength');
  });
});

describe('표형 (B5)', () => {
  test('합계 행·열 수식과 cellMap', () => {
    const m = tpl(SAMPLE.matrix);
    // input 모드라 4행 지사명 → 6행부터 표
    expect(at(m, 'B6')).toMatchObject({ value: '남', role: 'header' });
    expect(at(m, 'D6')).toMatchObject({ value: '계' });
    expect(at(m, 'A7')?.value).toBe('1학년');
    expect(at(m, 'D7')?.formula).toBe('SUM(B7:C7)');
    expect(at(m, 'A9')?.value).toBe('합계');
    expect(at(m, 'B9')?.formula).toBe('SUM(B7:B8)');
    expect(at(m, 'D9')?.formula).toBe('SUM(D7:D8)');
    expect(m.cellMap.blocks.b1).toEqual({
      kind: 'matrix', rowLabelCells: ['A7', 'A8'], colLabelCells: ['B6', 'C6'], cells: [['B7', 'C7'], ['B8', 'C8']],
    });
    expect(m.validations.map((v) => v.address)).toContain('B7:C8');
  });
});

describe('빈칸채우기형 (B6)', () => {
  test('고정·입력·빈칸', () => {
    const m = tpl(SAMPLE['fill-in']);
    expect(at(m, 'A5')).toMatchObject({ value: '교육', role: 'fixed' });
    expect(at(m, 'C5')).toMatchObject({ role: 'input', fieldKey: 'g1' });
    expect(at(m, 'B6')).toMatchObject({ role: 'fixed' });
    expect(at(m, 'B6')?.value).toBeUndefined();
    expect(m.cellMap.blocks.b1).toMatchObject({ headerRow: 4, firstRow: 5, inputCells: { g1: 'C5', g2: 'C6' }, fixedCells: { A5: '교육', B5: 900, A6: '홍보' } });
  });

  test('여유 줄: 열 규칙과 범위', () => {
    const s = clone(SAMPLE['fill-in']);
    const g = s.blocks[0];
    if (g.kind !== 'grid') throw new Error();
    g.spareRows = 3;
    g.spareColumns = [f('s1', '사업'), f('s2', '예산', { type: 'number' }), f('s3', '서울', { type: 'number' })];
    const m = tpl(s);
    expect(m.cellMap.blocks.b1).toMatchObject({ spare: { firstRow: 7, lastRow: 9 } });
    expect(at(m, 'B9')).toMatchObject({ role: 'input', fieldKey: 's2' });
    expect(m.validations.map((v) => v.address)).toContain('B7:B9');
  });
});

describe('시트 모으기형 (B7)', () => {
  test('preset: 2행 지사명·안내, 잠금·규칙·cellMap 없음', () => {
    const m = tpl(SAMPLE.collect, '부산');
    expect(m.sheetName).toBe('보고서');
    expect(at(m, 'A2')?.value).toBe('지사명');
    expect(at(m, 'B2')?.value).toBe('부산');
    expect(m.validations).toEqual([]);
    expect(m.printArea).toBe('');
    expect(m.cellMap).toEqual({ printArea: '', blocks: {} });
  });
  test('제작한 양식은 4행부터: 글자 칸은 제목 칸, 빈칸은 작성 자리', () => {
    const s = clone(SAMPLE.collect);
    s.collect = { scope: 'report', starter: [['점검 항목', '결과'], ['소화기', null]] };
    const m = tpl(s);
    expect(at(m, 'A4')).toMatchObject({ value: '점검 항목', role: 'label' });
    expect(at(m, 'A5')?.value).toBe('소화기');
    expect(at(m, 'B5')).toMatchObject({ role: 'fixed' });
    expect(at(m, 'B5')?.value).toBeUndefined();
  });
  test('none: 2행은 안내만', () => {
    const s = clone(SAMPLE.collect);
    s.org = { mode: 'none' };
    expect(at(tpl(s), 'A2')?.role).toBe('guide');
  });
});

describe('취합본 모드 (B8)', () => {
  const fill: AggregateFill = {
    autoColumns: ['지사', '담당자', '출처 파일'],
    rows: [
      { values: { name: '김민수', fee: 120000 }, auto: ['서울', '홍길동', '서울.xlsx'] },
      { values: { name: '박지훈', fee: 90000 }, auto: ['부산', '정다은', '부산.xlsx'], marks: [{ key: 'fee', mark: 'auto-fixed', note: '원래 값: 9만원' }] },
    ],
  };
  test('혼합형: 목록 칸 위치는 그대로, 자동 칸은 오른쪽 끝', () => {
    const t = tpl(SAMPLE['header-list']);
    const a = layoutSheet(SAMPLE['header-list'], { mode: 'aggregate', info: '취합일 2026-11-06 · 파일 2개', data: fill }, { today });
    const tb = t.cellMap.blocks.b2;
    const ab = a.cellMap.blocks.b2;
    expect(ab).toMatchObject({ headerRow: (tb as { headerRow: number }).headerRow, columns: (tb as { columns: object }).columns });
    expect(at(a, 'D9')).toMatchObject({ value: '지사', role: 'auto-header' });
    expect(at(a, 'F10')).toMatchObject({ value: '서울.xlsx', role: 'auto-value' });
    expect(at(a, 'C11')).toMatchObject({ value: 90000, mark: 'auto-fixed', note: '원래 값: 9만원' });
    expect(at(a, 'B6')).toMatchObject({ value: '(줄별 자동 칸 참고)', mark: 'muted' });
    expect(at(a, 'A2')?.value).toBe('취합일 2026-11-06 · 파일 2개');
    expect(a.validations).toEqual([]);
  });

  test('표형: 칸별 합과 합계 값', () => {
    const a = layoutSheet(SAMPLE.matrix, { mode: 'aggregate', info: '', data: { autoColumns: [], matrixSums: [[45, 41], [38, 40]] } }, { today });
    expect(at(a, 'B7')?.value).toBe(45);
    expect(at(a, 'D7')?.value).toBe(86);
    expect(at(a, 'B9')?.value).toBe(83);
    expect(at(a, 'D9')?.value).toBe(164);
    expect(at(a, 'D9')?.formula).toBeUndefined();
  });

  test('빈칸채우기형: 겹친 값과 출처 메모', () => {
    const a = layoutSheet(SAMPLE['fill-in'], { mode: 'aggregate', info: '', data: { autoColumns: [], grid: { g1: { value: 300, note: '출처: 서울.xlsx' } } } }, { today });
    expect(at(a, 'C5')).toMatchObject({ value: 300, note: '출처: 서울.xlsx' });
  });
});

describe('불변 조건 (B9)', () => {
  const all = (Object.keys(SAMPLE) as FormSchema['layout'][]).flatMap((k) => [tpl(SAMPLE[k]), tpl(SAMPLE[k], '서울')]);

  test.each(all.map((m, i) => [i, m] as const))('#%i cellMap 주소가 모두 cells에 있음', (_, m) => {
    const addrs = new Set(m.cells.map((c) => c.address));
    const mapAddrs: string[] = [];
    if (m.cellMap.orgCell) mapAddrs.push(m.cellMap.orgCell);
    for (const b of Object.values(m.cellMap.blocks)) {
      if (b.kind === 'fields') Object.values(b.cells).forEach((c) => mapAddrs.push(c.labelCell, c.valueCell));
      if (b.kind === 'matrix') mapAddrs.push(...b.rowLabelCells, ...b.colLabelCells, ...b.cells.flat());
      if (b.kind === 'grid') mapAddrs.push(...Object.values(b.inputCells), ...Object.keys(b.fixedCells));
      if (b.kind === 'list') Object.values(b.columns).forEach((c) => mapAddrs.push(`${c}${b.headerRow}`, `${c}${b.firstDataRow}`, `${c}${b.lastDataRow}`));
    }
    for (const a of mapAddrs) expect(addrs.has(a)).toBe(true);
  });

  test.each(all.map((m, i) => [i, m] as const))('#%i 칸 주소가 겹치지 않고, 병합끼리 겹치지 않음', (_, m) => {
    expect(new Set(m.cells.map((c) => c.address)).size).toBe(m.cells.length);
    const seen = new Set<string>();
    for (const r of m.merges) for (const a of expandRange(r)) {
      expect(seen.has(a)).toBe(false);
      seen.add(a);
    }
  });

  test.each(all.filter((m) => m.printArea).map((m, i) => [i, m] as const))('#%i 인쇄영역이 모든 입력칸을 포함', (_, m) => {
    const inArea = new Set(expandRange(m.printArea));
    for (const c of m.cells.filter((x) => x.role === 'input')) expect(inArea.has(c.address)).toBe(true);
  });

  test('같은 입력이면 같은 결과 (순수 함수)', () => {
    for (const k of Object.keys(SAMPLE) as FormSchema['layout'][]) expect(tpl(SAMPLE[k])).toEqual(tpl(SAMPLE[k]));
  });
});

describe('계산 칸', () => {
  test('목록: 같은 줄 수식, 위쪽 정보는 절대 주소', () => {
    const s = clone(SAMPLE['header-list']);
    const h = s.blocks[0];
    const l = s.blocks[1];
    if (h.kind !== 'fields' || l.kind !== 'list') throw new Error();
    h.fields.push(f('rate', '단가', { type: 'number' }));
    l.columns.push(f('qty', '수량', { type: 'number' }), f('amt', '금액', { type: 'calc', formula: '[수량] × [단가]' }));
    h.fields.push(f('tot', '총 금액', { type: 'calc', formula: '합계([금액])' }));
    const m = tpl(s);
    // 위쪽 정보 4줄(6~9행) → 목록 머리글 11행, 첫 줄 12행. 칸: B 이름, C 교육비, D 수량, E 금액
    expect(at(m, 'E12')).toMatchObject({ role: 'calc', formula: 'IFERROR(D12*$B$8,"")', note: '계산: [수량] × [단가]' });
    expect(at(m, 'E13')?.formula).toBe('IFERROR(D13*$B$8,"")');
    expect(at(m, 'B9')?.formula).toBe('IFERROR(SUM(E12:E111),"")');
    expect(m.validations.find((v) => v.address.startsWith('E'))).toBeUndefined();
  });

  test('계산식이 잘못되면 "(계산식 확인)"', () => {
    const s = clone(SAMPLE.list);
    const l = s.blocks[0];
    if (l.kind !== 'list') throw new Error();
    l.columns.push(f('bad', '오류', { type: 'calc', formula: '[없는칸] + 1' }));
    expect(at(tpl(s), 'D7')).toMatchObject({ value: '(계산식 확인)', mark: 'error' });
  });

  test('표형: 계산 열·계산 행 수식과 취합본 다시 계산', () => {
    const s = clone(SAMPLE.matrix);
    const mb = s.blocks[0];
    if (mb.kind !== 'matrix') throw new Error();
    mb.calcCols = [f('ratio', '여 비율', { type: 'calc', formula: '[여] ÷ [계] × 100', decimals: 1 })];
    mb.calcRows = [f('diff', '학년 차이', { type: 'calc', formula: '[2학년] - [1학년]' })];
    const m = tpl(s);
    // 6행 머리글: B 남, C 여, D 계, E 여 비율 / 7·8행 학년, 9행 합계, 10행 학년 차이
    expect(at(m, 'E6')).toMatchObject({ value: '여 비율', fieldKey: 'ratio' });
    expect(at(m, 'E7')?.formula).toBe('IFERROR(C7/D7*100,"")');
    expect(at(m, 'E9')?.formula).toBe('IFERROR(C9/D9*100,"")');
    expect(at(m, 'A10')?.value).toBe('학년 차이');
    expect(at(m, 'B10')?.formula).toBe('IFERROR(B8-B7,"")');
    expect(at(m, 'E10')?.formula).toBe('IFERROR(C10/D10*100,"")');
    const a = layoutSheet(s, { mode: 'aggregate', info: '', data: { autoColumns: [], matrixSums: [[45, 41], [38, 40]] } }, { today });
    expect(at(a, 'E9')?.value).toBeCloseTo((81 / 164) * 100, 5); // 합계 행 비율은 다시 계산
    expect(at(a, 'B10')?.value).toBe(-7);
    expect(at(a, 'D9')?.value).toBe(164);
  });

  test('빈칸채우기: 칸 이름으로 수식, 고정 숫자 칸도 이름으로', () => {
    const s = clone(SAMPLE['fill-in']);
    const g = s.blocks[0];
    if (g.kind !== 'grid') throw new Error();
    g.colLabels = ['사업', '예산', '서울', '잔액'];
    g.rows[0].push({ kind: 'calc', field: f('c1', '교육 · 잔액', { type: 'calc', formula: '[교육 · 예산] - [교육 · 서울]' }) });
    g.rows[1].push({ kind: 'blank' });
    const m = tpl(s);
    expect(at(m, 'D5')).toMatchObject({ role: 'calc', formula: 'IFERROR(B5-C5,"")' });
    const a = layoutSheet(s, { mode: 'aggregate', info: '', data: { autoColumns: [], grid: { g1: { value: 300 } } } }, { today });
    expect(at(a, 'D5')?.value).toBe(600);
  });
});
