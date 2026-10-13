import type { Field, FormSchema } from '@contract/schema';
import { orgLabel } from '@contract/schema';
import type { AggregateFill } from '@contract/layout';
import type { CellValue } from '@contract/meta';
import { formatSample } from './formatSample';

/** 미리보기 [취합본]용 가짜 데이터: 지사 3곳 (02-generator.md 2.2). */
export function sampleOrgs(schema: FormSchema): string[] {
  const orgs = schema.org.orgs?.filter(Boolean) ?? [];
  const label = orgLabel(schema);
  const fallback = label === '지사' ? ['서울', '부산', '대구'] : [`${label} A`, `${label} B`, `${label} C`];
  return [...orgs, ...fallback].slice(0, 3);
}

function sampleValue(f: Field, i: number): CellValue {
  if (f.type === 'number') {
    const base = f.unit?.trim() === '원' ? 120000 : f.unit?.trim() === '%' ? 12.5 : 10;
    let n = Math.round(base * (1 + (i % 3) * 0.25) * 100) / 100;
    if (f.max != null) n = Math.min(n, f.max);
    if (f.min != null) n = Math.max(n, f.min);
    return n;
  }
  return formatSample(f, i);
}

export function sampleAggregate(schema: FormSchema): { info: string; data: AggregateFill } {
  const orgs = sampleOrgs(schema);
  const useOrg = schema.org.mode !== 'none';
  const header = schema.blocks.flatMap((b) => (b.kind === 'fields' ? b.fields : []));
  const files = orgs.map((o) => (useOrg ? `${o}.xlsx` : `응답${orgs.indexOf(o) + 1}.xlsx`));
  const autoColumns = [...(useOrg ? [orgLabel(schema)] : []), ...header.map((f) => f.label), '출처 파일'];
  const data: AggregateFill = { autoColumns };
  const info = `취합 미리보기 · 가짜 데이터 ${orgs.length}곳`;

  const list = schema.blocks.find((b) => b.kind === 'list');
  if (list?.kind === 'list') {
    const plan = [0, 0, 1, 2]; // 서울 2줄, 부산 1줄, 대구 1줄
    data.rows = plan.map((o, i) => ({
      values: Object.fromEntries(list.columns.map((f) => [f.key, sampleValue(f, i)])),
      auto: [...(useOrg ? [orgs[o]] : []), ...header.map((f) => sampleValue(f, o)), files[o]],
    }));
  }
  const matrix = schema.blocks.find((b) => b.kind === 'matrix');
  if (matrix?.kind === 'matrix') {
    data.matrixSums = matrix.rowLabels.map((_, r) => matrix.colLabels.map((__, c) => 30 + ((r * 7 + c * 5) % 17)));
  }
  const grid = schema.blocks.find((b) => b.kind === 'grid');
  if (grid?.kind === 'grid') {
    data.grid = {};
    grid.rows.flat().forEach((c, i) => {
      if (c.kind === 'input') data.grid![c.field.key] = { value: sampleValue(c.field, i), note: `출처: ${files[i % files.length]}` };
    });
    if (grid.spareRows > 0) {
      data.autoColumns = [...(useOrg ? [orgLabel(schema)] : []), '출처 파일'];
      data.gridSpare = [0, 1].map((o) => ({
        values: (grid.spareColumns ?? []).map((f) => sampleValue(f, o)),
        auto: [...(useOrg ? [orgs[o]] : []), files[o]],
      }));
    }
  }
  return { info, data };
}
