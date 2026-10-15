// @vitest-environment node
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { SAMPLE, f } from '@contract/__tests__/fixtures';
import { readMeta } from '@contract/metaIO';
import type { FormSchema } from '@contract/schema';
import { analyze, patchCopies } from '../pipeline/run';
import { resolve } from '../pipeline/resolve';
import { writeResult } from '../pipeline/write';
import { emptyDecisions, type Decisions, type LoadedFile } from '../pipeline/types';
import { firstRow, listCol, makeFile, NOW } from './makeFile';

const ctx = { year: 2026, today: NOW };

async function runAll(files: LoadedFile[], d: Decisions = emptyDecisions(), methods = [] as FormSchema['aggregations']) {
  const a = await analyze(files, [], null, NOW);
  const res = resolve(a.base!.schema, a.identified, a.parsed, d, ctx);
  const out = await writeResult({ schema: a.base!.schema, res, methods, workbooks: new Map(a.identified.filter((x) => x.workbook).map((x) => [x.file.id, x.workbook!])), now: NOW });
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(out.bytes as unknown as ArrayBuffer);
  return { a, res, out, wb };
}

const sheetNames = (wb: ExcelJS.Workbook) => wb.worksheets.filter((w) => w.state === 'visible').map((w) => w.name);

/** 목록형: 이름(필수) · 직급 · 수량 */
const list: FormSchema = {
  ...structuredClone(SAMPLE.list),
  blocks: [{ kind: 'list', id: 'b1', maxRows: 10, columns: [f('name', '이름', { required: true }), f('rank', '직급', { type: 'select', options: ['사원', '대리'] }), f('qty', '수량', { type: 'number' })] }],
};
const put = (rows: Record<string, unknown>[]) => (ws: ExcelJS.Worksheet, m: Parameters<typeof firstRow>[0]) =>
  rows.forEach((vals, i) => { for (const [k, v] of Object.entries(vals)) ws.getCell(`${listCol(m, k)}${firstRow(m) + i}`).value = v as ExcelJS.CellValue; });

describe('목록형 전체 흐름', () => {
  test('정리·확인할 칸·중복·미제출 → 결과 파일 시트 순서와 검산', async () => {
    const files = [
      await makeFile(list, '서울.xlsx', { orgName: '서울', fill: put([{ name: '김', rank: '사원', qty: '1,000개' }, { name: '이', rank: '대리', qty: '약 10' }]) }),
      await makeFile(list, '부산_옛.xlsx', { orgName: '부산', savedAt: new Date('2026-10-12T00:00:00Z'), fill: put([{ name: '박', qty: 1 }]) }),
      await makeFile(list, '부산_새.xlsx', { orgName: '부산', savedAt: new Date('2026-10-14T00:00:00Z'), fill: put([{ name: '최', qty: 2 }, { rank: '사원', qty: 3 }]) }),
    ];
    const { res, out, wb } = await runAll(files, emptyDecisions(), ['same-frame', 'submission-status']);

    expect(res.files.find((s) => s.fileName === '부산_옛.xlsx')?.status).toBe('duplicate');
    expect(res.missingOrgs).toEqual(['대구']);
    // 확인할 칸: '약 10'(수정안 10) · 부산 2번째 줄 이름 빈칸(필수)
    expect(res.valueIssues.map((i) => [i.code, i.choice])).toEqual([['NOT_NUMBER', '자동으로 고친 값'], ['REQUIRED_EMPTY', '적혀 있던 값 그대로']]);
    expect(out.verify.ok).toBe(true);
    expect(out.verify.lines.find((l) => l.check === '숫자 합계 · 수량')?.detail).toContain('같은 틀 시트 1015');

    expect(sheetNames(wb)).toEqual([wb.worksheets[0].name, '제출 현황', '오류', '파일목록', '검산', '판단 기록']);
    const ws = wb.worksheets[0];
    const meta = await readMeta(wb);
    expect(meta.status === 'ok' && meta.meta.kind).toBe('aggregate');
    // 같은 틀 시트: 서울 2줄 + 부산 2줄, '약 10' 칸은 10 + 원래 값 메모
    const qtyCells: unknown[] = [];
    ws.eachRow((row) => row.eachCell((c) => { if (typeof c.note === 'string' && c.note.includes('약 10')) qtyCells.push(c.value); }));
    expect(qtyCells).toEqual([10]);
    const status = wb.getWorksheet('제출 현황')!.getSheetValues().slice(2).map((r) => (r as unknown[]).slice(1, 3));
    expect(status).toEqual([['서울', '제출'], ['부산', '중복'], ['부산', '제출'], ['대구', '미제출']]);
  });

  test('결정: 직접 고침 · 이 줄 빼기 · 파일 제외가 반영되고 판단 기록에 남는다', async () => {
    const files = [
      await makeFile(list, '서울.xlsx', { orgName: '서울', fill: put([{ name: '김', qty: '약 10' }, { name: '메모: 다음주 추가 예정' }]) }),
      await makeFile(list, '대구.xlsx', { orgName: '대구', fill: put([{ name: '정', qty: 5 }]) }),
    ];
    const a = await analyze(files, [], null, NOW);
    const issue = a.parsed[0].issues.find((i) => i.code === 'NOT_NUMBER')!;
    const d: Decisions = { ...emptyDecisions(), cellFix: { [issue.id]: { mode: 'manual', value: '12' } }, excludeRow: { [`${files[0].id}:${firstRowOf(a, 0) + 1}`]: true }, excludeFile: { [files[1].id]: true } };
    const res = resolve(a.base!.schema, a.identified, a.parsed, d, ctx);
    expect(res.included.map((s) => s.label)).toEqual(['서울']);
    expect(res.included[0].rows.map((r) => r.values.qty)).toEqual([12]);
    expect(res.included[0].removedRows).toEqual([expect.objectContaining({ reason: 'operator' })]);
    expect(res.log.map((l) => l.what)).toEqual(expect.arrayContaining(['파일 제외', '줄 빼기', '확인할 칸']));

    // 직접 고친 칸 → 수정본 사본: 그 칸이 12로 바뀌고, 다시 넣으면 오류 없이 읽힌다
    const copies = await patchCopies(res, files, true, NOW, list.title);
    expect(copies?.count).toBe(1);
    const zip = await JSZip.loadAsync(copies!.bytes);
    const fixed = await zip.file('서울_수정.xlsx')!.async('uint8array');
    const again = await analyze([{ id: 'x', fileName: '서울_수정.xlsx', bytes: fixed, lastModified: NOW.getTime() }], [], null, NOW);
    expect(again.parsed[0].rows[0].values.qty).toBe(12);
    expect(again.parsed[0].issues.filter((i) => i.code === 'NOT_NUMBER')).toEqual([]);
    expect(again.parsed[0].read.authorNotes).toEqual([]);   // [자동] 메모는 작성자 메모로 세지 않음
  });

  test('다시 취합: 본부 취합본 2개 = 같은 지사 파일을 직접 취합한 결과', async () => {
    const seoul = await makeFile(list, '서울.xlsx', { orgName: '서울', fill: put([{ name: '김', qty: 1 }]) });
    const busan = await makeFile(list, '부산.xlsx', { orgName: '부산', fill: put([{ name: '박', qty: 2 }, { name: '최', qty: 3 }]) });
    const direct = await runAll([seoul, busan]);
    const north = await runAll([seoul]);
    const south = await runAll([busan]);
    const again = await runAll([
      { id: 'n', fileName: '북부.xlsx', bytes: north.out.bytes, lastModified: NOW.getTime() },
      { id: 's', fileName: '남부.xlsx', bytes: south.out.bytes, lastModified: NOW.getTime() },
    ]);
    const strip = (r: typeof direct.res) => r.included.map((s) => ({ org: s.org, rows: s.rows.map((x) => x.values) }));
    expect(strip(again.res)).toEqual(strip(direct.res));
  });
});

describe('표형 · 빈칸채우기형 · 시트 모으기형', () => {
  test('표형: 칸마다 합, 합계 행·계 열은 다시 계산, 지사별 시트', async () => {
    const m = SAMPLE.matrix;   // input 모드, 지사 목록 없음
    const fill = (vals: number[][], org: string) => (ws: ExcelJS.Worksheet, model: Parameters<typeof firstRow>[0]) => {
      ws.getCell(model.cellMap.orgCell!).value = org;
      const mm = model.cellMap.blocks.b1;
      if (mm.kind === 'matrix') vals.forEach((row, r) => row.forEach((v, c) => { ws.getCell(mm.cells[r][c]).value = v; }));
    };
    const { res, wb, out } = await runAll([
      await makeFile(m, 'a.xlsx', { fill: fill([[1, 2], [3, 4]], '서울') }),
      await makeFile(m, 'b.xlsx', { fill: fill([[10, 20], [30, 40]], '부산') }),
    ]);
    expect(res.included.map((s) => s.label)).toEqual(['부산', '서울']);
    expect(out.verify.ok).toBe(true);
    const ws = wb.worksheets[0];
    const values: unknown[] = [];
    ws.eachRow((row) => row.eachCell((c) => { if (typeof c.value === 'number') values.push(c.value); }));
    expect(values).toEqual(expect.arrayContaining([11, 22, 33, 44, 110]));   // 칸 합 + 총계
    const spread = wb.getWorksheet('지사별')!;
    expect(spread.getRow(1).values).toEqual([undefined, '지사', '1학년 남', '1학년 여', '2학년 남', '2학년 여']);
    expect(spread.getRow(4).values).toEqual([undefined, '합계', 11, 22, 33, 44]);
  });

  test('빈칸채우기형: 겹치고, 다른 값이면 물어보고(기본 = 최신), 고정 칸 변경은 알림', async () => {
    const g = SAMPLE['fill-in'];
    const fill = (key: string, v: number, fixed?: string) => (ws: ExcelJS.Worksheet, model: Parameters<typeof firstRow>[0]) => {
      const gm = model.cellMap.blocks.b1;
      if (gm.kind !== 'grid') return;
      ws.getCell(gm.inputCells[key]).value = v;
      if (fixed) ws.getCell(Object.keys(gm.fixedCells)[0]).value = fixed;
    };
    const a = await analyze([
      await makeFile(g, 'a.xlsx', { savedAt: new Date('2026-10-12T00:00:00Z'), fill: fill('g1', 100) }),
      await makeFile(g, 'b.xlsx', { savedAt: new Date('2026-10-14T00:00:00Z'), fill: fill('g1', 120, '교육사업') }),
      await makeFile(g, 'c.xlsx', { fill: fill('g2', 50) }),
    ], [], null, NOW);
    const res = resolve(a.base!.schema, a.identified, a.parsed, emptyDecisions(), ctx);
    expect(res.gridOverlay.g1.value).toBe(120);
    expect(res.gridOverlay.g2.value).toBe(50);
    expect(res.questions.map((q) => q.kind)).toEqual(['grid-conflict']);
    expect(a.parsed[1].issues.map((i) => i.code)).toContain('FIXED_CELL_CHANGED');
    const d = { ...emptyDecisions(), answers: { 'grid:g1': a.parsed[0].fileId } };
    expect(resolve(a.base!.schema, a.identified, a.parsed, d, ctx).gridOverlay.g1.value).toBe(100);
  });

  test('시트 모으기형: 목차 + 제출처별 시트(모양 그대로), 일반 엑셀은 제외', async () => {
    const c = SAMPLE.collect;
    const shaped = (ws: ExcelJS.Worksheet) => {
      ws.getCell('A5').value = '점검 결과';
      ws.mergeCells('A6:C6');
      ws.getCell('A6').value = '이상 없음';
      ws.getColumn(2).width = 33;
      ws.getRow(6).height = 40;
    };
    const { res, wb } = await runAll([
      await makeFile(c, '서울.xlsx', { orgName: '서울', unprotected: true, fill: shaped, workbook: (w) => { w.addWorksheet('사진').getCell('A1').value = '사진 자리'; } }),
      await makeFile(c, '일반.xlsx', { dropMeta: true, dropProps: true }),
    ], emptyDecisions(), c.aggregations);
    expect(res.files.find((s) => s.fileName === '일반.xlsx')?.status).toBe('other-form');
    expect(sheetNames(wb)).toEqual(['목차', '서울', '제출 현황', '파일목록', '판단 기록']);
    const seoul = wb.getWorksheet('서울')!;
    expect(seoul.getCell('A6').value).toBe('이상 없음');
    expect(seoul.getCell('C6').isMerged).toBe(true);
    expect(seoul.getColumn(2).width).toBe(33);
    expect(seoul.getRow(6).height).toBe(40);
    expect(wb.getWorksheet('목차')!.getCell('F5').value).toMatchObject({ hyperlink: "#'서울'!A1" });
  });
});

function firstRowOf(a: Awaited<ReturnType<typeof analyze>>, i: number) { return a.parsed[i].rows[0].sourceRow; }

describe('자유 제작형', () => {
  test('입력 칸·숫자 표·입력 줄을 칸 지도대로 읽고, 같은 틀·지사별 시트로 모으고, 다시 취합해도 같다', async () => {
    const s = SAMPLE.free;   // 입력 칸 2(점검자·점검일) · 숫자 표 b2 · 입력 줄 영역 b3, 제출처 preset
    const fill = (who: string, nums: number[], items: [string, string, number][]) => (ws: ExcelJS.Worksheet, model: Parameters<typeof firstRow>[0]) => {
      const fm = model.cellMap.blocks.b1, mm = model.cellMap.blocks.b2, lm = model.cellMap.blocks.b3;
      if (fm.kind === 'fields') ws.getCell(fm.cells.insp.valueCell).value = who;
      if (mm.kind === 'matrix') nums.forEach((v, c) => { ws.getCell(mm.cells[0][c]).value = v; });
      if (lm.kind === 'list') items.forEach(([item, res, cost], i) => {
        ws.getCell(`${lm.columns.item}${lm.firstDataRow + i}`).value = item;
        ws.getCell(`${lm.columns.res}${lm.firstDataRow + i}`).value = res;
        ws.getCell(`${lm.columns.cost}${lm.firstDataRow + i}`).value = cost;
      });
    };
    const orgs = s.org.orgs!;
    const files = [
      await makeFile(s, `${orgs[0]}.xlsx`, { orgName: orgs[0], fill: fill('홍길동', [1, 2], [['소화기', '적합', 1000]]) }),
      await makeFile(s, `${orgs[1]}.xlsx`, { orgName: orgs[1], fill: fill('김철수', [3, 4], [['소화전', '부적합', 2000], ['비상등', '적합', 500]]) }),
    ];
    const { res, out, wb } = await runAll(files, emptyDecisions(), s.aggregations);
    expect(res.included.map((x) => x.header.insp)).toEqual(['홍길동', '김철수']);
    expect(res.included[1].matrices?.b2).toEqual([[3, 4]]);
    expect(out.verify.lines.filter((l) => !l.ok)).toEqual([]);
    const frame = wb.worksheets[0];
    expect(frame.getCell('B9').value).toBe(4);   // 숫자 표 칸 합 1+3
    expect(frame.getCell('C9').value).toBe(6);
    const spread = wb.getWorksheet('지사별');
    if (spread) expect((spread.getRow(1).values as unknown[]).slice(1, 3)).toEqual([orgLabelOf(s), '점검자']);

    const again = await runAll([{ id: 'agg', fileName: '취합본.xlsx', bytes: out.bytes, lastModified: NOW.getTime() }]);
    expect(again.res.included.map((x) => [x.org, x.header.insp, x.matrices?.b2, x.rows.length])).toEqual(res.included.map((x) => [x.org, x.header.insp, x.matrices?.b2, x.rows.length]));
  });
});

function orgLabelOf(s: FormSchema) { return s.org.label?.trim() || '지사'; }
