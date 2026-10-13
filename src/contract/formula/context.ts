import type { Block, Field, FormSchema, GridBlock, ListBlock, MatrixBlock } from '../schema';
import { formulaProblem, formulaRefs, parseFormula, refsOnlyInAggregates } from './formula';

/**
 * 계산식에서 쓸 수 있는 칸 이름 (01-contract.md 3.1절)
 * - 목록 계산 칸: 같은 목록의 다른 칸(같은 줄) + 위쪽 정보 항목(고정 칸)
 * - 위쪽 정보 계산 항목: 다른 위쪽 정보 항목 + 목록 칸(합계·평균·최소·최대 안에서만, 열 전체)
 * - 표형 계산 열: 열 제목 + '계'(합계 열이 있을 때) + 다른 계산 열 / 계산 행: 행 제목 + '합계' + 다른 계산 행
 * - 빈칸채우기 계산 칸: 칸 이름 (입력·계산 칸은 항목 이름, 고정 칸은 '{행 첫 칸} · {열 머리글}')
 */
export interface FormulaScope {
  names: string[];            // 쓸 수 있는 이름
  aggregateOnly: string[];    // 합계·평균·최소·최대 안에서만 쓸 수 있는 이름
}

export const TOTAL_ROW_NAME = '합계';
export const TOTAL_COL_NAME = '계';

const labels = (fs: Field[]) => fs.map((f) => f.label.trim()).filter(Boolean);

/** 빈칸채우기 고정 칸 이름 */
export function gridFixedName(block: Pick<GridBlock, 'rows' | 'colLabels'>, r: number, c: number): string {
  const first = block.rows[r]?.[0];
  const rowName = first?.kind === 'fixed' ? String(first.value) : `${r + 1}행`;
  const colName = block.colLabels[c]?.trim() || `${c + 1}열`;
  return `${rowName} · ${colName}`;
}

/** 빈칸채우기 표에서 이름 → 칸 위치. 숫자로 계산할 수 있는 칸(고정 숫자·입력·계산)만 */
export function gridNames(block: GridBlock): Map<string, { r: number; c: number }> {
  const m = new Map<string, { r: number; c: number }>();
  block.rows.forEach((row, r) => row.forEach((cell, c) => {
    if (cell.kind === 'input' || cell.kind === 'calc') m.set(cell.field.label.trim(), { r, c });
    else if (cell.kind === 'fixed' && typeof cell.value === 'number') m.set(gridFixedName(block, r, c), { r, c });
  }));
  return m;
}

export function scopeFor(schema: FormSchema, block: Block, field: Field, where: 'row' | 'col' | 'cell' | 'spare' = 'cell'): FormulaScope {
  const self = field.label.trim();
  const other = (xs: string[]) => xs.filter((x) => x !== self);
  const header = schema.blocks.find((b) => b.kind === 'fields');
  const list = schema.blocks.find((b) => b.kind === 'list') as ListBlock | undefined;
  switch (block.kind) {
    case 'list':
      return { names: other([...labels(block.columns), ...(header?.kind === 'fields' ? labels(header.fields) : [])]), aggregateOnly: [] };
    case 'fields':
      return { names: other([...labels(block.fields), ...(list ? labels(list.columns) : [])]), aggregateOnly: list ? labels(list.columns) : [] };
    case 'matrix': {
      const m = block as MatrixBlock;
      if (where === 'row') return { names: other([...m.rowLabels.map((x) => x.trim()), ...(m.totalRow ? [TOTAL_ROW_NAME] : []), ...labels(m.calcRows ?? [])]), aggregateOnly: [] };
      return { names: other([...m.colLabels.map((x) => x.trim()), ...(m.totalCol ? [TOTAL_COL_NAME] : []), ...labels(m.calcCols ?? [])]), aggregateOnly: [] };
    }
    case 'grid':
      if (where === 'spare') return { names: other(labels(block.spareColumns ?? [])), aggregateOnly: [] };
      return { names: other([...gridNames(block).keys()]), aggregateOnly: [] };
  }
}

/** 계산 칸 하나의 문제 (없으면 null) */
export function calcProblem(scope: FormulaScope, formula: string | undefined): string | null {
  const p = formulaProblem(formula, (n) => scope.names.includes(n));
  if (p) return p;
  const node = parseFormula(formula!);
  const outside = formulaRefs(node).filter((r) => scope.aggregateOnly.includes(r) && !refsOnlyInAggregates(node).has(r));
  if (outside.length) return `[${outside[0]}]은 여러 줄이라 합계·평균·최소·최대 안에서만 쓸 수 있어요.`;
  return null;
}

interface CalcEntry { block: Block; field: Field; where: 'row' | 'col' | 'cell' | 'spare' }

/** 양식 안의 모든 계산 칸 */
export function calcEntries(schema: FormSchema): CalcEntry[] {
  const out: CalcEntry[] = [];
  for (const b of schema.blocks) {
    if (b.kind === 'fields') b.fields.filter((f) => f.type === 'calc').forEach((field) => out.push({ block: b, field, where: 'cell' }));
    if (b.kind === 'list') b.columns.filter((f) => f.type === 'calc').forEach((field) => out.push({ block: b, field, where: 'cell' }));
    if (b.kind === 'matrix') {
      (b.calcRows ?? []).forEach((field) => out.push({ block: b, field, where: 'row' }));
      (b.calcCols ?? []).forEach((field) => out.push({ block: b, field, where: 'col' }));
    }
    if (b.kind === 'grid') {
      b.rows.flat().forEach((c) => c.kind === 'calc' && out.push({ block: b, field: c.field, where: 'cell' }));
      if (b.spareRows > 0) (b.spareColumns ?? []).filter((f) => f.type === 'calc').forEach((field) => out.push({ block: b, field, where: 'spare' }));
    }
  }
  return out;
}

/** 계산 칸끼리 서로를 가리켜 끝없이 도는지 */
function hasCycle(entries: CalcEntry[]): string | null {
  const byName = new Map<string, CalcEntry>();
  for (const e of entries) byName.set(`${e.block.id}:${e.where === 'row' ? 'r' : e.where === 'col' ? 'c' : 'x'}:${e.field.label.trim()}`, e);
  const deps = (e: CalcEntry): string[] => {
    try {
      const tag = e.where === 'row' ? 'r' : e.where === 'col' ? 'c' : 'x';
      const self = `${e.block.id}:${tag}:${e.field.label.trim()}`;
      return formulaRefs(parseFormula(e.field.formula ?? '')).map((r) => `${e.block.id}:${tag}:${r}`).filter((k) => byName.has(k) && k !== self);
    } catch {
      return [];
    }
  };
  const state = new Map<string, 1 | 2>();
  const visit = (k: string): string | null => {
    if (state.get(k) === 2) return null;
    if (state.get(k) === 1) return k.split(':').slice(2).join(':');
    state.set(k, 1);
    for (const d of deps(byName.get(k)!)) {
      const c = visit(d);
      if (c) return c;
    }
    state.set(k, 2);
    return null;
  };
  for (const k of byName.keys()) {
    const c = visit(k);
    if (c) return c;
  }
  return null;
}

/** 양식 전체의 계산식 오류 (validateSchema·내보내기 전 검사에서 사용) */
export function formulaErrors(schema: FormSchema): string[] {
  const out: string[] = [];
  let entries: CalcEntry[];
  try {
    entries = calcEntries(schema);
  } catch {
    return out;
  }
  for (const e of entries) {
    const p = calcProblem(scopeFor(schema, e.block, e.field, e.where), e.field.formula);
    if (p) out.push(`${e.field.label || '계산 칸'}: ${p}`);
  }
  const cyc = hasCycle(entries);
  if (cyc) out.push(`${cyc}: 계산 칸끼리 서로를 가리키고 있어요. 순서를 풀어 주세요.`);
  return out;
}
