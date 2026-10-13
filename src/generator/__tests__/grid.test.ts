import { parsePastedTable } from '../builder/parsePastedTable';
import { addCol, addRow, fromPaste, inputName, removeCol, setBlank, setInputs, setValue, syncSpare, type GridData } from '../builder/gridOps';

const keys = () => { let n = 0; return () => `k${++n}`; };

describe('붙여넣기 파싱', () => {
  test('탭·줄바꿈·빈 칸·숫자·마지막 줄바꿈·CRLF', () => {
    expect(parsePastedTable('사업\t예산\t서울\r\n교육\t1,900\t\r\n홍보\t600\n')).toEqual([
      ['사업', '예산', '서울'], ['교육', 1900, null], ['홍보', 600, null],
    ]);
  });
  test('칸 수가 다른 줄은 null로 채움', () => {
    expect(parsePastedTable('a\tb\nc')).toEqual([['a', 'b'], ['c', null]]);
  });
  test('빈 글자는 빈 표', () => {
    expect(parsePastedTable('')).toEqual([]);
  });
});

describe('표 편집', () => {
  const g: GridData = fromPaste(parsePastedTable('사업\t예산\t서울\t부산\n교육\t900\t\t\n홍보\t600\t\t'));

  test('붙여넣기: 첫 줄은 머리글, 나머지는 고정', () => {
    expect(g.colLabels).toEqual(['사업', '예산', '서울', '부산']);
    expect(g.rows[0][0]).toEqual({ kind: 'fixed', value: '교육' });
    expect(g.rows[0][2]).toEqual({ kind: 'blank' });
  });

  test('범위를 입력칸으로: 이름 자동, key 유일, 같은 설정', () => {
    const k = keys();
    const r = setInputs(g, { r1: 1, c1: 3, r2: 0, c2: 2 }, k, { type: 'number', unit: '원' });
    const inputs = r.rows.flat().filter((c) => c.kind === 'input');
    expect(inputs).toHaveLength(4);
    expect(new Set(inputs.map((c) => c.kind === 'input' && c.field.key)).size).toBe(4);
    expect(r.rows[0][2]).toMatchObject({ kind: 'input', field: { label: '교육 · 서울', type: 'number', unit: '원' } });
    expect(inputName(g, 1, 3)).toBe('홍보 · 부산');
  });

  test('이미 입력칸이면 key·이름 유지', () => {
    const once = setInputs(g, { r1: 0, c1: 2, r2: 0, c2: 2 }, keys());
    const twice = setInputs(once, { r1: 0, c1: 2, r2: 0, c2: 2 }, () => 'NEW', { required: true });
    expect(twice.rows[0][2]).toMatchObject({ field: { key: 'k1', label: '교육 · 서울', required: true } });
  });

  test('글자 입력 → 고정, 비우면 빈칸', () => {
    expect(setValue(g, 0, 2, '1,200').rows[0][2]).toEqual({ kind: 'fixed', value: 1200 });
    expect(setValue(g, 0, 0, '  ').rows[0][0]).toEqual({ kind: 'blank' });
    expect(setBlank(g, { r1: 0, c1: 0, r2: 1, c2: 0 }).rows.map((r) => r[0].kind)).toEqual(['blank', 'blank']);
  });

  test('행·열 추가·삭제와 여유 줄 열 규칙 맞추기', () => {
    const k = keys();
    let x = addRow(g);
    expect(x.rows).toHaveLength(3);
    x = { ...x, spareRows: 2 };
    x = syncSpare(x, k);
    expect(x.spareColumns?.map((f) => f.label)).toEqual(['사업', '예산', '서울', '부산']);
    x = addCol(x, k);
    expect(x.colLabels).toHaveLength(5);
    expect(x.spareColumns).toHaveLength(5);
    x = removeCol(x, 0, k);
    expect(x.colLabels[0]).toBe('예산');
    expect(x.spareColumns?.[0].label).toBe('예산');
    expect(syncSpare({ ...x, spareRows: 0 }, k).spareColumns).toBeUndefined();
  });
});
