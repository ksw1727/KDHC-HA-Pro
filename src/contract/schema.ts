import { CONTRACT_VERSION } from './version';
import { formulaErrors } from './formula/context';
import { AGGREGATION_IDS, AGGREGATION_REQUIRED, availableAggregations, type AggregationId } from './aggregationIds';

export type FieldType = 'text' | 'number' | 'date' | 'select' | 'memo' | 'pattern' | 'calc';

export interface Field {
  key: string;            // 내부 식별자. 생성 시 자동 발급(예: "f_8k2m"), 이후 절대 변경하지 않음
  label: string;          // 엑셀 머리글로 보이는 이름. 같은 블록 안에서 중복 불가
  type: FieldType;
  required: boolean;
  help?: string;          // 작성 안내. 엑셀 입력 메시지로 표시

  // ── 서식 (해당 타입에서만 의미 있음) ──
  maxLength?: number;                         // text
  decimals?: number;                          // number. 0 = 정수(기본), 1~4 = 소수 자릿수
  thousands?: boolean;                        // number. 천 단위 쉼표 표시 (기본 true)
  unit?: string;                              // number. 표시 단위, 예: '개', '원', '명', '%'
  min?: number; max?: number;                 // number
  dateFormat?: 'yyyy-mm-dd' | 'yyyy.mm.dd' | 'yyyy-mm' | 'yyyy';   // date (기본 yyyy-mm-dd). 'yyyy' = 연도
  minDate?: string; maxDate?: string;         // date. 'YYYY-MM-DD' 또는 상대값 'today', 'today+30', 'today-7'
  options?: string[];                         // select (1개 이상, 중복 불가)
  pattern?: 'phone' | 'mobile' | 'email' | 'bizno';   // pattern (필수)
  formula?: string;                           // calc (필수). 칸 이름으로 쓴 계산식, 예: '[여] ÷ ([남] + [여]) × 100' (3.1절)
}

export interface FieldsBlock { kind: 'fields'; id: string; title?: string; fields: Field[]; }

export interface ListBlock {
  kind: 'list'; id: string; title?: string;
  columns: Field[];
  maxRows: number;               // 입력 줄 수 (기본 100, D3)
  exampleRow?: Record<string, string | number>;   // 첫 줄 회색 예시(선택). key = field.key
}

export interface MatrixBlock {
  kind: 'matrix'; id: string; title?: string;
  rowLabels: string[];     // 예: ['1학년', '2학년']
  colLabels: string[];     // 예: ['남', '여']
  cell: Field;             // 모든 칸에 적용되는 규칙. type은 반드시 'number'
  totalRow: boolean;       // 합계 행 표시 여부 (빈 양식에는 수식, 취합본에는 값)
  totalCol: boolean;       // 합계 열(계) 표시 여부
  calcRows?: Field[];      // 계산 행 (type 'calc'). 계산식은 행 제목·'합계'·앞의 계산 행 이름을 쓴다. 표 아래(합계 행 다음)에 놓인다
  calcCols?: Field[];      // 계산 열 (type 'calc'). 계산식은 열 제목·'계'·앞의 계산 열 이름을 쓴다. 표 오른쪽(계 열 다음)에 놓인다
}

/** 빈칸채우기형: 본사가 채운 표 + 빈 입력칸. 모두에게 같은 표를 보내고 채운 칸을 겹쳐 합친다. */
export type GridCell =
  | { kind: 'fixed'; value: string | number }   // 본사가 미리 채운 고정 내용 (잠금)
  | { kind: 'input'; field: Field }             // 작성자가 채우는 칸 (field.key는 블록 안에서 유일)
  | { kind: 'calc'; field: Field }              // 계산 칸 (field.type = 'calc', 잠금). 다른 칸 이름(3.1절)을 쓴다
  | { kind: 'blank' };                          // 아무것도 아닌 빈칸 (잠금)

export interface GridBlock {
  kind: 'grid'; id: string; title?: string;
  colLabels: string[];        // 머리글 행. 빈 문자열 허용
  rows: GridCell[][];         // [row][col], 길이 = colLabels.length
  spareRows: number;          // 표 아래 여유 줄 수. 0이면 줄 추가 불가
  spareColumns?: Field[];     // 여유 줄의 열 규칙. spareRows > 0이면 필수, 길이 = colLabels.length
}

export type Block = FieldsBlock | ListBlock | MatrixBlock | GridBlock;

export type Layout = 'list' | 'matrix' | 'header-list' | 'fill-in' | 'collect';

/** 시트 모으기형 설정. layout = 'collect'일 때만 쓴다. */
export interface CollectSpec {
  scope: 'report' | 'all';          // 취합 때 모을 시트. 'report'(기본) = 보고서 시트만, 'all' = 파일 안의 보이는 시트 전부
  starter?: (string | number | null)[][];   // 시트 시작 모양: 4행부터 넣을 기본 틀(엑셀에서 붙여넣은 표). 없으면 빈 시트
}

export interface FormSchema {
  contractVersion: 1;
  formId: string;          // UUID v4. 양식 동일성 판별 기준
  formVersion: number;     // 1부터 시작. 칸 구조를 바꿔 다시 내보낼 때마다 +1
  title: string;
  guide?: string;          // 작성 안내 문구 (예: "11월 5일까지 회신")
  deadline?: string;       // 'YYYY-MM-DD'
  contact?: string;        // 문의처
  layout: Layout;
  blocks: Block[];                 // collect는 빈 배열
  collect?: CollectSpec;           // layout = 'collect'일 때 필수
  aggregations: AggregationId[];   // 기본 선택된 취합 방식. 필수 방식(AGGREGATION_REQUIRED)은 항상 포함
  org: {
    mode: 'preset' | 'input' | 'none';
    orgs?: string[];       // preset: 필수(1개 이상). input: 선택(있으면 지사명 칸이 드롭다운). none: 사용 안 함
    label?: string;        // 제출처를 부르는 말. 기본 '지사'. 예: '부서', '기관'
  };
  createdAt: string;       // ISO 8601
  updatedAt: string;
}

export const LAYOUT_LABELS: Record<Layout, string> = {
  list: '목록형',
  matrix: '표형',
  'header-list': '혼합형',
  'fill-in': '빈칸채우기형',
  collect: '시트 모으기형',
};

/** 구조별 블록 종류 순서 (01-contract.md 3절 표). */
const LAYOUT_BLOCKS: Record<Layout, Block['kind'][]> = {
  list: ['list'],
  matrix: ['matrix'],
  'header-list': ['fields', 'list'],
  'fill-in': ['grid'],
  collect: [],
};

/** 블록 안의 모든 항목(Field). 표형은 cell 하나, 빈칸채우기형은 입력칸 + 여유 줄 규칙. */
export function blockFields(block: Block): Field[] {
  switch (block.kind) {
    case 'fields': return block.fields;
    case 'list': return block.columns;
    case 'matrix': return [block.cell, ...(block.calcRows ?? []), ...(block.calcCols ?? [])];
    case 'grid': {
      const inputs = block.rows.flat().flatMap((c) => (c.kind === 'input' || c.kind === 'calc' ? [c.field] : []));
      return [...inputs, ...(block.spareRows > 0 ? block.spareColumns ?? [] : [])];
    }
  }
}

export const isCalc = (f: Pick<Field, 'type'>) => f.type === 'calc';

export function orgLabel(schema: Pick<FormSchema, 'org'>): string {
  return schema.org.label?.trim() || '지사';
}

export type ValidateResult = { ok: true; schema: FormSchema } | { ok: false; errors: string[] };

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);

/** 양식 정의가 계약을 지키는지 검사한다. 양식 파일 불러오기·되살리기·내보내기 전에 쓴다. */
export function validateSchema(x: unknown): ValidateResult {
  const errors: string[] = [];
  if (!isObj(x)) return { ok: false, errors: ['양식 정의가 객체가 아니에요'] };
  const s = x as unknown as FormSchema;

  if (s.contractVersion !== CONTRACT_VERSION) errors.push(`contractVersion은 ${CONTRACT_VERSION}이어야 해요`);
  if (typeof s.formId !== 'string' || !s.formId) errors.push('formId가 없어요');
  if (!Number.isInteger(s.formVersion) || s.formVersion < 1) errors.push('formVersion은 1 이상의 정수여야 해요');
  if (typeof s.title !== 'string') errors.push('title이 없어요');
  if (!(s.layout in LAYOUT_BLOCKS)) {
    errors.push(`알 수 없는 layout: ${String(s.layout)}`);
    return { ok: false, errors };
  }
  if (!Array.isArray(s.blocks)) {
    errors.push('blocks가 배열이 아니에요');
    return { ok: false, errors };
  }

  const kinds = s.blocks.map((b) => b?.kind);
  const expected = LAYOUT_BLOCKS[s.layout];
  if (kinds.length !== expected.length || kinds.some((k, i) => k !== expected[i])) {
    errors.push(`${s.layout} 구조의 블록은 [${expected.join(', ')}] 이어야 해요 (지금: [${kinds.join(', ')}])`);
  }
  s.blocks.forEach((b, i) => {
    if (b?.id !== `b${i + 1}`) errors.push(`블록 id는 b${i + 1}이어야 해요`);
  });

  // 항목 key 중복 (양식 전체에서 유일)
  const keys = new Set<string>();
  for (const b of s.blocks) {
    if (!b?.kind) continue;
    for (const f of blockFields(b)) {
      if (keys.has(f.key)) errors.push(`항목 key가 겹쳐요: ${f.key}`);
      keys.add(f.key);
    }
  }

  for (const b of s.blocks) {
    if (b?.kind === 'matrix' && b.cell?.type !== 'number') errors.push('표형 칸은 숫자 타입이어야 해요');
    if (b?.kind === 'grid') {
      const width = b.colLabels.length;
      if (b.rows.some((r) => r.length !== width)) errors.push('빈칸채우기 표의 각 행 칸 수가 머리글 수와 달라요');
      const inputs = b.rows.flat().filter((c) => c.kind === 'input').length;
      if (inputs === 0 && b.spareRows <= 0) errors.push('빈칸채우기형은 입력칸이 1개 이상이거나 여유 줄이 있어야 해요');
      if (b.spareRows > 0 && b.spareColumns?.length !== width) errors.push('여유 줄의 열 규칙 수가 머리글 수와 달라요');
    }
  }

  for (const msg of formulaErrors(s)) errors.push(msg);

  if (s.layout === 'collect') {
    if (!s.collect || (s.collect.scope !== 'report' && s.collect.scope !== 'all')) errors.push('시트 모으기형은 collect 설정이 필요해요');
    if (s.org?.mode === 'input') errors.push('시트 모으기형은 지사명 입력 방식을 쓸 수 없어요');
  }

  if (!isObj(s.org) || !['preset', 'input', 'none'].includes(s.org.mode)) errors.push('org.mode가 올바르지 않아요');
  else if (s.org.mode === 'preset' && !(s.org.orgs && s.org.orgs.length > 0)) errors.push('지사 목록(preset)에는 1곳 이상이 필요해요');

  if (!Array.isArray(s.aggregations)) errors.push('aggregations가 배열이 아니에요');
  else {
    for (const a of s.aggregations) if (!AGGREGATION_IDS.includes(a)) errors.push(`알 수 없는 취합 방식: ${a}`);
    for (const r of AGGREGATION_REQUIRED[s.layout]) if (!s.aggregations.includes(r)) errors.push(`필수 취합 방식이 빠졌어요: ${r}`);
    if (isObj(s.org)) {
      const allowed = availableAggregations(s);
      for (const a of s.aggregations) if (!allowed.includes(a)) errors.push(`이 양식에서 쓸 수 없는 취합 방식: ${a}`);
    }
  }

  return errors.length ? { ok: false, errors } : { ok: true, schema: s };
}
