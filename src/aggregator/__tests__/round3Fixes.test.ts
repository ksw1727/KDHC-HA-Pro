// @vitest-environment node
// 3차 시험에서 찾은 문제(고칠1~4, 작은 것들)가 다시 생기지 않게
import { SAMPLE, f } from '@contract/__tests__/fixtures';
import type { FormSchema } from '@contract/schema';
import { analyze, patchCopies } from '../pipeline/run';
import { resolve } from '../pipeline/resolve';
import { normalize } from '../pipeline/normalize';
import { emptyDecisions } from '../pipeline/types';
import { computeSubmission } from '../pipeline/aggregate';
import { firstRow, listCol, makeFile, NOW } from './makeFile';

const ctx = { year: 2026, today: NOW };

async function run(files: Awaited<ReturnType<typeof makeFile>>[], d = emptyDecisions()) {
  const a = await analyze(files, [], null, NOW);
  return { a, res: resolve(a.base!.schema, a.identified, a.parsed, d, ctx) };
}

describe('고칠1 · 위쪽 계산 칸이 목록 계산 열을 쓸 때', () => {
  const schema: FormSchema = {
    ...structuredClone(SAMPLE['header-list']),
    blocks: [
      { kind: 'fields', id: 'b1', fields: [f('manager', '담당자'), f('tot', '총 금액', { type: 'calc', formula: '합계([금액])' })] },
      { kind: 'list', id: 'b2', maxRows: 10, columns: [f('name', '이름', { required: true }), f('qty', '수량', { type: 'number' }), f('price', '단가', { type: 'number' }), f('amt', '금액', { type: 'calc', formula: '[수량] × [단가]' })] },
    ],
  };
  test('목록 계산 열을 먼저 계산한 뒤 위쪽 합계를 낸다 (0이 아니라 실제 합)', async () => {
    const file = await makeFile(schema, '서울.xlsx', { orgName: '서울', fill: (ws, m) => {
      ws.getCell(`${listCol(m, 'name', 'b2')}${firstRow(m, 'b2')}`).value = '김';
      ws.getCell(`${listCol(m, 'qty', 'b2')}${firstRow(m, 'b2')}`).value = 2;
      ws.getCell(`${listCol(m, 'price', 'b2')}${firstRow(m, 'b2')}`).value = 1500;
      ws.getCell(`${listCol(m, 'name', 'b2')}${firstRow(m, 'b2') + 1}`).value = '이';
      ws.getCell(`${listCol(m, 'qty', 'b2')}${firstRow(m, 'b2') + 1}`).value = 1;
      ws.getCell(`${listCol(m, 'price', 'b2')}${firstRow(m, 'b2') + 1}`).value = 700;
    } });
    const { res } = await run([file]);
    const s = res.included[0];
    const calc = computeSubmission(schema, s.header, s.rows.map((r) => r.values));
    expect(calc.header.tot).toBe(3700);
    expect(calc.rows.map((r) => r.amt)).toEqual([3000, 700]);
  });
});

describe('고칠2 · 예시 줄', () => {
  const schema: FormSchema = {
    ...structuredClone(SAMPLE.list),
    blocks: [{ kind: 'list', id: 'b1', maxRows: 10, exampleRow: { name: '홍길동', qty: 1 }, columns: [f('name', '이름', { required: true }), f('qty', '수량', { type: 'number' })] }],
  };
  test('예시 그대로면 빼고, 실제 값으로 덮어 썼으면 데이터로 읽고 알린다', async () => {
    const untouched = await makeFile(schema, '서울.xlsx', { orgName: '서울', fill: (ws, m) => {
      ws.getCell(`${listCol(m, 'name')}${firstRow(m)}`).value = '김';
      ws.getCell(`${listCol(m, 'qty')}${firstRow(m)}`).value = 3;
    } });
    const overwritten = await makeFile(schema, '부산.xlsx', { orgName: '부산', fill: (ws, m) => {
      const ex = m.cellMap.blocks.b1.kind === 'list' ? m.cellMap.blocks.b1.exampleRow! : 0;
      ws.getCell(`${listCol(m, 'name')}${ex}`).value = '박';
      ws.getCell(`${listCol(m, 'qty')}${ex}`).value = 5;
    } });
    const { a, res } = await run([untouched, overwritten]);
    const by = (org: string) => res.included.find((s) => s.org === org)!;
    expect(by('서울').rows.map((r) => r.values.name)).toEqual(['김']);
    expect(by('부산').rows.map((r) => [r.values.name, r.values.qty])).toEqual([['박', 5]]);
    const busan = a.parsed.find((p) => p.org === '부산')!;
    expect(busan.read.infos.map((i) => i.code)).toContain('EXAMPLE_ROW_USED');
    expect(a.parsed.find((p) => p.org === '서울')!.read.excludedRows.map((x) => x.reason)).toContain('example');
  });
});

describe('고칠3 · 표형 행 제목을 고쳐 쓴 파일', () => {
  const schema: FormSchema = {
    ...structuredClone(SAMPLE.matrix),
    blocks: [{ kind: 'matrix', id: 'b1', rowLabels: ['1분기', '2분기'], colLabels: ['남', '여'], cell: f('cnt', '인원', { type: 'number' }), totalRow: false, totalCol: false }],
  };
  test('제목만 바뀌고 자리가 같으면 그 자리 값을 읽는다', async () => {
    const file = await makeFile(schema, '서울.xlsx', { orgName: '서울', unprotected: true, fill: (ws, m) => {
      const mm = m.cellMap.blocks.b1;
      if (mm.kind !== 'matrix') throw new Error();
      ws.getCell(mm.rowLabelCells[0]).value = '1/4분기';
      ws.getCell(mm.cells[0][0]).value = 3;
      ws.getCell(mm.cells[0][1]).value = 4;
      ws.getCell(mm.cells[1][0]).value = 1;
    } });
    const { a } = await run([file]);
    const p = a.parsed[0];
    expect(p.read.infos.some((i) => i.message.includes('1/4분기'))).toBe(true);
    const { res } = await run([file]);
    const m = res.included[0].matrices?.b1;
    expect(m?.[0]).toEqual([3, 4]);
    expect(m?.[1]?.[0]).toBe(1);
  });
});

describe('고칠4 · 작은3 값 정리', () => {
  test('사업자번호 안내 예시(123-45-67891)는 검증을 통과한다', () => {
    expect(normalize('123-45-67891', f('p', '사업자', { type: 'pattern', pattern: 'bizno' }), ctx)).toMatchObject({ status: 'ok', value: '123-45-67891' });
  });
  test('연도 두 자리 날짜는 2000년대로 짐작해 수정안으로 낸다', () => {
    expect(normalize('26년 12월', f('d', '월', { type: 'date', dateFormat: 'yyyy-mm' }), ctx)).toMatchObject({ status: 'proposal', proposal: '2026-12' });
    expect(normalize('26.12.5', f('d', '일', { type: 'date' }), ctx)).toMatchObject({ status: 'proposal', proposal: '2026-12-05' });
  });
});

describe('작은6 · 수정본 사본', () => {
  test('원본에 칸이 없어 사본을 못 만든 파일은 이유와 함께 알린다', async () => {
    const schema: FormSchema = { ...structuredClone(SAMPLE.list), blocks: [{ kind: 'list', id: 'b1', maxRows: 10, columns: [f('name', '이름', { required: true }), f('qty', '수량', { type: 'number' })] }] };
    const file = await makeFile(schema, '서울.xlsx', { orgName: '서울' });
    const { a } = await run([file]);
    const res = resolve(a.base!.schema, a.identified, a.parsed, emptyDecisions(), ctx);
    res.valueIssues.push({ fileId: file.id, location: '수량', fieldLabel: '수량', choice: '직접 고침' } as never);
    const c = await patchCopies(res, [file], false, NOW, '시험');
    expect(c?.count).toBe(0);
    expect(c?.skipped[0]).toMatchObject({ fileName: '서울.xlsx' });
  });
});

describe('작은4 · 상대 날짜 범위', () => {
  test('"오늘부터 30일"은 양식을 내보낸 날 기준 (취합이 늦어도 그때 맞게 쓴 날짜는 통과)', async () => {
    const schema: FormSchema = { ...structuredClone(SAMPLE.list), blocks: [{ kind: 'list', id: 'b1', maxRows: 10, columns: [f('name', '이름', { required: true }), f('day', '희망일', { type: 'date', minDate: 'today', maxDate: 'today+30' })] }] };
    const file = await makeFile(schema, '서울.xlsx', { orgName: '서울', fill: (ws, m) => {
      ws.getCell(`${listCol(m, 'name')}${firstRow(m)}`).value = '김';
      ws.getCell(`${listCol(m, 'day')}${firstRow(m)}`).value = '2026-10-20';   // 내보낸 날(10/13) + 7일
    } });
    const late = new Date('2026-12-01T00:00:00Z');
    const a = await analyze([file], [], null, late);
    const res = resolve(a.base!.schema, a.identified, a.parsed, emptyDecisions(), { year: 2026, today: late });
    expect(res.valueIssues.filter((i) => i.code === 'OUT_OF_RANGE')).toEqual([]);
    expect(res.included[0].rows[0].values.day).toBe('2026-10-20');
  });
});
