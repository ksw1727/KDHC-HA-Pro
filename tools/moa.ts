/**
 * moa — AI가 한난MOA 양식을 만들 때 쓰는 명령어 (AI로 만들기, tools/ai/AGENTS.md)
 *
 *   moa new <구조> [form.json]   구조별 시작 양식을 만든다 (list·header-list·matrix·fill-in·collect·free)
 *   moa check [form.json]        양식 규칙 검사 (계약 + 내보내기 전 검사). 통과하면 "통과"
 *   moa preview [form.json]      빈 양식 엑셀 모양을 글로 보여 준다 (preset이면 첫 제출처 파일)
 *   moa orgs [검색어]            한난 조직(지사·처·부) 이름 찾기
 *
 * 화면 없이 계약·생성 코드를 그대로 쓴다. 실행: tools/ai/moa (vite-node 래퍼)
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { LAYOUT_LABELS, validateSchema, type FormSchema, type Layout } from '@contract/schema';
import { layoutSheet } from '@contract/layout';
import { validateForExport } from '@gen/state/validateForExport';
import { newSchema, randomKey } from '@gen/state/newSchema';
import { KDHC_TREE, type OrgNode } from '@gen/org/kdhcOrg';

const [cmd = 'help', ...args] = process.argv.slice(2);
const LAYOUTS = Object.keys(LAYOUT_LABELS) as Layout[];

function load(path = 'form.json'): unknown {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (e) {
    console.log(`읽기 실패: ${path} — ${(e as Error).message}`);
    process.exit(2);
  }
}

/** 계약 검사 → 통과하면 내보내기 전 검사. 문제 문장 목록 */
export function problems(x: unknown): { schema?: FormSchema; errors: string[] } {
  const v = validateSchema(x);
  if (!v.ok) return { errors: v.errors };
  const where = { meta: '① 기본 정보', layout: '② 양식 구조', fields: '③ 항목·서식', aggregations: '④ 취합 방식', org: '⑤ 제출처' } as const;
  return { schema: v.schema, errors: validateForExport(v.schema).map((p) => `${where[p.where]}${p.key ? ` [${p.key}]` : ''}: ${p.message}`) };
}

function preview(s: FormSchema): string {
  const org = s.org.mode === 'preset' ? s.org.orgs?.[0] : undefined;
  const m = layoutSheet(s, { mode: 'template', orgName: org }, { today: new Date() });
  const at = new Map(m.cells.map((c) => [c.address, c]));
  let maxR = 0, maxC = 0;
  const pos = (a: string) => { const x = /^([A-Z]+)(\d+)$/.exec(a)!; let c = 0; for (const ch of x[1]) c = c * 26 + ch.charCodeAt(0) - 64; return { r: Number(x[2]), c }; };
  for (const c of m.cells) { const p = pos(c.address); maxR = Math.max(maxR, p.r); maxC = Math.max(maxC, p.c); }
  const col = (n: number) => { let s = ''; while (n) { s = String.fromCharCode(65 + ((n - 1) % 26)) + s; n = Math.floor((n - 1) / 26); } return s; };
  const show = (a: string) => {
    const c = at.get(a);
    if (!c) return '';
    if (c.formula) return '=계산';
    if (c.role === 'input') return c.required ? '[필수]' : '[입력]';
    if (c.role === 'other-input') return '(남의 칸)';
    if (c.role === 'row-number') return '#';
    if (c.role === 'example') return `예) ${c.value ?? ''}`;
    return c.value === undefined || c.value === null ? '' : String(c.value);
  };
  const rows: string[] = [`시트: ${m.sheetName}${org ? ` (${org} 파일)` : ''}   [입력]=작성 칸  [필수]=꼭 채울 칸  =계산=자동 계산`];
  // 같은 입력 줄이 계속되면 두 줄만 보이고 줄인다
  let prev = '', same = 0;
  for (let r = 1; r <= maxR; r++) {
    const line = Array.from({ length: maxC }, (_, i) => show(`${col(i + 1)}${r}`)).join(' | ');
    same = line === prev ? same + 1 : 0;
    prev = line;
    if (same === 2) rows.push('    … (같은 입력 줄 반복)');
    if (same >= 2) continue;
    rows.push(`${String(r).padStart(3)} | ${line}`);
  }
  return rows.join('\n');
}

function orgs(q = ''): string[] {
  const out: string[] = [];
  const walk = (ns: OrgNode[], path: string[]) => {
    for (const n of ns) {
      if (n.selectable && (!q || n.id.includes(q) || n.name.includes(q))) out.push(`${n.id}  (${n.category === 'branch' ? '지사' : '본사'} · ${n.type})`);
      walk(n.children, [...path, n.name]);
    }
  };
  walk(KDHC_TREE, []);
  return out;
}

switch (cmd) {
  case 'new': {
    const layout = args[0] as Layout;
    if (!LAYOUTS.includes(layout)) { console.log(`구조를 골라 주세요: ${LAYOUTS.map((l) => `${l}(${LAYOUT_LABELS[l]})`).join(', ')}`); process.exit(2); }
    const path = args[1] ?? 'form.json';
    writeFileSync(path, JSON.stringify(newSchema(layout, new Date(), { formId: crypto.randomUUID(), key: randomKey }), null, 2));
    console.log(`${path}에 ${LAYOUT_LABELS[layout]} 시작 양식을 만들었어요. 제목·항목·제출처를 채운 뒤 moa check 하세요.`);
    break;
  }
  case 'check': {
    const { errors } = problems(load(args[0]));
    if (!errors.length) { console.log('통과: 이 양식은 내보낼 수 있어요.'); break; }
    console.log(`문제 ${errors.length}개:\n${errors.map((e) => `- ${e}`).join('\n')}`);
    process.exit(1);
  }
  case 'preview': {
    const v = validateSchema(load(args[0]));
    if (!v.ok) { console.log(`먼저 moa check로 고쳐 주세요:\n${v.errors.map((e) => `- ${e}`).join('\n')}`); process.exit(1); }
    console.log(preview(v.schema));
    break;
  }
  case 'orgs': {
    const list = orgs(args.join(' ').trim());
    console.log(list.length ? list.slice(0, 80).join('\n') + (list.length > 80 ? `\n… ${list.length - 80}곳 더` : '') : '찾은 곳이 없어요.');
    break;
  }
  default:
    console.log('moa new <구조> | moa check [form.json] | moa preview [form.json] | moa orgs [검색어]');
}
