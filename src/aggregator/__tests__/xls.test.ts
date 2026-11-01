// @vitest-environment node
import * as XLSX from 'xlsx';
import { SAMPLE } from '@contract/__tests__/fixtures';
import { analyze, loadInputs } from '../pipeline/run';
import { firstRow, listCol, makeFile, NOW } from './makeFile';

const list = SAMPLE.list;
/** 지사가 한난MOA 회신 파일을 엑셀에서 'Excel 97-2003 통합 문서(.xls)'로 다시 저장해 보낸 경우.
 *  SheetJS의 .xls 저장은 한 칸 글자를 255자로 자르고(엑셀은 32,767자) 한글 파일 속성을 깨뜨려서, 여기서는 지사명 속성만 바로잡는다.
 *  그래서 숨김 정보 시트는 상하고(엑셀로 저장한 실제 .xls는 남는다), 파일 속성으로 알아보는 길을 시험한다 */
const asXls = (xlsx: Uint8Array, org: string) => {
  const wb = XLSX.read(xlsx, { type: 'array', cellStyles: true });
  (wb as { Custprops?: Record<string, unknown> }).Custprops!['kdhc.org'] = org;
  return new Uint8Array(XLSX.write(wb, { type: 'array', bookType: 'biff8' }) as ArrayBuffer);
};

describe('옛 엑셀(.xls) 회신 파일', () => {
  test('.xlsx로 바꿔 읽어 다른 회신과 함께 취합한다', async () => {
    const seoul = await makeFile(list, '서울.xlsx', { orgName: '서울', fill: (ws, m) => { ws.getCell(`${listCol(m, 'name')}${firstRow(m)}`).value = '김민수'; } });
    const busan = await makeFile(list, '부산.xlsx', { orgName: '부산', fill: (ws, m) => { ws.getCell(`${listCol(m, 'name')}${firstRow(m)}`).value = '이영희'; } });
    const xls = asXls(busan.bytes, '부산');
    expect(xls[0]).toBe(0xd0);
    const { files } = await loadInputs([
      { name: '서울.xlsx', bytes: seoul.bytes, lastModified: NOW.getTime() },
      { name: '부산.xls', bytes: xls, lastModified: NOW.getTime() },
    ]);
    expect(files[1]).toMatchObject({ fileName: '부산.xls', convertedFrom: 'xls' });
    const a = await analyze(files, [], null, NOW);
    const b = a.identified.find((f) => f.file.fileName === '부산.xls')!;
    expect(b.status).toBe('ok');
    expect(b.source).toBe('doc-props');
    expect(b.orgFromFile).toBe('부산');
    expect(b.notes.join(' ')).toContain('옛 엑셀(.xls)을 .xlsx로 바꿔 읽었어요');
    const names = a.parsed.flatMap((p) => JSON.stringify(p.rows ?? p)).join(' ');
    expect(names).toContain('이영희');
    expect(names).toContain('김민수');
  });
  test('깨진 .xls는 이유와 함께 건너뛴다', async () => {
    const { files } = await loadInputs([{ name: '깨짐.xls', bytes: new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 1, 2, 3]), lastModified: NOW.getTime() }]);
    const a = await analyze(files, [], null, NOW);
    expect(a.identified[0].status).toBe('unreadable');
    expect(a.identified[0].skipReason).toContain('.xlsx로 다시 저장');
  });
});
