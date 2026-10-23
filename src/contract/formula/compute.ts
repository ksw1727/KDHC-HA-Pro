import type { Field, FormSchema, GridBlock, ListBlock, MatrixBlock } from '../schema';
import { evaluate, parseFormula, type Node, type Value } from './formula';
import { gridFixedName, TOTAL_COL_NAME, TOTAL_ROW_NAME } from './context';

/**
 * 계산 칸 값 구하기 (01-contract.md 3.1절). 취합본은 입력값만 모아서 이 함수들로 다시 계산한다.
 * 비율처럼 더하면 틀리는 값이 있으므로 계산 칸의 지사 값을 더하지 않는다.
 */

const parsed = new Map<string, Node | null>();
function nodeOf(formula: string | undefined): Node | null {
  const src = formula ?? '';
  if (!parsed.has(src)) {
    try { parsed.set(src, parseFormula(src)); } catch { parsed.set(src, null); }
  }
  return parsed.get(src)!;
}

/** 이름 → 값 함수로 계산 칸 여러 개를 서로 참조까지 풀어서 계산 */
function solve(calcs: Field[], base: (name: string, agg: boolean) => Value | Value[] | undefined): Map<string, Value> {
  const byName = new Map(calcs.map((f) => [f.label.trim(), f]));
  const done = new Map<string, Value>();
  const busy = new Set<string>();
  const valueOf = (name: string, agg: boolean): Value | Value[] | undefined => {
    const f = byName.get(name);
    if (!f) return base(name, agg);
    if (done.has(name)) return done.get(name)!;
    if (busy.has(name)) return null; // 순환은 검사 단계에서 막지만, 여기서는 빈칸
    busy.add(name);
    const n = nodeOf(f.formula);
    let v: Value = null;
    try { v = n ? evaluate(n, valueOf) : null; } catch { v = null; }
    // 소수 계산 찌꺼기(93.60000000000001)는 엑셀처럼 유효숫자 15자리로 정리
    if (typeof v === 'number' && Number.isFinite(v)) v = Number(v.toPrecision(15));
    busy.delete(name);
    done.set(name, v);
    return v;
  };
  for (const f of calcs) valueOf(f.label.trim(), false);
  return done;
}

/** 목록 한 줄의 계산 칸. header = 위쪽 정보 값(이름 → 값) */
export function computeListRow(block: ListBlock, values: Record<string, Value>, header: Record<string, Value> = {}): Record<string, Value> {
  const calcs = block.columns.filter((c) => c.type === 'calc');
  if (!calcs.length) return values;
  const byLabel = new Map(block.columns.map((c) => [c.label.trim(), c.key]));
  const r = solve(calcs, (name) => (byLabel.has(name) ? values[byLabel.get(name)!] ?? null : name in header ? header[name] : undefined));
  const out = { ...values };
  for (const c of calcs) out[c.key] = r.get(c.label.trim()) ?? null;
  return out;
}

/** 위쪽 정보 계산 항목 (목록 열 전체를 합계·평균 등으로 쓸 수 있음). 값은 key → 값 */
export function computeHeader(schema: FormSchema, header: Record<string, Value>, rows: Record<string, Value>[]): Record<string, Value> {
  const fb = schema.blocks.find((b) => b.kind === 'fields');
  if (fb?.kind !== 'fields') return header;
  const calcs = fb.fields.filter((f) => f.type === 'calc');
  if (!calcs.length) return header;
  const list = schema.blocks.find((b) => b.kind === 'list') as ListBlock | undefined;
  const hLabel = new Map(fb.fields.map((f) => [f.label.trim(), f.key]));
  const lLabel = new Map((list?.columns ?? []).map((f) => [f.label.trim(), f.key]));
  const r = solve(calcs, (name, agg) => {
    if (hLabel.has(name)) return header[hLabel.get(name)!] ?? null;
    if (agg && lLabel.has(name)) return rows.map((row) => row[lLabel.get(name)!] ?? null);
    return undefined;
  });
  const out = { ...header };
  for (const f of calcs) out[f.key] = r.get(f.label.trim()) ?? null;
  return out;
}

const sum = (xs: Value[]) => xs.reduce<number>((s, v) => s + (typeof v === 'number' ? v : 0), 0);

export interface MatrixFull {
  rowNames: string[];   // 행 제목 + (합계) + 계산 행
  colNames: string[];   // 열 제목 + (계) + 계산 열
  values: Value[][];    // [row][col]
}

/**
 * 표형 전체 값: 입력값 → 합계 행·계 열 → 계산 열(행마다) → 계산 행(열마다).
 * 계산 행 × 계산 열이 만나는 칸은 계산 열의 식을 그 행에 적용한다.
 */
export function computeMatrix(block: MatrixBlock, input: Value[][]): MatrixFull {
  const nR = block.rowLabels.length;
  const nC = block.colLabels.length;
  const calcCols = block.calcCols ?? [];
  const calcRows = block.calcRows ?? [];
  const colNames = [...block.colLabels.map((x) => x.trim()), ...(block.totalCol ? [TOTAL_COL_NAME] : []), ...calcCols.map((f) => f.label.trim())];
  const rowNames = [...block.rowLabels.map((x) => x.trim()), ...(block.totalRow ? [TOTAL_ROW_NAME] : []), ...calcRows.map((f) => f.label.trim())];

  // 1) 입력 행 + 합계 행 (계산 열 제외 부분)
  const base: Value[][] = [];
  for (let r = 0; r < nR; r++) {
    const row = Array.from({ length: nC }, (_, c) => input[r]?.[c] ?? null);
    if (block.totalCol) row.push(sum(row));
    base.push(row);
  }
  if (block.totalRow) {
    const width = nC + (block.totalCol ? 1 : 0);
    base.push(Array.from({ length: width }, (_, c) => sum(base.slice(0, nR).map((row) => row[c]))));
  }
  // 2) 계산 행 (열마다, 계산 열 제외 부분)
  const baseNames = rowNames.slice(0, base.length);
  const width0 = nC + (block.totalCol ? 1 : 0);
  for (let c = 0; c < width0; c++) {
    const res = solve(calcRows, (name) => {
      const i = baseNames.indexOf(name);
      return i >= 0 ? base[i][c] : undefined;
    });
    calcRows.forEach((f, k) => {
      if (!base[baseNames.length + k]) base[baseNames.length + k] = [];
      base[baseNames.length + k][c] = res.get(f.label.trim()) ?? null;
    });
  }
  // 3) 계산 열 (모든 행에 대해)
  const leftNames = colNames.slice(0, width0);
  const values = base.map((row) => {
    const res = solve(calcCols, (name) => {
      const i = leftNames.indexOf(name);
      return i >= 0 ? row[i] ?? null : undefined;
    });
    return [...row.slice(0, width0), ...calcCols.map((f) => res.get(f.label.trim()) ?? null)];
  });
  return { rowNames, colNames, values };
}

/** 빈칸채우기 계산 칸 값 (key → 값). inputs = 입력칸 key → 값 */
export function computeGrid(block: GridBlock, inputs: Record<string, Value>): Record<string, Value> {
  const calcs = block.rows.flat().flatMap((c) => (c.kind === 'calc' ? [c.field] : []));
  if (!calcs.length) return {};
  const named = new Map<string, Value>();
  block.rows.forEach((row, r) => row.forEach((cell, c) => {
    if (cell.kind === 'input') named.set(cell.field.label.trim(), inputs[cell.field.key] ?? null);
    else if (cell.kind === 'fixed' && typeof cell.value === 'number') named.set(gridFixedName(block, r, c), cell.value);
  }));
  const res = solve(calcs, (name) => (named.has(name) ? named.get(name)! : undefined));
  return Object.fromEntries(calcs.map((f) => [f.key, res.get(f.label.trim()) ?? null]));
}

/** 빈칸채우기 여유 줄 한 줄의 계산 칸 (값은 열 순서 배열) */
export function computeSpareRow(block: GridBlock, values: Value[]): Value[] {
  const cols = block.spareColumns ?? [];
  const calcs = cols.filter((f) => f.type === 'calc');
  if (!calcs.length) return values;
  const res = solve(calcs, (name) => {
    const i = cols.findIndex((f) => f.label.trim() === name);
    return i >= 0 ? values[i] ?? null : undefined;
  });
  return cols.map((f, i) => (f.type === 'calc' ? res.get(f.label.trim()) ?? null : values[i] ?? null));
}
