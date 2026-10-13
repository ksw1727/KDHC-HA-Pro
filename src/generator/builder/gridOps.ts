import type { Field, GridBlock, GridCell } from '@contract/schema';
import { newField, patchField } from '../state/fieldDefaults';

export type GridData = Pick<GridBlock, 'colLabels' | 'rows' | 'spareRows' | 'spareColumns'>;
export interface Range { r1: number; c1: number; r2: number; c2: number }

export const norm = (g: Range): Range => ({ r1: Math.min(g.r1, g.r2), c1: Math.min(g.c1, g.c2), r2: Math.max(g.r1, g.r2), c2: Math.max(g.c1, g.c2) });
const inRange = (rg: Range, r: number, c: number) => r >= rg.r1 && r <= rg.r2 && c >= rg.c1 && c <= rg.c2;

/** 입력칸 이름 자동: {행 첫 칸} · {열 머리글} */
export function inputName(g: GridData, r: number, c: number): string {
  const first = g.rows[r]?.[0];
  const rowName = first?.kind === 'fixed' ? String(first.value) : `${r + 1}행`;
  const colName = g.colLabels[c]?.trim() || `${c + 1}열`;
  return `${rowName} · ${colName}`;
}

/**
 * 겹치지 않는 자동 이름. 행 첫 칸이 같아 이름이 겹치면(12/24 주간·야간 등) "(n행)"을, 그래도 겹치면 "(n행 m열)"을 붙인다.
 */
export function autoName(g: GridData, r: number, c: number): string {
  const base = inputName(g, r, c);
  const same: [number, number][] = [];
  g.rows.forEach((row, ri) => row.forEach((cell, ci) => {
    if ((cell.kind === 'input' || cell.kind === 'calc' || (ri === r && ci === c)) && inputName(g, ri, ci) === base) same.push([ri, ci]);
  }));
  if (same.length <= 1) return base;
  return same.filter(([ri]) => ri === r).length > 1 ? `${base} (${r + 1}행 ${c + 1}열)` : `${base} (${r + 1}행)`;
}

/**
 * 표가 바뀐 뒤 자동 이름을 맞춘다: 지금 이름이 바뀌기 전 자동 이름(또는 겹침 표시 없는 기본 이름)이면
 * 새 자동 이름으로 바꾼다. 운영자가 직접 고친 이름은 그대로 둔다.
 */
export function relabel(prev: GridData, next: GridData): GridData {
  return {
    ...next,
    rows: next.rows.map((row, r) => row.map((cell, c): GridCell => {
      if (cell.kind !== 'input' && cell.kind !== 'calc') return cell;
      const was = prev.rows[r]?.[c];
      const sameField = (was?.kind === 'input' || was?.kind === 'calc') && was.field.key === cell.field.key;
      const auto = new Set([inputName(next, r, c), ...(sameField ? [autoName(prev, r, c), inputName(prev, r, c)] : [])]);
      const name = autoName(next, r, c);
      return auto.has(cell.field.label) && cell.field.label !== name ? { ...cell, field: { ...cell.field, label: name } } : cell;
    })),
  };
}

/** 고른 범위의 입력칸 모두에 같은 설정 적용 (이름·key는 그대로) */
export function applyToInputs(g: GridData, range: Range, patch: Partial<Field>): GridData {
  const rg = norm(range);
  const { key: _k, label: _l, ...rest } = patch;
  return {
    ...g,
    rows: g.rows.map((row, r) => row.map((cell, c): GridCell => (inRange(rg, r, c) && cell.kind === 'input' ? { kind: 'input', field: patchField(cell.field, rest) } : cell))),
  };
}

/** 범위를 입력칸으로. 같은 설정(template)을 모두에 적용. 이미 입력칸이면 이름·key 유지 */
export function setInputs(g: GridData, range: Range, key: () => string, template?: Partial<Field>): GridData {
  const rg = norm(range);
  return {
    ...g,
    rows: g.rows.map((row, r) => row.map((cell, c): GridCell => {
      if (!inRange(rg, r, c)) return cell;
      const base = cell.kind === 'input' ? cell.field : newField(key(), template?.type ?? 'text', cell.kind === 'calc' ? cell.field.label : inputName(g, r, c));
      const { key: _k, label: _l, ...rest } = template ?? {};
      return { kind: 'input', field: { ...base, ...rest } };
    })),
  };
}

export function setFixed(g: GridData, range: Range): GridData {
  const rg = norm(range);
  return { ...g, rows: g.rows.map((row, r) => row.map((cell, c): GridCell => (inRange(rg, r, c) && cell.kind !== 'fixed' ? { kind: 'fixed', value: '' } : cell))) };
}

export function setBlank(g: GridData, range: Range): GridData {
  const rg = norm(range);
  return { ...g, rows: g.rows.map((row, r) => row.map((cell, c): GridCell => (inRange(rg, r, c) ? { kind: 'blank' } : cell))) };
}

/** 칸에 글자 입력 → 고정 칸 (비우면 빈칸) */
export function setValue(g: GridData, r: number, c: number, text: string): GridData {
  const t = text.trim();
  const n = Number(t.replace(/,/g, ''));
  const value = /^-?[\d,]+(\.\d+)?$/.test(t) && !Number.isNaN(n) ? n : t;
  return { ...g, rows: g.rows.map((row, ri) => row.map((cell, ci): GridCell => (ri === r && ci === c ? (t === '' ? { kind: 'blank' } : { kind: 'fixed', value }) : cell))) };
}

export function addRow(g: GridData, at = g.rows.length): GridData {
  const row: GridCell[] = g.colLabels.map(() => ({ kind: 'blank' }));
  return { ...g, rows: [...g.rows.slice(0, at), row, ...g.rows.slice(at)] };
}

export function removeRow(g: GridData, r: number): GridData {
  return { ...g, rows: g.rows.filter((_, i) => i !== r) };
}

export function addCol(g: GridData, key: () => string, at = g.colLabels.length): GridData {
  return syncSpare({
    ...g,
    colLabels: [...g.colLabels.slice(0, at), '', ...g.colLabels.slice(at)],
    rows: g.rows.map((row) => [...row.slice(0, at), { kind: 'blank' } as GridCell, ...row.slice(at)]),
  }, key);
}

export function removeCol(g: GridData, c: number, key: () => string): GridData {
  if (g.colLabels.length <= 1) return g;
  return syncSpare({
    ...g,
    colLabels: g.colLabels.filter((_, i) => i !== c),
    rows: g.rows.map((row) => row.filter((_, i) => i !== c)),
    spareColumns: g.spareColumns?.filter((_, i) => i !== c),
  }, key);
}

/** 여유 줄 열 규칙 수를 머리글 수에 맞춘다 (이름 = 머리글) */
export function syncSpare(g: GridData, key: () => string): GridData {
  if (g.spareRows <= 0) {
    const { spareColumns: _s, ...rest } = g;
    return rest;
  }
  const cols = g.colLabels.map((label, i) => {
    const old = g.spareColumns?.[i];
    const name = label.trim() || `${i + 1}열`;
    return old ? { ...old, label: name } : newField(key(), 'text', name);
  });
  return { ...g, spareColumns: cols };
}

/** 붙여넣은 표: 첫 줄 = 머리글, 나머지 = 고정 칸 */
export function fromPaste(table: (string | number | null)[][]): GridData {
  if (table.length === 0) return { colLabels: ['구분'], rows: [], spareRows: 0 };
  const [head, ...body] = table;
  return {
    colLabels: head.map((h) => (h == null ? '' : String(h))),
    rows: body.map((r) => r.map((v): GridCell => (v == null ? { kind: 'blank' } : { kind: 'fixed', value: v }))),
    spareRows: 0,
  };
}

/** 범위를 계산 칸으로 (계산식은 비어 있음) */
export function setCalc(g: GridData, range: Range, key: () => string): GridData {
  const rg = norm(range);
  return {
    ...g,
    rows: g.rows.map((row, r) => row.map((cell, c): GridCell => {
      if (!inRange(rg, r, c)) return cell;
      if (cell.kind === 'calc') return cell;
      const label = cell.kind === 'input' ? cell.field.label : inputName(g, r, c);
      return { kind: 'calc', field: newField(cell.kind === 'input' ? cell.field.key : key(), 'calc', label) };
    })),
  };
}
