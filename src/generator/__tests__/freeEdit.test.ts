import { applyFreeOp, rectOf } from '../state/freeEdit';
import { formReducer } from '../state/formReducer';
import { changeLayout } from '../state/changeLayout';
import { newSchema } from '../state/newSchema';
import { freeRegions } from '@contract/free';
import { validateSchema, type FormSchema } from '@contract/schema';
import { SAMPLE } from '@contract/__tests__/fixtures';

let n = 0;
const key = () => `k${++n}`;
const keys = () => Array.from({ length: 10 }, key);
const fresh = (): FormSchema => ({ ...newSchema('free', new Date('2026-10-13'), { formId: 'id', key }), org: { mode: 'preset', orgs: ['서울'], label: '지사' } });
const ok = (r: ReturnType<typeof applyFreeOp>): FormSchema => { if (!r.schema) throw new Error(r.error); return r.schema; };

describe('자유 제작형 판 편집', () => {
  test('새 양식: 담당자 입력 칸 + 입력 줄 영역, 계약 통과', () => {
    const s = fresh();
    expect(validateSchema(s).ok).toBe(true);
    expect(freeRegions(s).map((g) => g.kind)).toEqual(['fields', 'list']);
  });

  test('글자 쓰기 → 입력 칸 지정: 왼쪽 글자가 이름, 영역 안 글자는 막음', () => {
    let s = ok(applyFreeOp(fresh(), { op: 'text', at: 'C1', value: '점검일' }));
    s = ok(applyFreeOp(s, { op: 'mark', kind: 'fields', rect: rectOf('D1'), keys: keys() }));
    const f = s.blocks[0].kind === 'fields' ? s.blocks[0].fields : [];
    expect(f.map((x) => x.label)).toEqual(['담당자', '점검일']);
    expect(s.free!.places[f[1].key]).toBe('D1');
    expect(applyFreeOp(s, { op: 'text', at: 'D1', value: 'x' }).error).toContain('영역 안에는');
    expect(validateSchema(s).ok).toBe(true);
  });

  test('입력 줄 영역: 윗줄 글자가 머리글, 아래 줄 수 = 입력 줄', () => {
    let s = ok(applyFreeOp(fresh(), { op: 'unmark', rect: rectOf('A3') }));
    expect(s.free!.texts.A3).toBe('항목');   // 풀면 머리글이 글자 칸으로 돌아온다
    s = ok(applyFreeOp(s, { op: 'mark', kind: 'list', rect: rectOf('A3', 'B6'), keys: keys() }));
    const list = s.blocks.find((b) => b.kind === 'list');
    expect(list).toMatchObject({ kind: 'list', maxRows: 3, columns: [{ label: '항목' }, { label: '내용' }] });
    expect(s.free!.texts.A3).toBeUndefined();
  });

  test('숫자 표: 윗줄 열 제목, 왼쪽 행 제목, 왼쪽 위 = 이름. 줄 영역이 없으면 지사별 펼치기 필수', () => {
    let s = ok(applyFreeOp(fresh(), { op: 'unmark', rect: rectOf('A3', 'B8') }));
    s = { ...s, free: { ...s.free!, texts: {} } };
    s = ok(applyFreeOp(s, { op: 'text', at: 'A3', value: '불량 현황' }));
    s = ok(applyFreeOp(s, { op: 'text', at: 'B3', value: '소화기' }));
    s = ok(applyFreeOp(s, { op: 'text', at: 'A4', value: '불량 수' }));
    s = ok(applyFreeOp(s, { op: 'mark', kind: 'matrix', rect: rectOf('A3', 'C4'), keys: keys() }));
    expect(s.blocks.find((b) => b.kind === 'matrix')).toMatchObject({ title: '불량 현황', colLabels: ['소화기', '열 2'], rowLabels: ['불량 수'] });
    expect(s.aggregations).toContain('spread');
    expect(validateSchema(s).ok).toBe(true);
    expect(applyFreeOp(s, { op: 'mark', kind: 'matrix', rect: rectOf('E1', 'E5'), keys: keys() }).error).toContain('2행 2열');
  });

  test('겹치는 지정·옮기기·합치기는 이유를 알려 준다', () => {
    const s = fresh();
    expect(applyFreeOp(s, { op: 'mark', kind: 'list', rect: rectOf('A2', 'B4'), keys: keys() }).error).toContain('먼저 지정을 풀어');
    const list = freeRegions(s).find((g) => g.kind === 'list')!;
    expect(applyFreeOp(s, { op: 'move', blockId: list.blockId, to: 'A1' }).error).toContain('영역이 있어요');
    expect(applyFreeOp(s, { op: 'merge', rect: rectOf('A3', 'B3') }).error).toContain('합칠 수 없어요');
    const moved = ok(applyFreeOp(s, { op: 'move', blockId: list.blockId, to: 'C3' }));
    expect(moved.free!.places[list.blockId]).toBe('C3');
    const merged = ok(applyFreeOp({ ...s, free: { ...s.free!, texts: { A1: '담당자', A2: '지움' } } }, { op: 'merge', rect: rectOf('C1', 'E2') }));
    expect(merged.free!.merges).toEqual(['C1:E2']);
  });

  test('리듀서: 입력 칸 항목을 지우면 자리도 지운다, 구조 바꾸기 왕복', () => {
    const s = fresh();
    const f = s.blocks[0].kind === 'fields' ? s.blocks[0].fields[0] : null;
    const next = formReducer(s, { type: 'field/remove', blockId: 'b1', key: f!.key });
    expect(next.blocks.map((b) => b.kind)).toEqual(['list']);
    expect(validateSchema(next).ok).toBe(true);

    const toFree = changeLayout(SAMPLE['header-list'], 'free', key).schema;
    expect(validateSchema(toFree).ok).toBe(true);
    expect(toFree.free!.texts).toMatchObject({ A1: '담당자', A2: '연락처' });
    expect(freeRegions(toFree).find((g) => g.kind === 'list')).toMatchObject({ r1: 4, c1: 1 });
    const back = changeLayout(toFree, 'header-list', key).schema;
    expect(back.free).toBeUndefined();
    expect(validateSchema(back).ok).toBe(true);
  });
});
