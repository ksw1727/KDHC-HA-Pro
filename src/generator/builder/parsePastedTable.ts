/** 엑셀에서 복사한 표(탭·줄바꿈 글자)를 2차원 배열로. 숫자처럼 보이면 숫자로. */
export function parsePastedTable(text: string): (string | number | null)[][] {
  const rows = text.replace(/\r\n?/g, '\n').replace(/\n+$/, '').split('\n');
  if (rows.length === 1 && rows[0] === '') return [];
  const parsed = rows.map((r) => r.split('\t').map((c) => {
    const t = c.trim();
    if (t === '') return null;
    const n = Number(t.replace(/,/g, ''));
    return /^-?[\d,]+(\.\d+)?$/.test(t) && !Number.isNaN(n) ? n : t;
  }));
  const width = Math.max(...parsed.map((r) => r.length));
  return parsed.map((r) => [...r, ...Array(width - r.length).fill(null)]);
}
