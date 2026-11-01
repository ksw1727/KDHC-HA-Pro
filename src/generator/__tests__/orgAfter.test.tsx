import { fireEvent, render, screen } from '@testing-library/react';
import { SAMPLE, f } from '@contract/__tests__/fixtures';
import { layoutSheet } from '@contract/layout/layoutEngine';
import { validateSchema, type FormSchema, type ListBlock } from '@contract/schema';
import type { AggregateFill } from '@contract/layout/sheetModel';
import { formReducer } from '@gen/state/formReducer';
import { AggPanel } from '@gen/builder/AggPanel';
import type { Builder } from '@gen/state/useBuilder';

/** 목록형: 구분 · 관경 · 사용자명, 제출처 서울·부산 */
const listForm = (orgAfter?: string): FormSchema => {
  const s = structuredClone(SAMPLE.list);
  const b = s.blocks[0] as ListBlock;
  b.columns = [f('kind', '구분'), f('size', '관경'), f('user', '사용자명')];
  if (orgAfter !== undefined) b.orgAfter = orgAfter;
  return s;
};
const fill = (auto: string[], rows: [string, string, string, ...(string | number)[]][]): AggregateFill => ({
  autoColumns: auto,
  rows: rows.map(([kind, size, user, ...a]) => ({ values: { kind, size, user }, auto: a })),
});
/** 머리글 줄(번호가 있는 줄)의 글자를 열 순서대로 */
const headerRow = (s: FormSchema, data: AggregateFill) => {
  const m = layoutSheet(s, { mode: 'aggregate', info: '', data }, { today: new Date('2026-11-01') });
  const no = m.cells.find((c) => c.value === '번호')!;
  const row = no.address.replace(/^[A-Z]+/, '');
  const cells = m.cells.filter((c) => c.address.replace(/^[A-Z]+/, '') === row).sort((a, b) => a.address.length - b.address.length || a.address.localeCompare(b.address));
  return { head: cells.map((c) => c.value), m, row: +row };
};

test('취합본: 제출처 칸은 기본으로 맨 뒤(예전과 같음), 검토용 칸은 늘 그 뒤', () => {
  const { head } = headerRow(listForm(), fill(['지사', '출처 파일', '원본 줄', '상태'], [['교체', '50A', '김OO', '서울', 'a.xlsx', 7, '']]));
  expect(head).toEqual(['번호', '구분', '관경', '사용자명', '지사', '출처 파일', '원본 줄', '상태']);
});

test("취합본: orgAfter ''는 번호 바로 다음, 항목 key는 그 항목 다음. 값도 같은 열에 들어가고 셀 지도도 따라간다", () => {
  const data = fill(['지사', '출처 파일', '원본 줄', '상태'], [['교체', '50A', '김OO', '서울', 'a.xlsx', 7, '']]);
  const first = headerRow(listForm(''), data);
  expect(first.head).toEqual(['번호', '지사', '구분', '관경', '사용자명', '출처 파일', '원본 줄', '상태']);
  const val = (addr: string) => first.m.cells.find((c) => c.address === addr)?.value;
  expect(val(`B${first.row + 1}`)).toBe('서울');
  expect(val(`C${first.row + 1}`)).toBe('교체');
  expect(first.m.cellMap.blocks.b1).toMatchObject({ columns: { kind: 'C', size: 'D', user: 'E' } });
  expect(headerRow(listForm('kind'), data).head).toEqual(['번호', '구분', '지사', '관경', '사용자명', '출처 파일', '원본 줄', '상태']);
});

test('혼합형: 머리정보 반복 칸(담당자·연락처)은 제출처 칸 바로 뒤에 같이 붙는다', () => {
  const s = structuredClone(SAMPLE['header-list']);
  (s.blocks[1] as ListBlock).orgAfter = '';
  const data: AggregateFill = { autoColumns: ['지사', '담당자', '연락처', '출처 파일'], rows: [{ values: { name: '김', fee: 1000 }, auto: ['서울', '박', '010', 'a.xlsx'] }] };
  expect(headerRow(s, data).head).toEqual(['번호', '지사', '담당자', '연락처', '이름 *', '교육비', '출처 파일']);
});

test('계약: orgAfter는 \'\' 또는 목록 항목 key만', () => {
  expect(validateSchema(listForm('')).ok).toBe(true);
  expect(validateSchema(listForm('size')).ok).toBe(true);
  const bad = validateSchema(listForm('nope'));
  expect(bad.ok).toBe(false);
});

test('항목을 지우면 제출처 칸은 그 앞 항목 다음으로(첫 항목이면 맨 앞), list/set은 없는 key를 받지 않는다', () => {
  let s = formReducer(listForm('size'), { type: 'field/remove', blockId: 'b1', key: 'size' });
  expect((s.blocks[0] as ListBlock).orgAfter).toBe('kind');
  s = formReducer(s, { type: 'field/remove', blockId: 'b1', key: 'kind' });
  expect((s.blocks[0] as ListBlock).orgAfter).toBe('');
  s = formReducer(s, { type: 'list/set', blockId: 'b1', patch: { orgAfter: 'nope' } });
  expect((s.blocks[0] as ListBlock).orgAfter).toBe('');
  s = formReducer(s, { type: 'list/set', blockId: 'b1', patch: { orgAfter: null } });
  expect((s.blocks[0] as ListBlock).orgAfter).toBeUndefined();
});

test('④ 취합 방식: 순서 띠에 제출처 이름으로 칸이 보이고, ◀ ▶로 옮긴다', () => {
  let schema = listForm();
  schema.org = { ...schema.org, label: '사업소' };
  const acts: unknown[] = [];
  const b = { schema, act: (a: Parameters<typeof formReducer>[1]) => { acts.push(a); schema = formReducer(schema, a); } } as unknown as Builder;
  const view = render(<AggPanel b={b} />);
  expect(screen.getByText(/사업소 칸 맨 뒤/)).toBeTruthy();   // 접힌 요약
  fireEvent.click(screen.getByRole('button', { name: '바꾸기' }));
  expect(screen.getByLabelText('취합본 열 순서, 사업소 칸 맨 뒤')).toBeTruthy();
  expect((screen.getByRole('button', { name: '사업소 칸 오른쪽으로' }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: '사업소 칸 왼쪽으로' }));
  expect(acts.at(-1)).toEqual({ type: 'list/set', blockId: 'b1', patch: { orgAfter: 'size' } });
  view.rerender(<AggPanel b={{ ...b, schema } as Builder} />);
  expect(screen.getByLabelText('취합본 열 순서, 사업소 칸 관경 다음')).toBeTruthy();
});
