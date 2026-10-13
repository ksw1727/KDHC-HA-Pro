import type { Block, Field, FieldsBlock, FormSchema, FreeSpec, ListBlock, MatrixBlock } from '@contract/schema';
import { availableAggregations, requiredAggregations } from '@contract/aggregationIds';
import { addr, expandRange, parseAddr } from '@contract/layout';
import { freeAggregationChecks, freeRegions, freeSize, inRegion, sheetAddr, type FreeRegion } from '@contract/free';
import { newField } from './fieldDefaults';

/** 판 위 사각형 (판 좌표, 1부터, 양 끝 포함) */
export interface Rect { r1: number; c1: number; r2: number; c2: number }

export const rectOf = (a: string, b: string = a): Rect => {
  const p = parseAddr(a);
  const q = parseAddr(b);
  return { r1: Math.min(p.row, q.row), c1: Math.min(p.col, q.col), r2: Math.max(p.row, q.row), c2: Math.max(p.col, q.col) };
};
export const rectText = (r: Rect) => (r.r1 === r.r2 && r.c1 === r.c2 ? addr(r.c1, r.r1) : `${addr(r.c1, r.r1)}:${addr(r.c2, r.r2)}`);
const cellsOf = (r: Rect) => expandRange(rectText(r));
const hits = (a: Rect, b: Rect) => a.r1 <= b.r2 && b.r1 <= a.r2 && a.c1 <= b.c2 && b.c1 <= a.c2;

/** 판 편집 동작 (리듀서 action 'free/op'에 실린다). keys = 새 항목 key (무작위 값은 밖에서 받는다) */
export type FreeOp =
  | { op: 'text'; at: string; value: string }
  | { op: 'clear'; rect: Rect }
  | { op: 'resize'; rows: number; cols: number }
  | { op: 'merge'; rect: Rect }
  | { op: 'unmerge'; rect: Rect }
  | { op: 'mark'; kind: 'fields' | 'list' | 'matrix'; rect: Rect; keys: string[] }
  | { op: 'unmark'; rect: Rect }
  | { op: 'move'; blockId: string; key?: string; to: string };

export type FreeResult = { schema: FormSchema; error?: undefined } | { schema?: undefined; error: string };

const spec = (s: FormSchema): FreeSpec => s.free ?? { rows: 10, cols: 5, texts: {}, merges: [], places: {} };

/** 블록 id를 b1, b2 … 로 다시 매기고(계약 규칙), 놓인 자리·필수 취합 방식을 맞춘다 */
export function tidy(s: FormSchema): FormSchema {
  const free = spec(s);
  const order = [...s.blocks.filter((b) => b.kind === 'fields'), ...s.blocks.filter((b) => b.kind !== 'fields')];
  const places: Record<string, string> = {};
  const blocks = order
    .filter((b) => b.kind !== 'fields' || b.fields.length > 0)
    .map((b, i): Block => {
      const id = `b${i + 1}`;
      if (b.kind === 'fields') for (const f of b.fields) places[f.key] = free.places[f.key];
      else places[id] = free.places[b.id];
      return { ...b, id };
    });
  const next: FormSchema = { ...s, blocks, free: { ...free, places } };
  // 이 모양으로 "안 됨"인 방식(예: 줄 영역만 있을 때 지사별 펼치기)은 저절로 뺀다
  const no = new Set(freeAggregationChecks(next).filter((c) => c.status === 'no' && !c.required).map((c) => c.id));
  const allowed = availableAggregations(next).filter((a) => !no.has(a));
  next.aggregations = [...new Set([...requiredAggregations(next), ...s.aggregations.filter((a) => allowed.includes(a))])];
  return next;
}

function uniqueLabel(used: Set<string>, base: string): string {
  let n = 1;
  while (used.has(`${base} ${n}`)) n++;
  const name = `${base} ${n}`;
  used.add(name);
  return name;
}

const regionHit = (s: FormSchema, r: Rect) => freeRegions(s).find((g) => hits(g, r));

/** 판 편집 한 번. 할 수 없으면 화면에 보여줄 이유를 돌려준다 */
export function applyFreeOp(s: FormSchema, o: FreeOp): FreeResult {
  const free = spec(s);
  switch (o.op) {
    case 'text': {
      const p = parseAddr(o.at);
      const g = freeRegions(s).find((x) => inRegion(x, p.row, p.col));
      if (g) return { error: `'${g.name}' 영역 안에는 글자를 쓸 수 없어요. 이름은 왼쪽 ③에서 고쳐요.` };
      const texts = { ...free.texts };
      if (o.value.trim() === '') delete texts[o.at];
      else texts[o.at] = o.value;
      return { schema: { ...s, free: { ...free, texts } } };
    }
    case 'clear': {
      const drop = new Set(cellsOf(o.rect));
      const texts = Object.fromEntries(Object.entries(free.texts).filter(([a]) => !drop.has(a)));
      return { schema: { ...s, free: { ...free, texts } } };
    }
    case 'resize': {
      const need = freeRegions(s).reduce((m, g) => ({ rows: Math.max(m.rows, g.r2), cols: Math.max(m.cols, g.c2) }), { rows: 1, cols: 1 });
      const rows = Math.min(200, Math.max(need.rows, o.rows));
      const cols = Math.min(30, Math.max(need.cols, o.cols));
      if (rows === free.rows && cols === free.cols) return { error: o.rows < free.rows || o.cols < free.cols ? '입력 영역이 있는 행·열은 줄일 수 없어요.' : '더 늘릴 수 없어요.' };
      const texts = Object.fromEntries(Object.entries(free.texts).filter(([a]) => { const p = parseAddr(a); return p.row <= rows && p.col <= cols; }));
      const merges = free.merges.filter((m) => { const q = parseAddr(m.split(':').at(-1)!); return q.row <= rows && q.col <= cols; });
      return { schema: { ...s, free: { ...free, rows, cols, texts, merges } } };
    }
    case 'merge': {
      if (o.rect.r1 === o.rect.r2 && o.rect.c1 === o.rect.c2) return { error: '합칠 칸을 2개 이상 골라 주세요.' };
      const g = regionHit(s, o.rect);
      if (g) return { error: `'${g.name}' 영역은 합칠 수 없어요. 글자 칸끼리만 합쳐요.` };
      const keep = addr(o.rect.c1, o.rect.r1);
      const inside = new Set(cellsOf(o.rect));
      const texts = Object.fromEntries(Object.entries(free.texts).filter(([a]) => a === keep || !inside.has(a)));
      const merges = [...free.merges.filter((m) => { const [a, b = a] = m.split(':'); return !hits(rectOf(a, b), o.rect); }), rectText(o.rect)];
      return { schema: { ...s, free: { ...free, texts, merges } } };
    }
    case 'unmerge': {
      const merges = free.merges.filter((m) => { const [a, b = a] = m.split(':'); return !hits(rectOf(a, b), o.rect); });
      if (merges.length === free.merges.length) return { error: '고른 곳에 합친 칸이 없어요.' };
      return { schema: { ...s, free: { ...free, merges } } };
    }
    case 'mark': return mark(s, free, o);
    case 'unmark': {
      const gone = freeRegions(s).filter((g) => hits(g, o.rect));
      if (!gone.length) return { error: '고른 곳에 지정된 입력 영역이 없어요.' };
      const texts = { ...free.texts };
      const places = { ...free.places };
      const dropKeys = new Set(gone.flatMap((g) => (g.key ? [g.key] : [])));
      const dropBlocks = new Set(gone.filter((g) => !g.key).map((g) => g.blockId));
      // 줄 영역·숫자 표를 풀면 머리글·제목을 글자 칸으로 돌려놓는다
      for (const b of s.blocks) {
        if (!dropBlocks.has(b.id)) continue;
        const p = parseAddr(free.places[b.id]);
        if (b.kind === 'list') b.columns.forEach((f, i) => { if (f.label.trim()) texts[addr(p.col + i, p.row)] = f.label; });
        if (b.kind === 'matrix') {
          b.colLabels.forEach((l, i) => { if (l.trim()) texts[addr(p.col + 1 + i, p.row)] = l; });
          b.rowLabels.forEach((l, i) => { if (l.trim()) texts[addr(p.col, p.row + 1 + i)] = l; });
        }
        delete places[b.id];
      }
      for (const k of dropKeys) delete places[k];
      const blocks = s.blocks
        .filter((b) => !dropBlocks.has(b.id))
        .map((b) => (b.kind === 'fields' ? { ...b, fields: b.fields.filter((f) => !dropKeys.has(f.key)) } : b));
      return { schema: tidy({ ...s, blocks, free: { ...free, texts, places } }) };
    }
    case 'move': {
      const regions = freeRegions(s);
      const g = regions.find((x) => x.blockId === o.blockId && x.key === o.key);
      if (!g) return { error: '옮길 영역을 찾지 못했어요.' };
      const p = parseAddr(o.to);
      const to: Rect = { r1: p.row, c1: p.col, r2: p.row + g.r2 - g.r1, c2: p.col + g.c2 - g.c1 };
      const other = regions.find((x) => x !== g && hits(x, to));
      if (other) return { error: `그 자리에는 '${other.name}' 영역이 있어요.` };
      const text = Object.keys(free.texts).find((a) => { const q = parseAddr(a); return inRegion(to, q.row, q.col); });
      if (text) return { error: `그 자리(${sheetAddr(s, text)})에 글자 칸이 있어요. 글자를 지우거나 다른 곳으로 옮겨 주세요.` };
      const places = { ...free.places, [o.key ?? o.blockId]: o.to };
      const size = freeSize({ ...s, free: { ...free, places } });
      return { schema: { ...s, free: { ...free, places, rows: Math.max(free.rows, size.rows), cols: Math.max(free.cols, size.cols) } } };
    }
  }
}

function mark(s: FormSchema, free: FreeSpec, o: Extract<FreeOp, { op: 'mark' }>): FreeResult {
  const { rect } = o;
  const keys = [...o.keys];
  const nextKey = () => keys.shift() ?? `f_${Math.random().toString(36).slice(2, 6)}`;
  const texts = { ...free.texts };
  const places = { ...free.places };
  const regions = freeRegions(s);
  const used = new Set(s.blocks.flatMap((b) => (b.kind === 'fields' ? b.fields.map((f) => f.label) : [])));
  const takeText = (a: string) => { const t = texts[a]?.trim(); delete texts[a]; return t || undefined; };
  const merges = free.merges.filter((m) => { const [a, b = a] = m.split(':'); return !hits(rectOf(a, b), rect); });

  if (o.kind === 'fields') {
    const fresh: Field[] = [];
    for (const a of cellsOf(rect)) {
      const p = parseAddr(a);
      if (regions.some((g) => inRegion(g, p.row, p.col))) continue;
      delete texts[a];
      // 이름: 왼쪽 글자 칸(고른 범위 밖), 없으면 "입력 칸 n"
      const left = p.col > 1 && p.col - 1 < rect.c1 ? free.texts[addr(p.col - 1, p.row)]?.trim() : undefined;
      const label = left && !used.has(left) ? (used.add(left), left) : uniqueLabel(used, '입력 칸');
      const key = nextKey();
      fresh.push(newField(key, 'text', label));
      places[key] = a;
    }
    if (!fresh.length) return { error: '고른 칸은 이미 입력 영역이에요.' };
    const has = s.blocks.find((b): b is FieldsBlock => b.kind === 'fields');
    const blocks = has
      ? s.blocks.map((b) => (b === has ? { ...has, fields: [...has.fields, ...fresh] } : b))
      : [{ kind: 'fields', id: 'b0', fields: fresh } as FieldsBlock, ...s.blocks];
    return { schema: tidy({ ...s, blocks, free: { ...free, texts, places, merges } }) };
  }

  const g = regions.find((x) => hits(x, rect));
  if (g) return { error: `고른 곳에 '${g.name}' 영역이 있어요. 먼저 지정을 풀어 주세요.` };
  const id = `b${s.blocks.length + 100}`;   // tidy가 다시 매긴다
  places[id] = addr(rect.c1, rect.r1);
  const names = new Set(s.blocks.map((b) => b.title ?? ''));

  if (o.kind === 'list') {
    const columns: Field[] = [];
    const colNames = new Set<string>();
    for (let c = rect.c1; c <= rect.c2; c++) {
      const t = takeText(addr(c, rect.r1));
      columns.push(newField(nextKey(), 'text', t && !colNames.has(t) ? (colNames.add(t), t) : uniqueLabel(colNames, '항목')));
    }
    for (const a of cellsOf(rect)) delete texts[a];
    const block: ListBlock = { kind: 'list', id, title: uniqueLabel(names, '입력 줄 영역'), columns, maxRows: Math.max(1, rect.r2 - rect.r1) };
    return { schema: tidy({ ...s, blocks: [...s.blocks, block], free: { ...free, texts, places, merges } }) };
  }

  if (rect.r2 - rect.r1 < 1 || rect.c2 - rect.c1 < 1) return { error: '숫자 표는 2행 2열 이상 골라 주세요. 맨 윗줄은 열 제목, 맨 왼쪽 열은 행 제목이 돼요.' };
  const corner = takeText(addr(rect.c1, rect.r1));
  const colLabels: string[] = [];
  const rowLabels: string[] = [];
  for (let c = rect.c1 + 1; c <= rect.c2; c++) colLabels.push(takeText(addr(c, rect.r1)) ?? `열 ${c - rect.c1}`);
  for (let r = rect.r1 + 1; r <= rect.r2; r++) rowLabels.push(takeText(addr(rect.c1, r)) ?? `행 ${r - rect.r1}`);
  for (const a of cellsOf(rect)) delete texts[a];
  const block: MatrixBlock = {
    kind: 'matrix', id, title: corner && !names.has(corner) ? corner : uniqueLabel(names, '숫자 표'),
    rowLabels, colLabels, cell: { ...newField(nextKey(), 'number', '값'), thousands: true }, totalRow: false, totalCol: false,
  };
  return { schema: tidy({ ...s, blocks: [...s.blocks, block], free: { ...free, texts, places, merges } }) };
}

/** 판 주소의 영역 (없으면 undefined) */
export function regionAt(s: FormSchema, a: string): FreeRegion | undefined {
  const p = parseAddr(a);
  return freeRegions(s).find((g) => inRegion(g, p.row, p.col));
}
