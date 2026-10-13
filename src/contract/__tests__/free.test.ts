import { layoutSheet } from '../layout';
import { freeAggregationChecks, freeProblems, freeRegions } from '../free';
import { validateSchema, type FormSchema } from '../schema';
import { requiredAggregations } from '../aggregationIds';
import { SAMPLE } from './fixtures';

const today = new Date('2026-10-13T00:00:00');
const clone = <T,>(x: T): T => structuredClone(x);
const cell = (m: ReturnType<typeof layoutSheet>, a: string) => m.cells.find((c) => c.address === a);

describe('자유 제작형 (free)', () => {
  test('계약 검사 통과', () => {
    expect(validateSchema(SAMPLE.free)).toMatchObject({ ok: true });
    const bad = clone(SAMPLE.free);
    delete bad.free!.places.b3;
    expect(validateSchema(bad)).toMatchObject({ ok: false });
  });

  test('영역: 판 좌표', () => {
    expect(freeRegions(SAMPLE.free).map((r) => [r.kind, r.r1, r.c1, r.r2, r.c2])).toEqual([
      ['fields', 1, 2, 1, 2], ['fields', 1, 4, 1, 4], ['matrix', 3, 1, 4, 4], ['list', 6, 1, 11, 3],
    ]);
  });

  test('빈 양식: 판 A1 = 6행, 글자·입력·숫자 표·줄 영역이 제자리에, 셀 지도는 기존 모양', () => {
    const m = layoutSheet(SAMPLE.free, { mode: 'template', orgName: '서울' }, { today });
    expect(cell(m, 'A6')).toMatchObject({ value: '점검자', role: 'label' });
    expect(cell(m, 'B6')).toMatchObject({ role: 'input', required: true, fieldKey: 'insp' });
    expect(cell(m, 'B8')).toMatchObject({ value: '소화기', role: 'header' });
    expect(cell(m, 'A9')).toMatchObject({ value: '불량 수' });
    expect(cell(m, 'D9')?.formula).toBe('SUM(B9:C9)');
    expect(cell(m, 'A11')).toMatchObject({ value: '항목 *', role: 'header' });
    expect(cell(m, 'C16')).toMatchObject({ role: 'input', fieldKey: 'cost' });
    expect(m.cellMap.blocks).toEqual({
      b1: { kind: 'fields', cells: { insp: { labelCell: 'A6', valueCell: 'B6' }, day: { labelCell: 'C6', valueCell: 'D6' } } },
      b2: { kind: 'matrix', rowLabelCells: ['A9'], colLabelCells: ['B8', 'C8'], cells: [['B9', 'C9']] },
      b3: { kind: 'list', headerRow: 11, firstDataRow: 12, lastDataRow: 16, columns: { item: 'A', res: 'B', cost: 'C' } },
    });
    expect(m.printArea).toBe('A1:E16');
    expect(m.validations.some((v) => v.address === 'B12:B16')).toBe(true);
  });

  test('같은 틀 시트: 입력 칸은 흐리게, 줄은 이어 붙고 자동 칸은 줄 영역 오른쪽', () => {
    const m = layoutSheet(SAMPLE.free, {
      mode: 'aggregate', info: '취합',
      data: { autoColumns: ['지사', '점검자'], rows: [{ values: { item: '소화기' }, auto: ['서울', '홍길동'] }], matrixSumsBy: { b2: [[3, 4]] } },
    }, { today });
    expect(cell(m, 'B6')).toMatchObject({ value: '(줄별 자동 칸 참고)', mark: 'muted' });
    expect(cell(m, 'D11')).toMatchObject({ value: '지사', role: 'auto-header' });
    expect(cell(m, 'A12')).toMatchObject({ value: '소화기' });
    expect(cell(m, 'D9')).toMatchObject({ value: 7 });
  });

  test('줄 영역이 없으면 입력 칸은 지사별 시트로, 지사별 펼치기가 필수', () => {
    const s = clone(SAMPLE.free);
    s.blocks = s.blocks.slice(0, 2);
    delete s.free!.places.b3;
    expect(requiredAggregations(s)).toEqual(['same-frame', 'spread']);
    const m = layoutSheet(s, { mode: 'aggregate', info: '', data: { autoColumns: [] } }, { today });
    expect(cell(m, 'B6')?.value).toBe('(지사별 시트 참고)');
    expect(requiredAggregations(SAMPLE.free)).toEqual(['same-frame']);
  });
});

describe('자유 제작형 취합 검사', () => {
  const check = (s: FormSchema, id: string) => freeAggregationChecks(s).find((c) => c.id === id)!;

  test('샘플은 모두 가능, 펼치기는 입력 칸·숫자 표·줄 수', () => {
    expect(freeAggregationChecks(SAMPLE.free).map((c) => c.status)).toEqual(['ok', 'ok', 'ok', 'ok']);
    expect(check(SAMPLE.free, 'spread').why).toContain('점검 내역');
    expect(freeProblems(SAMPLE.free)).toEqual([]);
  });

  test('줄 영역 아래 입력 칸 → 고치면 됨, 어디를 고칠지', () => {
    const s = clone(SAMPLE.free);
    s.free!.places.day = 'B13';
    s.free!.texts.A13 = '확인자';
    const c = check(s, 'same-frame');
    expect(c.status).toBe('fix');
    expect(c.why).toContain('덮어써요');
    expect(c.at).toMatchObject({ key: 'day' });
  });

  test('줄 영역 오른쪽 글자 칸, 줄 영역 2개', () => {
    const s = clone(SAMPLE.free);
    s.free!.texts.E7 = '메모';
    expect(check(s, 'same-frame')).toMatchObject({ status: 'fix', at: { cell: 'E7' } });
    const two = clone(SAMPLE.free);
    two.blocks.push({ kind: 'list', id: 'b4', maxRows: 2, columns: [{ key: 'x', label: '비고', type: 'text', required: false }] });
    two.free!.places.b4 = 'A14';
    expect(check(two, 'same-frame').why).toContain('2개');
  });

  test('줄 영역만 있으면 펼치기는 안 됨', () => {
    const s = clone(SAMPLE.free);
    s.blocks = [s.blocks[2]];
    s.blocks[0].id = 'b1';
    s.free = { rows: 6, cols: 3, texts: {}, merges: [], places: { b1: 'A1' } };
    expect(check(s, 'spread')).toMatchObject({ status: 'no' });
  });

  test('공통 문제: 겹침, 영역 안 글자, 영역 걸친 합치기, 영역 없음', () => {
    const s = clone(SAMPLE.free);
    s.free!.places.insp = 'A7';
    s.free!.texts.B9 = '?';
    s.free!.merges = ['A4:B4'];
    const msgs = freeProblems(s).map((p) => p.message).join('\n');
    expect(msgs).toContain('겹쳐요');
    expect(msgs).toContain('B9에 글자 칸');
    expect(msgs).toContain('A4:B4');
    expect(freeProblems({ ...s, blocks: [], free: { rows: 3, cols: 3, texts: {}, merges: [], places: {} } })[0].message).toBe('입력 영역이 없어요.');
  });
});
