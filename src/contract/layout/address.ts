/** 1 → 'A', 27 → 'AA' */
export function colLetter(col: number): string {
  let s = '';
  let n = col;
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/** 'AA' → 27 */
export function colNumber(letters: string): number {
  return [...letters.toUpperCase()].reduce((n, ch) => n * 26 + (ch.charCodeAt(0) - 64), 0);
}

export const addr = (col: number, row: number) => `${colLetter(col)}${row}`;

export function range(c1: number, r1: number, c2: number, r2: number): string {
  const a = addr(c1, r1);
  const b = addr(c2, r2);
  return a === b ? a : `${a}:${b}`;
}

/** 'B7' → { col: 2, row: 7 } */
export function parseAddr(a: string): { col: number; row: number } {
  const m = /^([A-Z]+)(\d+)$/.exec(a);
  if (!m) throw new Error(`잘못된 칸 주소: ${a}`);
  return { col: colNumber(m[1]), row: Number(m[2]) };
}

/** 'A1:C3' → 범위 안 모든 주소 */
export function expandRange(r: string): string[] {
  const [a, b = a] = r.split(':');
  const p = parseAddr(a);
  const q = parseAddr(b);
  const out: string[] = [];
  for (let row = Math.min(p.row, q.row); row <= Math.max(p.row, q.row); row++)
    for (let col = Math.min(p.col, q.col); col <= Math.max(p.col, q.col); col++) out.push(addr(col, row));
  return out;
}
