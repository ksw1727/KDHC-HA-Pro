import { newSchema, defaultAggregations } from '../state/newSchema';
import { formReducer, nextLabel } from '../state/formReducer';
import { changeLayout } from '../state/changeLayout';
import { patchField } from '../state/fieldDefaults';
import { structureKey, nextVersion, diffSummary } from '../state/versioning';
import { validateForExport } from '../state/validateForExport';
import { saveForm, loadForm, loadCurrent, listForms } from '../storage/localForms';
import { validateSchema, type FormSchema, type Layout } from '@contract/schema';

const now = new Date('2026-10-13T05:00:00Z');
const keyGen = () => {
  let n = 0;
  return () => `f_${String(++n).padStart(4, '0')}`;
};
const make = (layout: Layout) => newSchema(layout, now, { formId: 'form-1', key: keyGen() });
const ready = (layout: Layout): FormSchema => {
  const s = make(layout);
  s.title = '조사';
  s.org.orgs = ['서울', '부산'];
  return s;
};

describe('새 양식 (C1)', () => {
  test.each(['list', 'header-list', 'matrix', 'fill-in', 'collect'] as Layout[])('%s 기본 양식은 지사만 넣으면 계약을 지킨다', (layout) => {
    const r = validateSchema(ready(layout));
    expect(r.ok ? [] : r.errors).toEqual([]);
  });
  test('기본 취합 방식', () => {
    expect(make('matrix').aggregations).toEqual(['same-frame', 'spread', 'submission-status']);
    expect(make('collect').aggregations).toEqual(['collect-sheets', 'submission-status']);
    expect(defaultAggregations({ layout: 'list', org: { mode: 'none' } })).toEqual(['same-frame']);
  });
  test('혼합형 기본 블록', () => {
    const s = make('header-list');
    expect(s.blocks.map((b) => b.kind)).toEqual(['fields', 'list']);
    expect(s.org.label).toBe('지사');
  });
});

describe('편집 동작 (C2)', () => {
  test('항목 추가: 기본 이름, after 위치', () => {
    let s = make('list');
    s = formReducer(s, { type: 'field/add', blockId: 'b1', key: 'k2', fieldType: 'number' });
    s = formReducer(s, { type: 'field/add', blockId: 'b1', key: 'k3', fieldType: 'date', after: 'f_0001' });
    const b = s.blocks[0];
    if (b.kind !== 'list') throw new Error();
    expect(b.columns.map((c) => c.key)).toEqual(['f_0001', 'k3', 'k2']);
    expect(b.columns[2]).toMatchObject({ label: '항목 2', type: 'number', thousands: true });
  });
  test('nextLabel은 겹치지 않음', () => {
    expect(nextLabel([{ key: 'a', label: '항목 2', type: 'text', required: false }])).toBe('항목 3');
  });
  test('타입을 바꾸면 이전 서식이 지워짐', () => {
    const f = patchField({ key: 'a', label: '수량', type: 'number', required: false, unit: '개', min: 0 }, { type: 'select' });
    expect(f).toEqual({ key: 'a', label: '수량', type: 'select', required: false, options: [] });
  });
  test('수정·삭제·이동', () => {
    let s = make('list');
    s = formReducer(s, { type: 'field/add', blockId: 'b1', key: 'k2', fieldType: 'text' });
    s = formReducer(s, { type: 'field/update', blockId: 'b1', key: 'k2', patch: { label: '직급', required: true } });
    s = formReducer(s, { type: 'field/move', blockId: 'b1', from: 1, to: 0 });
    let b = s.blocks[0];
    if (b.kind !== 'list') throw new Error();
    expect(b.columns.map((c) => c.label)).toEqual(['직급', '이름']);
    s = formReducer(s, { type: 'field/remove', blockId: 'b1', key: 'k2' });
    b = s.blocks[0];
    if (b.kind !== 'list') throw new Error();
    expect(b.columns.map((c) => c.label)).toEqual(['이름']);
  });
  test('표형 칸 수정은 숫자로 유지', () => {
    let s = make('matrix');
    const key = (s.blocks[0] as { cell: { key: string } }).cell.key;
    s = formReducer(s, { type: 'field/update', blockId: 'b1', key, patch: { type: 'text', unit: '명' } });
    expect((s.blocks[0] as { cell: object }).cell).toMatchObject({ type: 'number', unit: '명' });
  });
  test('입력 줄 수는 1~5000', () => {
    let s = make('list');
    s = formReducer(s, { type: 'list/set', blockId: 'b1', patch: { maxRows: 99999 } });
    expect((s.blocks[0] as { maxRows: number }).maxRows).toBe(5000);
  });
  test('필수 취합 방식은 끌 수 없음', () => {
    const s = make('matrix');
    expect(formReducer(s, { type: 'agg/toggle', id: 'spread' })).toBe(s);
    expect(formReducer(s, { type: 'agg/toggle', id: 'submission-status' }).aggregations).toEqual(['same-frame', 'spread']);
  });
  test('식별 안 함으로 바꾸면 제출 현황표가 빠지고, 되돌리면 다시 켜짐', () => {
    let s = make('list');
    s = formReducer(s, { type: 'org/set', patch: { mode: 'none' } });
    expect(s.aggregations).toEqual(['same-frame']);
    s = formReducer(s, { type: 'org/set', patch: { mode: 'preset' } });
    expect(s.aggregations).toEqual(['same-frame', 'submission-status']);
  });
  test('지사 목록: 공백·중복·빈 줄 정리', () => {
    const s = formReducer(make('list'), { type: 'org/set', patch: { orgs: [' 서울', '부산', '', '서울'] } });
    expect(s.org.orgs).toEqual(['서울', '부산']);
  });
  test('시트 모으기형은 지사명 입력 불가', () => {
    const s = formReducer(make('collect'), { type: 'org/set', patch: { mode: 'input' } });
    expect(s.org.mode).toBe('preset');
  });
});

describe('구조 바꾸기 (C2-1)', () => {
  test('혼합형 → 목록형: 위쪽 정보가 지워짐', () => {
    const r = changeLayout(make('header-list'), 'list', keyGen());
    expect(r.lost.map((f) => f.label)).toEqual(['담당자']);
    expect(r.schema.blocks).toHaveLength(1);
    expect(r.schema.blocks[0].id).toBe('b1');
  });
  test('목록형 → 혼합형: 목록 칸 유지, 위쪽 정보는 기본값', () => {
    const r = changeLayout(make('list'), 'header-list', () => 'new');
    expect(r.lost).toEqual([]);
    expect(r.schema.blocks.map((b) => b.kind)).toEqual(['fields', 'list']);
    expect((r.schema.blocks[1] as { columns: { key: string }[] }).columns[0].key).toBe('f_0001');
  });
  test('표형 → 목록형: 행·열 제목이 사라진다고 알림', () => {
    const r = changeLayout(make('matrix'), 'list', keyGen());
    expect(r.lostNotes[0]).toMatch(/행 제목 2개/);
    expect(r.schema.aggregations).toEqual(['same-frame', 'submission-status']);
  });
  test('시트 모으기형으로: collect 설정 생김, 취합 방식 바뀜', () => {
    const r = changeLayout(make('list'), 'collect', keyGen());
    expect(r.schema.collect).toEqual({ scope: 'report' });
    expect(r.schema.blocks).toEqual([]);
    expect(r.schema.aggregations).toEqual(['collect-sheets', 'submission-status']);
  });
});

describe('버전 (C3)', () => {
  test('제목만 바꾸면 유지, 항목 추가·선택지 변경은 +1, 지사 목록은 유지', () => {
    const v1 = ready('list');
    expect(nextVersion({ ...v1, title: '다른 제목' }, v1)).toBe(1);
    expect(nextVersion(formReducer(v1, { type: 'org/set', patch: { orgs: ['대구'] } }), v1)).toBe(1);
    const added = formReducer(v1, { type: 'field/add', blockId: 'b1', key: 'k9', fieldType: 'select' });
    expect(nextVersion(added, v1)).toBe(2);
    const opts = formReducer(added, { type: 'field/update', blockId: 'b1', key: 'k9', patch: { options: ['a'] } });
    expect(structureKey(opts)).not.toBe(structureKey(added));
  });
  test('바뀐 점 요약', () => {
    const v1 = ready('list');
    let v2 = formReducer(v1, { type: 'field/add', blockId: 'b1', key: 'k9', fieldType: 'number', label: '교육비' });
    v2 = formReducer(v2, { type: 'field/update', blockId: 'b1', key: 'f_0001', patch: { label: '성명' } });
    expect(diffSummary(v1, v2)).toEqual(['이름 → 성명 이름 변경', '교육비 항목 추가']);
  });
  test('내보낸 적이 없으면 현재 버전', () => {
    expect(nextVersion(ready('list'))).toBe(1);
  });
});

describe('내보내기 전 검사 (C4)', () => {
  test('정상 양식은 문제 없음', () => {
    for (const l of ['list', 'header-list', 'matrix', 'fill-in', 'collect'] as Layout[]) expect(validateForExport(ready(l))).toEqual([]);
  });
  test('제목·지사 목록·선택지·중복·최소최대', () => {
    let s = make('list');
    s = formReducer(s, { type: 'field/add', blockId: 'b1', key: 'a', fieldType: 'select', label: '직급' });
    s = formReducer(s, { type: 'field/add', blockId: 'b1', key: 'b', fieldType: 'number', label: '이름' });
    s = formReducer(s, { type: 'field/update', blockId: 'b1', key: 'b', patch: { min: 10, max: 1 } });
    const msgs = validateForExport(s).map((p) => `${p.where}:${p.key ?? ''}:${p.message}`);
    expect(msgs).toEqual([
      'meta::제목을 입력해 주세요.',
      'fields:a:직급: 선택지가 비어 있어요. 1개 이상 넣어 주세요.',
      'fields:b:"이름" 항목이 두 번 있어요. 이름을 바꿔 주세요.',
      'fields:b:이름: 최소값이 최대값보다 커요.',
      'org::지사 목록이 비어 있어요. 목록을 넣거나 "식별 안 함"을 골라 주세요.',
    ]);
  });
  test('부서로 부르면 문구도 부서', () => {
    const s = formReducer({ ...make('list'), title: 'x' }, { type: 'org/set', patch: { label: '부서' } });
    expect(validateForExport(s)[0].message).toMatch(/^부서 목록/);
  });
  test('빈칸채우기: 입력칸 없음', () => {
    const s = ready('fill-in');
    s.blocks[0] = { ...(s.blocks[0] as object), rows: [[{ kind: 'fixed', value: 'a' }, { kind: 'blank' }, { kind: 'blank' }]] } as FormSchema['blocks'][0];
    expect(validateForExport(s).map((p) => p.message)).toEqual(['입력칸을 1개 이상 지정하거나 여유 줄을 넣어 주세요.']);
  });
});

describe('자동 저장 (C5)', () => {
  beforeEach(() => localStorage.clear());
  test('저장·불러오기·현재 양식·목록', () => {
    const s = ready('list');
    expect(saveForm({ schema: s }, now)).toBe(true);
    expect(loadForm('form-1')?.schema.title).toBe('조사');
    expect(loadCurrent()?.schema.formId).toBe('form-1');
    expect(listForms()).toHaveLength(1);
  });
  test('저장소가 망가져도 예외를 던지지 않음', () => {
    localStorage.setItem('hanan-moa:forms:bad', '{');
    expect(loadForm('bad')).toBeNull();
  });
});

describe('계산 칸 (상태)', () => {
  const withCalc = () => {
    let s = ready('list');
    s = formReducer(s, { type: 'field/add', blockId: 'b1', key: 'q', fieldType: 'number', label: '수량' });
    s = formReducer(s, { type: 'field/add', blockId: 'b1', key: 'c', fieldType: 'calc', label: '두배' });
    return formReducer(s, { type: 'field/update', blockId: 'b1', key: 'c', patch: { formula: '[수량] × 2' } });
  };
  test('계산 타입 기본값: 빈 계산식, 필수 아님', () => {
    const b = withCalc().blocks[0];
    if (b.kind !== 'list') throw new Error();
    expect(b.columns[2]).toMatchObject({ type: 'calc', required: false, thousands: true, decimals: 0 });
  });
  test('항목 이름을 바꾸면 계산식도 바뀜', () => {
    const s = formReducer(withCalc(), { type: 'field/update', blockId: 'b1', key: 'q', patch: { label: '개수' } });
    const b = s.blocks[0];
    if (b.kind !== 'list') throw new Error();
    expect(b.columns[2].formula).toBe('[개수] × 2');
  });
  test('내보내기 전 검사: 계산식 오류를 그 항목 위치로', () => {
    const s = formReducer(withCalc(), { type: 'field/update', blockId: 'b1', key: 'c', patch: { formula: '[없음] + 1' } });
    expect(validateForExport(s)).toEqual([{ where: 'fields', blockId: 'b1', key: 'c', message: '두배: [없음] 칸을 찾을 수 없어요.' }]);
  });
  test('표형 계산 열 이름이 열 제목과 같으면 안 됨', () => {
    let s = ready('matrix');
    s = formReducer(s, { type: 'matrix/set', blockId: 'b1', patch: { calcCols: [{ key: 'k', label: '1열', type: 'calc', required: false, formula: '[2열] × 2' }] } });
    expect(validateForExport(s).map((p) => p.message)).toContain('1열: 열 제목과 이름이 같아요. 다른 이름을 써 주세요.');
  });
});
