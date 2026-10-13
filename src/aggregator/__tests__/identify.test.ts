// @vitest-environment node
import { SAMPLE } from '@contract/__tests__/fixtures';
import type { FormSchema } from '@contract/schema';
import { chooseBase, classify, identifyFile } from '../pipeline/identify';
import type { LoadedFile } from '../pipeline/types';
import { firstRow, listCol, makeFile, NOW } from './makeFile';

const list = SAMPLE.list;
const raw = (name: string, bytes: number[]): LoadedFile => ({ id: name, fileName: name, bytes: new Uint8Array(bytes), lastModified: NOW.getTime() });
const fillName = (name: string) => ({ fill: (ws: import('exceljs').Worksheet, m: import('@contract/layout').SheetModel) => { ws.getCell(`${listCol(m, 'name')}${firstRow(m)}`).value = name; } });

async function run(files: LoadedFile[]) {
  const ids = await Promise.all(files.map(identifyFile));
  const base = chooseBase(ids);
  return { base, out: classify(ids, base) };
}

describe('① 식별 (identify)', () => {
  test('숨김 정보가 맞으면 meta-sheet, 지사명·저장 시각을 가져온다', async () => {
    const { out, base } = await run([await makeFile(list, '서울.xlsx', { orgName: '서울', savedAt: new Date('2026-10-14T01:00:00Z'), ...fillName('김민수') })]);
    expect(base?.schema.formId).toBe(list.formId);
    expect(out[0]).toMatchObject({ status: 'ok', source: 'meta-sheet', orgFromFile: '서울', savedAt: '2026-10-14T01:00:00.000Z' });
  });

  test('메타를 고쳤으면 믿지 않고 파일 속성으로 알아본다', async () => {
    const { out } = await run([
      await makeFile(list, '정상.xlsx', { orgName: '서울', ...fillName('가') }),
      await makeFile(list, '변조.xlsx', { orgName: '부산', tamper: true, ...fillName('나') }),
    ]);
    expect(out[1]).toMatchObject({ status: 'ok', source: 'doc-props', orgFromFile: '부산' });
    expect(out[1].notes.join()).toContain('메타 변조');
  });

  test('메타 시트가 지워져도 파일 속성으로 알아본다', async () => {
    const { out } = await run([
      await makeFile(list, '정상.xlsx', fillName('가')),
      await makeFile(list, '메타삭제.xlsx', { dropMeta: true, ...fillName('나') }),
    ]);
    expect(out[1]).toMatchObject({ status: 'ok', source: 'doc-props' });
  });

  test('메타·속성 모두 없으면 칸 이름이 70% 이상 맞을 때만 받는다', async () => {
    const { out } = await run([
      await makeFile(list, '정상.xlsx', fillName('가')),
      await makeFile(list, '복사본.xlsx', { dropMeta: true, dropProps: true, unprotected: true, ...fillName('나') }),
    ]);
    expect(out[1]).toMatchObject({ status: 'ok', source: 'header-match' });
  });

  test('새 파일에 복사하면서 칸 이름이 조금 바뀌어도("수량(개)") 칸 이름으로 알아본다', async () => {
    const three: FormSchema = { ...structuredClone(list), blocks: [{ kind: 'list', id: 'b1', maxRows: 10, columns: [
      { key: 'name', label: '이름', type: 'text', required: true }, { key: 'rank', label: '직급', type: 'text', required: false },
      { key: 'qty', label: '수량', type: 'number', required: false }] }] };
    const { out } = await run([
      await makeFile(three, '정상.xlsx', fillName('가')),
      await makeFile(three, '복사본.xlsx', { dropMeta: true, dropProps: true, unprotected: true, fill: (ws, m) => {
        ws.getCell(`${listCol(m, 'qty')}${firstRow(m) - 1}`).value = '수량(개)';
        ws.getCell(`${listCol(m, 'name')}${firstRow(m)}`).value = '나';
      } }),
    ]);
    expect(out[1]).toMatchObject({ status: 'ok', source: 'header-match' });
  });

  test('다른 양식, 내용이 완전히 같은 파일은 자동 제외', async () => {
    const other: FormSchema = { ...structuredClone(list), formId: '00000000-0000-4000-8000-0000000000ff', title: '작년 양식' };
    const a = await makeFile(list, '서울.xlsx', { orgName: '서울', ...fillName('가') });
    const { out } = await run([a, { ...a, id: '서울_복사.xlsx', fileName: '서울_복사.xlsx' }, await makeFile(other, '작년.xlsx', fillName('다'))]);
    expect(out.map((f) => f.status)).toEqual(['ok', 'duplicate-content', 'other-form']);
  });

  test('양식 버전이 다르면 받되 알려 준다', async () => {
    const v2: FormSchema = { ...structuredClone(list), formVersion: 2 };
    const { out, base } = await run([
      await makeFile(v2, '새.xlsx', fillName('가')), await makeFile(v2, '새2.xlsx', fillName('나')), await makeFile(list, '옛.xlsx', fillName('다')),
    ]);
    expect(base?.schema.formVersion).toBe(2);
    expect(out[2].status).toBe('ok');
    expect(out[2].notes.join()).toContain('v1');
  });

  test('.xls·.csv·암호·깨진 파일은 이유와 함께 건너뛴다', async () => {
    const out = await Promise.all([
      raw('명단.xls', [1, 2]), raw('메모.csv', [97]), raw('암호.xlsx', [0xd0, 0xcf, 0x11, 0xe0, 0, 0]), raw('깨짐.xlsx', [1, 2, 3]),
    ].map(identifyFile));
    expect(out.map((f) => f.status)).toEqual(['unreadable', 'unreadable', 'unreadable', 'unreadable']);
    const starts = ['옛날 엑셀(.xls)', '.csv 파일은', '암호가 걸린', '파일이 깨져'];
    out.forEach((f, i) => expect(f.skipReason).toMatch(new RegExp(`^${starts[i].replace(/[.()]/g, '\\$&')}`)));
  });

  test('시트 모으기형은 메타·속성이 없는 일반 엑셀을 자동 제외', async () => {
    const c = SAMPLE.collect;
    const { out } = await run([await makeFile(c, '서울.xlsx', { orgName: '서울' }), await makeFile(c, '일반.xlsx', { dropMeta: true, dropProps: true })]);
    expect(out[1]).toMatchObject({ status: 'other-form', skipReason: '한난MOA 양식 파일이 아니에요' });
  });
});
