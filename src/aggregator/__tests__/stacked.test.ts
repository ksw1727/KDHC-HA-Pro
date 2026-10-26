// @vitest-environment node
// 취합 결과에 합계·대표값만 남지 않고, 제출처가 낸 내용이 그대로 쌓이는지
import { SAMPLE, f } from '@contract/__tests__/fixtures';
import { requiredAggregations } from '@contract/aggregationIds';
import type { FormSchema } from '@contract/schema';
import type { MatrixBlockMap } from '@contract/meta';
import type { SheetModel } from '@contract/layout';
import { analyze } from '../pipeline/run';
import { resolve } from '../pipeline/resolve';
import { emptyDecisions } from '../pipeline/types';
import { buildSameFrame } from '../pipeline/aggregate';
import { verify } from '../pipeline/verify';
import { makeFile, NOW } from './makeFile';

const ctx = { year: 2026, today: NOW };

async function run(schema: FormSchema, files: Awaited<ReturnType<typeof makeFile>>[]) {
  const a = await analyze(files, [], schema, NOW);
  return resolve(schema, a.identified, a.parsed, emptyDecisions(), ctx);
}


/** 시트의 (행 from부터 n줄 × 왼쪽 w칸) 값 */
function gridAt(model: SheetModel, from: number, w: number, n: number): (string | number | null)[][] {
  const at = new Map(model.cells.map((c) => [c.address, c]));
  return Array.from({ length: n }, (_, i) =>
    Array.from({ length: w }, (__, k) => at.get(`${String.fromCharCode(65 + k)}${from + i}`)?.value ?? null));
}

/** 같은 틀 시트에서 '제출처별' 블록의 줄 (제목 행 → 머리글 행 → 값) */
function stackedRows(model: ReturnType<typeof buildSameFrame>['model'], title: string) {
  const at = new Map(model.cells.map((c) => [c.address, c]));
  const head = model.cells.find((c) => c.role === 'label' && String(c.value ?? '').startsWith(title));
  if (!head) return null;
  const top = Number(/\d+$/.exec(head.address)![0]);
  const read = (r: number) => {
    const out: (string | number)[] = [];
    for (let col = 1; ; col++) {
      const c = at.get(`${String.fromCharCode(64 + col)}${r}`);
      if (!c || (c.role !== 'auto-header' && c.role !== 'auto-value')) break;
      out.push(c.value ?? '');
    }
    return out;
  };
  const rows: (string | number)[][] = [];
  for (let r = top + 2; read(r).length; r++) rows.push(read(r));
  return { columns: read(top + 1), rows };
}

describe('숫자 표: 합계 한 칸 대신 제출처 줄 + 계 줄', () => {
  const schema = SAMPLE.matrix;   // 행 '1학년'·'2학년', 열 '남'·'여', 합계 행·계 열 있음
  const fill = (vals: number[][]) => (ws: { getCell(a: string): { value: unknown } }, m: { cellMap: { blocks: Record<string, unknown> } }) => {
    const mm = m.cellMap.blocks.b1 as MatrixBlockMap;
    vals.forEach((row, r) => row.forEach((v, c) => { ws.getCell(mm.cells[r][c]).value = v; }));
  };

  test('항목으로 묶어 제출처 줄을 쌓고, 묶음마다 계 줄에 열별 합이 들어간다', async () => {
    const files = [
      await makeFile(schema, '서울.xlsx', { fill: (ws, m) => { ws.getCell('B4').value = '서울'; fill([[3, 4], [5, 6]])(ws, m); } }),
      await makeFile(schema, '부산.xlsx', { fill: (ws, m) => { ws.getCell('B4').value = '부산'; fill([[1, 2], [7, 8]])(ws, m); } }),
    ];
    const res = await run(schema, files);
    const clean = buildSameFrame(schema, res, '', NOW, true);   // true = 결과 파일(값만)
    // 표 자리에 머리글 + (항목별 제출처 줄 + 계 줄) + 합계 줄
    expect(gridAt(clean.model, 6, 5, 8)).toEqual([
      ['지사', '항목', '남', '여', '계'],
      ['부산', '1학년', 1, 2, 3],
      ['서울', '1학년', 3, 4, 7],
      ['계 · 1학년', '1학년', 4, 6, 10],
      ['부산', '2학년', 7, 8, 15],
      ['서울', '2학년', 5, 6, 11],
      ['계 · 2학년', '2학년', 12, 14, 26],
      ['합계', null, 16, 20, 36],
    ]);
  });

  test('합계 칸은 사라지고, 검산(숫자 합계)은 그대로 맞는다', async () => {
    const files = [await makeFile(schema, '서울.xlsx', { fill: (ws, m) => { ws.getCell('B4').value = '서울'; fill([[3, 4], [5, 6]])(ws, m); } })];
    const res = await run(schema, files);
    const frame = buildSameFrame(schema, res, '', NOW);
    const v = verify(schema, res, frame.model);
    expect(v.lines.filter((l) => !l.ok)).toEqual([]);
    const mm = frame.model.cellMap.blocks.b1 as MatrixBlockMap;
    expect(mm.cells.length).toBe(2);              // 제출처 1곳 × 항목 2개
    expect(mm.totalCells?.length).toBe(2);        // 항목마다 계 줄
  });

  test('제출처가 적어 내지 않은 항목도 빈 줄로 남는다', async () => {
    const files = [
      await makeFile(schema, '서울.xlsx', { fill: (ws, m) => { ws.getCell('B4').value = '서울'; fill([[3, 4], [5, 6]])(ws, m); } }),
      await makeFile(schema, '부산.xlsx', { fill: (ws) => { ws.getCell('B4').value = '부산'; } }),
    ];
    const res = await run(schema, files);
    const clean = buildSameFrame(schema, res, '', NOW, true);
    expect(gridAt(clean.model, 7, 3, 2)).toEqual([['부산', '1학년', null], ['서울', '1학년', 3]]);
  });
});

describe('빈칸채우기: 여러 곳이 같은 칸을 채우면 모두 남는다', () => {
  // 제출처를 이름으로 받는 빈칸채우기 (칸마다 작성처가 정해지지 않아 세 곳이 같은 칸을 채운다)
  const schema: FormSchema = {
    ...structuredClone(SAMPLE['fill-in']),
    org: { mode: 'input' },
    blocks: [{
      kind: 'grid', id: 'b1', colLabels: ['구분', '입력'], spareRows: 0,
      rows: [
        [{ kind: 'fixed', value: '당직 전화' }, { kind: 'input', field: f('g1', '당직 전화') }],
        [{ kind: 'fixed', value: '발전기 대수' }, { kind: 'input', field: f('g2', '발전기 대수', { type: 'number' }) }],
      ],
    }],
  };
  const put = (org: string, tel: string, n: number) => makeFile(schema, `${org}.xlsx`, { fill: (ws, m) => {
    const g = m.cellMap.blocks.b1;
    if (g?.kind !== 'grid') throw new Error('빈칸채우기 블록이 아니에요');
    ws.getCell('B4').value = org;
    ws.getCell(g.inputCells.g1).value = tel;
    ws.getCell(g.inputCells.g2).value = n;
  } });

  test('결과 파일에 세 곳 값이 모두 줄로 쌓이고, 고른 칸에는 출처 메모가 남는다', async () => {
    const res = await run(schema, [await put('서울', '02-1', 2), await put('부산', '051-2', 5), await put('대구', '053-3', 1)]);
    const clean = buildSameFrame(schema, res, '', NOW, true);
    const st = stackedRows(clean.model, '지사별 채운 값');
    expect(st?.columns).toEqual(['지사', '당직 전화', '발전기 대수']);
    expect(st?.rows).toEqual([['대구', '053-3', 1], ['부산', '051-2', 5], ['서울', '02-1', 2]]);

    const g = clean.model.cellMap.blocks.b1;
    if (g?.kind !== 'grid') throw new Error('빈칸채우기 블록이 아니에요');
    const cell = clean.model.cells.find((c) => c.address === g.inputCells.g1);
    expect(cell?.note).toMatch(/출처: /);
    expect(cell?.note).toMatch(/다른 값 — /);
  });

  test('한 곳만 낸 칸뿐이면 쌓는 블록을 붙이지 않는다 (같은 틀 시트에 이미 다 있다)', async () => {
    const res = await run(schema, [await put('서울', '02-1', 2)]);
    const clean = buildSameFrame(schema, res, '', NOW, true);
    expect(stackedRows(clean.model, '지사별 채운 값')).toBeNull();
  });
});

describe('자유 제작형: 숫자 표가 있으면 지사별 펼치기가 필수', () => {
  test('목록이 같이 있어도 필수 (표 칸에는 합계만 남으므로)', () => {
    expect(requiredAggregations(SAMPLE.free)).toEqual(['same-frame', 'spread']);
  });
  test('숫자 표가 없으면 목록만으로는 필수가 아니다', () => {
    const s = structuredClone(SAMPLE.free);
    s.blocks = s.blocks.filter((b) => b.kind !== 'matrix');
    delete s.free!.places.b2;
    expect(requiredAggregations(s)).toEqual(['same-frame']);
  });
});
