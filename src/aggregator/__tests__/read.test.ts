// @vitest-environment node
import type ExcelJS from 'exceljs';
import type { SheetModel } from '@contract/layout';
import { SAMPLE, f } from '@contract/__tests__/fixtures';
import type { FormSchema } from '@contract/schema';
import { chooseBase, classify, identifyFile } from '../pipeline/identify';
import { readSubmission } from '../pipeline/read';
import type { LoadedFile } from '../pipeline/types';
import { firstRow, listCol, makeFile } from './makeFile';

/** 목록형: 이름(필수) · 직급(선택) · 수량(숫자) */
const schema: FormSchema = {
  ...structuredClone(SAMPLE.list),
  blocks: [{ kind: 'list', id: 'b1', maxRows: 20, columns: [
    f('name', '이름', { required: true }), f('rank', '직급', { type: 'select', options: ['사원', '대리'] }), f('qty', '수량', { type: 'number' }),
  ] }],
};

type Put = (row: number, values: Record<string, unknown>) => void;
const writer = (ws: ExcelJS.Worksheet, m: SheetModel): Put => (row, values) => {
  for (const [k, v] of Object.entries(values)) ws.getCell(`${listCol(m, k)}${firstRow(m) + row}`).value = v as ExcelJS.CellValue;
};

async function readOne(file: LoadedFile, others: LoadedFile[] = []) {
  const ids = await Promise.all([file, ...others].map(identifyFile));
  const base = chooseBase(ids)!;
  const [mine] = classify(ids, base);
  return readSubmission(mine, base);
}

describe('② 읽기 (read) — 목록형', () => {
  test('칸 지도대로 읽고, 숨긴 줄·취소선·합친 셀·〃·빈 줄·합계 줄·작성자 메모를 알아본다', async () => {
    const file = await makeFile(schema, '부산.xlsx', { orgName: '부산', fill: (ws, m) => {
      const put = writer(ws, m);
      put(0, { name: '김민수', rank: '사원', qty: 2 });
      put(1, { name: '이지은', qty: 1 });
      ws.mergeCells(`${listCol(m, 'rank')}${firstRow(m)}:${listCol(m, 'rank')}${firstRow(m) + 1}`);   // 직급 합친 셀
      put(2, { name: '박서준', rank: '〃', qty: 3 });                                                      // 〃 → 윗줄 값
      ws.getRow(firstRow(m) + 2).hidden = true;
      put(4, { name: '최유나', rank: '대리', qty: 1 });                                                    // 3번째 줄은 빈 줄
      const s = ws.getCell(`${listCol(m, 'name')}${firstRow(m) + 4}`);
      s.style = { ...s.style, font: { strike: true } };
      put(5, { name: '합계', qty: 7 });
      ws.getCell(`${listCol(m, 'qty')}${firstRow(m)}`).note = '오전반 희망';
    } });
    const r = await readOne(file);
    expect(r.org).toBe('부산');
    expect(r.rows.map((x) => x.cells.name.raw)).toEqual(['김민수', '이지은', '박서준', '최유나']);
    expect(r.rows[1].cells.rank).toMatchObject({ raw: '사원', fill: 'merged' });
    expect(r.rows[2].cells.rank).toMatchObject({ raw: '사원', fill: 'ditto' });
    expect(r.rows[2].flags).toEqual(['hidden']);
    expect(r.rows[3].flags).toEqual(['strike']);
    expect(r.excludedRows.map((x) => x.reason)).toEqual(['blank', 'total']);
    expect(r.totalRowChecks).toEqual([{ sourceRow: expect.any(Number), fieldKey: 'qty', written: 7, computed: 7 }]);
    expect(r.authorNotes).toEqual([expect.objectContaining({ fieldKey: 'qty', text: '오전반 희망' })]);
    expect(r.readCount).toBe(6);   // 반영 4 + 빈 줄 1 + 합계 줄 1 (끝에 남은 입력 줄은 세지 않음)
    expect(r.infos).toEqual([]);
  });

  test('필터로 가린 줄은 필터를 푼 것처럼 보통 줄로 읽고 안내만 남긴다', async () => {
    const r = await readOne(await makeFile(schema, '울산.xlsx', { fill: (ws, m) => {
      const put = writer(ws, m);
      put(0, { name: '가', rank: '사원', qty: 1 }); put(1, { name: '나', rank: '대리', qty: 2 }); put(2, { name: '다', rank: '사원', qty: 3 });
      ws.autoFilter = `A${firstRow(m) - 1}:${listCol(m, 'qty')}${firstRow(m) + 2}`;
      ws.getRow(firstRow(m) + 1).hidden = true;   // 직급=사원으로 걸러서 가려진 줄
    } }));
    expect(r.rows.map((x) => [x.cells.name.raw, x.flags])).toEqual([['가', []], ['나', []], ['다', []]]);
    expect(r.infos.map((i) => i.code)).toEqual(['FILTER_CLEARED']);
    expect(r.questions.filter((q) => q.kind === 'hidden-area')).toEqual([]);
    expect(r.hiddenArea).toBeUndefined();
  });

  test('직접 숨긴 줄·열에 값이 있으면 모아 두고 넣을지 묻는다(기본 = 넣기)', async () => {
    const r = await readOne(await makeFile(schema, '세종.xlsx', { fill: (ws, m) => {
      const put = writer(ws, m);
      put(0, { name: '가', rank: '사원', qty: 1 }); put(1, { name: '나', rank: '대리', qty: 2 }); put(2, { name: '다', qty: 3 });
      ws.getRow(firstRow(m) + 1).hidden = true;
      ws.getColumn(listCol(m, 'rank')).hidden = true;
    } }));
    expect(r.rows[1].flags).toEqual(['hidden']);
    expect(r.hiddenArea?.rows).toEqual([r.rows[1].sourceRow]);
    // 숨긴 열(직급)에서 값이 있는 칸: 숨긴 줄은 줄째로 빠지므로 1번째 줄만
    expect(r.hiddenArea?.slots).toEqual([{ part: 'row', key: 'rank', sourceRow: r.rows[0].sourceRow }]);
    const q = r.questions.find((x) => x.kind === 'hidden-area')!;
    expect(q.defaultChoice).toBe('include');
    expect(q.message).toContain('숨긴 줄 1개');
    expect(q.message).toContain('숨긴 열 1개');
    expect(r.infos.map((i) => i.code)).not.toContain('FILTER_CLEARED');
  });

  test('합계 줄이 위 줄들의 합과 다르면 알려 준다', async () => {
    const r = await readOne(await makeFile(schema, '대구.xlsx', { fill: (ws, m) => {
      const put = writer(ws, m);
      put(0, { name: '가', qty: 2 }); put(1, { name: '나', qty: 3 }); put(2, { name: '소계', qty: 9 });
    } }));
    expect(r.infos.map((i) => i.code)).toEqual(['TOTAL_MISMATCH']);
  });

  test('작성자가 추가한 계산용 시트는 읽지 않고, 양식 시트 이름이 바뀌어도 찾는다', async () => {
    const r = await readOne(await makeFile(schema, '광주.xlsx', {
      fill: (ws, m) => writer(ws, m)(0, { name: '가', qty: 1 }),
      workbook: (wb) => { wb.worksheets[0].name = '우리 지사 제출'; wb.addWorksheet('계산용').getCell('A1').value = 123; },
    }));
    expect(r.sheetName).toBe('우리 지사 제출');
    expect(r.unreadSheets).toEqual(['계산용']);
    expect(r.rows).toHaveLength(1);
    expect(r.infos.map((i) => i.code).sort()).toEqual(['EXTRA_SHEET', 'LABEL_MOVED']);
  });

  test('보호가 풀린 사본: 칸 순서가 바뀌고 비슷한 이름·양식에 없는 칸·표 밖 글이 있어도 이름으로 맞춘다', async () => {
    const good = await makeFile(schema, '정상.xlsx', { fill: (ws, m) => writer(ws, m)(0, { name: '가', qty: 1 }) });
    const copy = await makeFile(schema, '복사본.xlsx', { dropMeta: true, dropProps: true, unprotected: true, fill: (ws, m) => {
      const h = firstRow(m) - 1;
      // 머리글을 [번호, 수량, 이 름*, 직급 , 사유]로 바꿔 적고 값도 그 순서로
      ['번호', '수 량', '이름 *', '직급', '사유'].forEach((t, i) => { ws.getCell(h, i + 1).value = t; });
      ws.getRow(h + 1).values = [1, 5, '홍길동', '대리', '고장'];
      ws.getCell(h + 1, 9).value = '※ 담당자 휴가';    // 표 밖 글
    } });
    const r = await readOne(copy, [good]);
    expect(r.rows[0].cells.name.raw).toBe('홍길동');
    expect(r.rows[0].cells.qty.raw).toBe(5);               // "수 량"은 공백 무시로 바로 맞음
    expect(r.extraColumns).toEqual([{ header: '사유', values: [{ sourceRow: firstRowOf(r), value: '고장' }] }]);
    expect(r.infos.map((i) => i.code)).toEqual(expect.arrayContaining(['COLUMNS_REORDERED', 'TEXT_OUTSIDE_INPUT']));
  });

  test('비슷한 칸 이름은 물어본다 (기본 = 맞춤)', async () => {
    const good = await makeFile(schema, '정상.xlsx', { fill: (ws, m) => writer(ws, m)(0, { name: '가' }) });
    const copy = await makeFile(schema, '복사본.xlsx', { dropMeta: true, dropProps: true, unprotected: true, fill: (ws, m) => {
      ws.getCell(`${listCol(m, 'qty')}${firstRow(m) - 1}`).value = '수량(개)';
      writer(ws, m)(0, { name: '가', qty: 4 });
    } });
    const r = await readOne(copy, [good]);
    expect(r.questions).toEqual([expect.objectContaining({ kind: 'column-alias', defaultChoice: 'map' })]);
    expect(r.rows[0].cells.qty.raw).toBe(4);
  });
});

describe('② 읽기 — 혼합형 위쪽 정보', () => {
  test('지사명 칸(input 모드)과 위쪽 정보 칸을 읽는다', async () => {
    const s: FormSchema = { ...structuredClone(SAMPLE['header-list']), org: { mode: 'input' } };
    const r = await readOne(await makeFile(s, '회신.xlsx', { fill: (ws, m) => {
      ws.getCell(m.cellMap.orgCell!).value = '제주지사';
      const fm = m.cellMap.blocks.b1;
      if (fm.kind === 'fields') { ws.getCell(fm.cells.manager.valueCell).value = '김담당'; ws.getCell(fm.cells.manager.valueCell).note = '[자동] 원래 값: x\n대리 승진 예정'; }
      ws.getCell(`${listCol(m, 'name', 'b2')}${firstRow(m, 'b2')}`).value = '참가자1';
    } }));
    expect(r.org).toBe('제주지사');
    expect(r.header.manager.raw).toBe('김담당');
    expect(r.authorNotes).toEqual([expect.objectContaining({ fieldKey: 'manager', text: '대리 승진 예정' })]);
    expect(r.rows.map((x) => x.cells.name.raw)).toEqual(['참가자1']);
  });
});

function firstRowOf(r: { rows: { sourceRow: number }[] }) { return r.rows[0].sourceRow; }
