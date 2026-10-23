import type { Block, Field, FormSchema } from '@contract/schema';
import { LAYOUT_LABELS, blockFields } from '@contract/schema';

/**
 * 칸 구조 열쇠. 이 값이 바뀌면 다시 내보낼 때 formVersion을 올린다 (02-generator.md 2.6).
 * 포함: 구조, 블록, 항목 key·이름·순서·타입·서식·선택지, 표 행·열 제목, 빈칸채우기 칸 종류·고정 값, 시트 모으기 범위.
 * 제외: 제목·안내·기한·문의처·지사 목록·입력 줄 수·필수·작성 안내·예시 줄.
 * (항목 이름도 넣는다: 이름이 바뀌면 이전 버전 파일을 머리글 이름으로 맞출 수 없기 때문)
 */
export function structureKey(s: FormSchema): string {
  const fieldKey = (f: Field) => [f.key, f.label, f.type, f.maxLength, f.decimals ?? 0, f.thousands !== false, f.unit ?? '', f.min, f.max, f.dateFormat, f.minDate, f.maxDate, f.options, f.pattern];
  const blockKey = (b: Block) => {
    switch (b.kind) {
      case 'fields': return ['fields', b.fields.map(fieldKey)];
      case 'list': return ['list', b.columns.map(fieldKey)];
      case 'matrix': return ['matrix', b.rowLabels, b.colLabels, b.totalRow, b.totalCol, fieldKey(b.cell)];
      case 'grid': return ['grid', b.colLabels, b.rows.map((r) => r.map((c) => (c.kind === 'input' ? ['i', fieldKey(c.field)] : c.kind === 'fixed' ? ['f', c.value] : ['b']))), b.spareRows > 0, (b.spareColumns ?? []).map(fieldKey)];
    }
  };
  // 자유 제작형은 칸 위치(놓인 자리·합친 칸)도 구조다: 바뀌면 이전 파일의 셀 지도와 맞지 않는다
  return JSON.stringify([s.layout, s.blocks.map(blockKey), s.collect?.scope ?? null, ...(s.free ? [s.free.places, s.free.merges] : [])]);
}

/**
 * 같은 양식(고친 것)인지, 같은 번호(formId)만 물려받은 다른 양식인지.
 * 제목이 같거나 항목 key가 절반 이상 겹치면 같은 양식으로 본다. 다른 양식이면 버전 판단에 쓰지 않는다.
 */
export function sameForm(a: FormSchema, b: FormSchema): boolean {
  if (a.formId !== b.formId) return false;
  if (a.title.trim() === b.title.trim()) return true;
  const keys = (s: FormSchema) => s.blocks.flatMap((x) => blockFields(x).map((f) => f.key));
  const old = new Set(keys(a));
  const now = keys(b);
  return now.length > 0 && now.filter((k) => old.has(k)).length * 2 >= now.length;
}

/** 다음에 내보낼 버전 */
export function nextVersion(current: FormSchema, lastExported?: FormSchema): number {
  if (!lastExported) return current.formVersion;
  return structureKey(current) === structureKey(lastExported) ? lastExported.formVersion : lastExported.formVersion + 1;
}

const FORMAT_KEYS: (keyof Field)[] = ['maxLength', 'decimals', 'thousands', 'unit', 'min', 'max', 'dateFormat', 'minDate', 'maxDate', 'pattern'];

/** 바뀐 점 요약 (내보내기 확인 창의 "바뀐 것") */
export function diffSummary(prev: FormSchema, next: FormSchema): string[] {
  const out: string[] = [];
  if (prev.layout !== next.layout) out.push(`구조 변경 (${LAYOUT_LABELS[prev.layout]} → ${LAYOUT_LABELS[next.layout]})`);
  const all = (s: FormSchema) => {
    const m = new Map<string, Field>();
    for (const b of s.blocks) {
      if (b.kind === 'fields') b.fields.forEach((f) => m.set(f.key, f));
      if (b.kind === 'list') b.columns.forEach((f) => m.set(f.key, f));
      if (b.kind === 'matrix') m.set(b.cell.key, b.cell);
      if (b.kind === 'grid') b.rows.flat().forEach((c) => c.kind === 'input' && m.set(c.field.key, c.field));
    }
    return m;
  };
  const a = all(prev);
  const b = all(next);
  for (const [k, f] of b) {
    const o = a.get(k);
    if (!o) { out.push(`${f.label} 항목 추가`); continue; }
    if (o.label !== f.label) out.push(`${o.label} → ${f.label} 이름 변경`);
    if (o.type !== f.type) out.push(`${f.label} 타입 변경`);
    else if (JSON.stringify(o.options ?? []) !== JSON.stringify(f.options ?? [])) out.push(`${f.label} 선택지 변경`);
    else if (FORMAT_KEYS.some((p) => JSON.stringify(o[p]) !== JSON.stringify(f[p]))) out.push(`${f.label} 서식 변경`);
  }
  for (const [k, f] of a) if (!b.has(k)) out.push(`${f.label} 항목 삭제`);
  const order = (s: FormSchema) => s.blocks.map((x) => (x.kind === 'list' ? x.columns.map((c) => c.key).join() : x.kind === 'fields' ? x.fields.map((c) => c.key).join() : '')).join('|');
  if (!out.length && order(prev) !== order(next)) out.push('항목 순서 변경');
  const ma = prev.blocks.find((x) => x.kind === 'matrix');
  const mb = next.blocks.find((x) => x.kind === 'matrix');
  if (ma?.kind === 'matrix' && mb?.kind === 'matrix' && JSON.stringify([ma.rowLabels, ma.colLabels]) !== JSON.stringify([mb.rowLabels, mb.colLabels])) out.push('표의 행·열 제목 변경');
  if (!out.length && structureKey(prev) !== structureKey(next)) out.push('칸 구조 변경');
  return out;
}
