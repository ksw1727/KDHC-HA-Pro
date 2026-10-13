import type { Block, Field, FormSchema } from '@contract/schema';
import { orgLabel, validateSchema } from '@contract/schema';
import { resolveDate } from '@contract/fieldTypes';

export type Where = 'meta' | 'layout' | 'fields' | 'aggregations' | 'org';

export interface ExportProblem {
  where: Where;          // 빌더 패널 ①②③④⑤
  blockId?: string;
  key?: string;          // 항목 key (있으면 그 항목을 빨갛게)
  message: string;       // 화면 문구 그대로
}

export const WHERE_LABEL: Record<Where, string> = {
  meta: '① 기본 정보', layout: '② 양식 구조', fields: '③ 항목·서식', aggregations: '④ 취합 방식', org: '⑤ 제출처',
};

function fieldProblems(blockId: string, fields: Field[], out: ExportProblem[]) {
  const seen = new Map<string, number>();
  fields.forEach((f, i) => {
    const p = (message: string) => out.push({ where: 'fields', blockId, key: f.key, message });
    const name = f.label.trim();
    if (!name) p(`${i + 1}번째 항목의 이름을 입력해 주세요.`);
    else {
      seen.set(name, (seen.get(name) ?? 0) + 1);
      if (seen.get(name) === 2) p(`"${name}" 항목이 두 번 있어요. 이름을 바꿔 주세요.`);
    }
    const label = name || `${i + 1}번째 항목`;
    if (f.type === 'select') {
      const opts = (f.options ?? []).map((o) => o.trim()).filter(Boolean);
      if (opts.length === 0) p(`${label}: 선택지가 비어 있어요. 1개 이상 넣어 주세요.`);
      const dup = opts.find((o, j) => opts.indexOf(o) !== j);
      if (dup) p(`${label}: 선택지 "${dup}"가 두 번 있어요.`);
    }
    if (f.type === 'pattern' && !f.pattern) p(`${label}: 패턴 종류를 골라 주세요.`);
    if (f.type === 'number' && f.min != null && f.max != null && f.min > f.max) p(`${label}: 최소값이 최대값보다 커요.`);
    if (f.type === 'date') {
      const today = new Date(2000, 0, 1);
      const lo = f.minDate && !f.minDate.startsWith('today') ? resolveDate(f.minDate, today) : undefined;
      const hi = f.maxDate && !f.maxDate.startsWith('today') ? resolveDate(f.maxDate, today) : undefined;
      if (lo && hi && lo > hi) p(`${label}: 시작 날짜가 끝 날짜보다 늦어요.`);
    }
  });
}

function blockProblems(b: Block, layout: FormSchema['layout'], out: ExportProblem[]) {
  switch (b.kind) {
    case 'fields':
      if (b.fields.length === 0) out.push({ where: 'fields', blockId: b.id, message: '위쪽 정보에 항목을 1개 이상 넣어 주세요.' });
      fieldProblems(b.id, b.fields, out);
      break;
    case 'list':
      if (b.columns.length === 0) out.push({ where: 'fields', blockId: b.id, message: layout === 'header-list' ? '아래 목록에 항목을 1개 이상 넣어 주세요.' : '항목을 1개 이상 넣어 주세요.' });
      if (b.maxRows < 1 || b.maxRows > 5000) out.push({ where: 'fields', blockId: b.id, message: '입력 줄 수는 1~5,000 사이로 정해 주세요.' });
      fieldProblems(b.id, b.columns, out);
      break;
    case 'matrix':
      if (b.rowLabels.filter((x) => x.trim()).length === 0) out.push({ where: 'fields', blockId: b.id, message: '표의 행 제목을 1개 이상 넣어 주세요.' });
      if (b.colLabels.filter((x) => x.trim()).length === 0) out.push({ where: 'fields', blockId: b.id, message: '표의 열 제목을 1개 이상 넣어 주세요.' });
      if (b.rowLabels.some((x) => !x.trim()) || b.colLabels.some((x) => !x.trim())) out.push({ where: 'fields', blockId: b.id, message: '비어 있는 행·열 제목이 있어요.' });
      fieldProblems(b.id, [b.cell], out);
      break;
    case 'grid': {
      const inputs = b.rows.flat().flatMap((c) => (c.kind === 'input' ? [c.field] : []));
      if (inputs.length === 0 && b.spareRows <= 0) out.push({ where: 'fields', blockId: b.id, message: '입력칸을 1개 이상 지정하거나 여유 줄을 넣어 주세요.' });
      fieldProblems(b.id, inputs, out);
      if (b.spareRows > 0) fieldProblems(b.id, b.spareColumns ?? [], out);
      break;
    }
  }
}

/** 내보내기 전 검사 (02-generator.md 2.2). 문제가 없으면 빈 배열. */
export function validateForExport(s: FormSchema): ExportProblem[] {
  const out: ExportProblem[] = [];
  if (!s.title.trim()) out.push({ where: 'meta', message: '제목을 입력해 주세요.' });
  s.blocks.forEach((b) => blockProblems(b, s.layout, out));
  if (s.org.mode === 'preset' && !(s.org.orgs?.length)) {
    out.push({ where: 'org', message: `${orgLabel(s)} 목록이 비어 있어요. 목록을 넣거나 "식별 안 함"을 골라 주세요.` });
  }
  // 위에서 잡지 못한 계약 위반은 그대로 알린다 (구현 오류 대비)
  if (out.length === 0) {
    const r = validateSchema(s);
    if (!r.ok) r.errors.forEach((message) => out.push({ where: 'layout', message }));
  }
  return out;
}
