/**
 * 계산식 엔진 (01-contract.md 3.1절). 생성 파트(엑셀 수식·미리보기)와 취합 파트(다시 계산)가 같이 쓴다.
 *
 * 문법
 *   식      := 비교
 *   비교    := 덧셈 (( '>' | '<' | '>=' | '<=' | '=' | '<>' ) 덧셈)?
 *   덧셈    := 곱셈 (( '+' | '-' ) 곱셈)*
 *   곱셈    := 단항 (( '*' | '/' | '×' | '÷' ) 단항)*
 *   단항    := '-' 단항 | 기본
 *   기본    := 숫자 | "글자" | [칸 이름] | 함수(식, …) | ( 식 )
 * 함수: SUM·합계, AVERAGE·평균, MIN·최소, MAX·최대, COUNTA·개수(빈칸 아닌 값 수), ROUND·반올림, IF·조건
 */

export type FnName = 'SUM' | 'AVERAGE' | 'MIN' | 'MAX' | 'COUNTA' | 'ROUND' | 'IF';

export type Node =
  | { t: 'num'; v: number }
  | { t: 'str'; v: string }
  | { t: 'ref'; name: string }
  | { t: 'neg'; a: Node }
  | { t: 'bin'; op: '+' | '-' | '*' | '/'; a: Node; b: Node }
  | { t: 'cmp'; op: '>' | '<' | '>=' | '<=' | '=' | '<>'; a: Node; b: Node }
  | { t: 'fn'; name: FnName; args: Node[] };

export const FN_ALIASES: Record<string, FnName> = {
  SUM: 'SUM', 합계: 'SUM',
  AVERAGE: 'AVERAGE', AVG: 'AVERAGE', 평균: 'AVERAGE',
  MIN: 'MIN', 최소: 'MIN',
  MAX: 'MAX', 최대: 'MAX',
  COUNTA: 'COUNTA', COUNT: 'COUNTA', 개수: 'COUNTA',
  ROUND: 'ROUND', 반올림: 'ROUND',
  IF: 'IF', 조건: 'IF', 만약: 'IF',
};

export const FN_KO: Record<FnName, string> = { SUM: '합계', AVERAGE: '평균', MIN: '최소', MAX: '최대', COUNTA: '개수', ROUND: '반올림', IF: '조건' };
/** 여러 값(열 전체 등)을 받는 함수 */
export const MULTI_FNS: FnName[] = ['SUM', 'AVERAGE', 'MIN', 'MAX', 'COUNTA'];

export class FormulaError extends Error {
  constructor(message: string, public pos: number) {
    super(message);
  }
}

type Tok =
  | { k: 'num'; v: number; p: number }
  | { k: 'str'; v: string; p: number }
  | { k: 'ref'; v: string; p: number }
  | { k: 'name'; v: string; p: number }
  | { k: 'op'; v: string; p: number };

function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (/\s/.test(ch)) { i++; continue; }
    if (ch === '[') {
      const j = src.indexOf(']', i + 1);
      if (j < 0) throw new FormulaError('[ 를 닫는 ] 가 없어요', i);
      const name = src.slice(i + 1, j).trim();
      if (!name) throw new FormulaError('[ ] 안에 칸 이름이 비어 있어요', i);
      out.push({ k: 'ref', v: name, p: i });
      i = j + 1;
      continue;
    }
    if (ch === '"' || ch === '“' || ch === '”') {
      let j = i + 1;
      while (j < src.length && !'"“”'.includes(src[j])) j++;
      if (j >= src.length) throw new FormulaError('따옴표가 닫히지 않았어요', i);
      out.push({ k: 'str', v: src.slice(i + 1, j), p: i });
      i = j + 1;
      continue;
    }
    // 계산식 안에서는 천 단위 쉼표를 쓰지 않는다 (쉼표는 함수 값 구분)
    const num = /^(\d+(\.\d+)?|\.\d+)/.exec(src.slice(i));
    if (num) {
      out.push({ k: 'num', v: Number(num[0]), p: i });
      i += num[0].length;
      continue;
    }
    const two = src.slice(i, i + 2);
    if (['>=', '<=', '<>', '!='].includes(two)) { out.push({ k: 'op', v: two === '!=' ? '<>' : two, p: i }); i += 2; continue; }
    // 화면에 보이는 기호(≥ ≤ ≠ −)도 그대로 받는다
    const wide: Record<string, string> = { '≥': '>=', '≤': '<=', '≠': '<>', '−': '-', '–': '-' };
    if (wide[ch]) { out.push({ k: 'op', v: wide[ch], p: i }); i++; continue; }
    if ('+-*/×÷()<>=,'.includes(ch)) {
      out.push({ k: 'op', v: ch === '×' ? '*' : ch === '÷' ? '/' : ch, p: i });
      i++;
      continue;
    }
    const name = /^[A-Za-z가-힣]+/.exec(src.slice(i));
    if (name) { out.push({ k: 'name', v: name[0], p: i }); i += name[0].length; continue; }
    throw new FormulaError(`쓸 수 없는 글자예요: ${ch}`, i);
  }
  return out;
}

/** 계산식 글자 → 구조. 잘못되면 FormulaError */
export function parseFormula(src: string): Node {
  const toks = tokenize(src);
  let i = 0;
  const peek = () => toks[i];
  const isOp = (v: string) => peek()?.k === 'op' && peek()!.v === v;
  const expect = (v: string) => {
    if (!isOp(v)) throw new FormulaError(`'${v}' 가 필요해요`, peek()?.p ?? src.length);
    i++;
  };

  function expr(): Node {
    const a = add();
    const t = peek();
    if (t?.k === 'op' && ['>', '<', '>=', '<=', '=', '<>'].includes(t.v)) {
      i++;
      return { t: 'cmp', op: t.v as Extract<Node, { t: 'cmp' }>['op'], a, b: add() };
    }
    return a;
  }
  function add(): Node {
    let a = mul();
    while (isOp('+') || isOp('-')) { const op = toks[i++].v as '+' | '-'; a = { t: 'bin', op, a, b: mul() }; }
    return a;
  }
  function mul(): Node {
    let a = unary();
    while (isOp('*') || isOp('/')) { const op = toks[i++].v as '*' | '/'; a = { t: 'bin', op, a, b: unary() }; }
    return a;
  }
  function unary(): Node {
    if (isOp('-')) { i++; return { t: 'neg', a: unary() }; }
    if (isOp('+')) { i++; return unary(); }
    return primary();
  }
  function primary(): Node {
    const t = peek();
    if (!t) throw new FormulaError('식이 끝나지 않았어요', src.length);
    if (t.k === 'num') { i++; return { t: 'num', v: t.v }; }
    if (t.k === 'str') { i++; return { t: 'str', v: t.v }; }
    if (t.k === 'ref') { i++; return { t: 'ref', name: t.v }; }
    if (t.k === 'name') {
      const fn = FN_ALIASES[t.v.toUpperCase()] ?? FN_ALIASES[t.v];
      if (!fn) throw new FormulaError(`모르는 함수예요: ${t.v} (칸 이름은 [ ]로 감싸 주세요)`, t.p);
      i++;
      expect('(');
      const args: Node[] = [];
      if (!isOp(')')) {
        args.push(expr());
        while (isOp(',')) { i++; args.push(expr()); }
      }
      expect(')');
      checkArity(fn, args.length, t.p);
      return { t: 'fn', name: fn, args };
    }
    if (isOp('(')) { i++; const e = expr(); expect(')'); return e; }
    throw new FormulaError(`여기에 '${t.v}' 는 올 수 없어요`, t.p);
  }

  if (toks.length === 0) throw new FormulaError('계산식이 비어 있어요', 0);
  const node = expr();
  if (i < toks.length) throw new FormulaError(`'${toks[i].v}' 앞에서 식이 끝나야 해요`, toks[i].p);
  return node;
}

function checkArity(fn: FnName, n: number, p: number) {
  const ko = FN_KO[fn];
  if (n === 0) throw new FormulaError(`${ko}( ) 안에 값이 필요해요`, p);
  if (fn === 'ROUND' && n > 2) throw new FormulaError(`${ko}(값, 자릿수) 모양으로 써 주세요`, p);
  if (fn === 'IF' && n !== 3) throw new FormulaError(`${ko}(비교, 맞을 때, 아닐 때) 모양으로 써 주세요`, p);
}

/** 식 안의 칸 이름들 (중복 제거, 나온 순서) */
export function formulaRefs(node: Node): string[] {
  const out: string[] = [];
  const walk = (n: Node) => {
    if (n.t === 'ref') { if (!out.includes(n.name)) out.push(n.name); }
    else if (n.t === 'neg') walk(n.a);
    else if (n.t === 'bin' || n.t === 'cmp') { walk(n.a); walk(n.b); }
    else if (n.t === 'fn') n.args.forEach(walk);
  };
  walk(node);
  return out;
}

/** 여러 값을 받는 함수(합계·평균·최소·최대·개수) 안에서만 쓰인 칸 이름 */
export function refsOnlyInAggregates(node: Node): Set<string> {
  const inAgg = new Set<string>();
  const outside = new Set<string>();
  const walk = (n: Node, agg: boolean) => {
    if (n.t === 'ref') (agg ? inAgg : outside).add(n.name);
    else if (n.t === 'neg') walk(n.a, agg);
    else if (n.t === 'bin' || n.t === 'cmp') { walk(n.a, agg); walk(n.b, agg); }
    else if (n.t === 'fn') n.args.forEach((a) => walk(a, agg || MULTI_FNS.includes(n.name)));
  };
  walk(node, false);
  return new Set([...inAgg].filter((x) => !outside.has(x)));
}

const PREC: Record<string, number> = { cmp: 1, '+': 2, '-': 2, '*': 3, '/': 3 };

/** 구조 → 사람이 읽는 글자 (한글 함수 이름, × ÷) */
export function printFormula(node: Node, opts: { ko?: boolean } = { ko: true }): string {
  const ko = opts.ko !== false;
  const p = (n: Node, parent = 0, right = false): string => {
    switch (n.t) {
      case 'num': return String(n.v);
      case 'str': return `"${n.v}"`;
      case 'ref': return `[${n.name}]`;
      case 'neg': return `-${p(n.a, 4)}`;
      case 'fn': return `${ko ? FN_KO[n.name] : n.name}(${n.args.map((a) => p(a)).join(', ')})`;
      case 'cmp':
      case 'bin': {
        const prec = n.t === 'cmp' ? PREC.cmp : PREC[n.op];
        const sym = n.t === 'bin' && ko ? ({ '*': '×', '/': '÷' } as Record<string, string>)[n.op] ?? n.op : n.op;
        const s = `${p(n.a, prec)} ${sym} ${p(n.b, prec, true)}`;
        return prec < parent || (right && prec === parent) ? `(${s})` : s;
      }
    }
  };
  return p(node);
}

/** 계산식의 칸 이름 바꾸기 (항목 이름을 바꿀 때) */
export function renameRef(src: string, from: string, to: string): string {
  if (!src || from === to) return src;
  return src.replace(/\[([^\]]*)\]/g, (m, name: string) => (name.trim() === from ? `[${to}]` : m));
}

// ── 엑셀 수식 ──

/** 칸 이름 → 엑셀 주소 또는 범위 (예: 'C7', '$B$6', 'C10:C109') */
export type RefResolver = (name: string, inAggregate: boolean) => string | undefined;

/** 구조 → 엑셀 수식 (등호 없음). 오류(0으로 나누기 등)는 빈칸이 되도록 IFERROR로 감싼다. */
export function toExcel(node: Node, resolve: RefResolver): string {
  const e = (n: Node, agg: boolean, parent = 0, right = false): string => {
    switch (n.t) {
      case 'num': return String(n.v);
      case 'str': return `"${n.v.replace(/"/g, '""')}"`;
      case 'ref': {
        const a = resolve(n.name, agg);
        if (!a) throw new FormulaError(`[${n.name}] 칸을 찾을 수 없어요`, 0);
        return a;
      }
      case 'neg': return `-${e(n.a, agg, 4)}`;
      case 'fn': {
        const inner = MULTI_FNS.includes(n.name);
        return `${n.name}(${n.args.map((a) => e(a, agg || inner)).join(',')})`;
      }
      case 'cmp':
      case 'bin': {
        const prec = n.t === 'cmp' ? PREC.cmp : PREC[n.op];
        const s = `${e(n.a, agg, prec)}${n.op}${e(n.b, agg, prec, true)}`;
        return prec < parent || (right && prec === parent) ? `(${s})` : s;
      }
    }
  };
  return `IFERROR(${e(node, false)},"")`;
}

// ── 계산 ──

export type Value = number | string | null;

/** 칸 이름 → 값. 여러 값을 받는 함수 안에서는 배열(열 전체 등)을 돌려줄 수 있다. */
export type ValueResolver = (name: string, inAggregate: boolean) => Value | Value[] | undefined;

const nums = (vs: (Value | Value[])[]): number[] =>
  vs.flat().filter((v): v is number => typeof v === 'number' && Number.isFinite(v));

/**
 * 계산. 엑셀과 같게 빈칸은 연산·비교·조건에서 0으로 본다 (빈칸 × 5 = 0, [할인율]이 비면 할인 0).
 * 계산할 수 없으면(0으로 나누기, 글자 연산) null — 엑셀의 IFERROR(…,"")와 같은 결과.
 */
export function evaluate(node: Node, resolve: ValueResolver): Value {
  const ev = (n: Node, agg: boolean): Value | Value[] => {
    switch (n.t) {
      case 'num': return n.v;
      case 'str': return n.v;
      case 'ref': {
        const v = resolve(n.name, agg);
        if (v === undefined) throw new FormulaError(`[${n.name}] 칸을 찾을 수 없어요`, 0);
        return v;
      }
      case 'neg': { const a = blank0(scalar(ev(n.a, agg))); return typeof a === 'number' ? 0 - a : null; }
      case 'bin': {
        const a = num(blank0(scalar(ev(n.a, agg))));
        const b = num(blank0(scalar(ev(n.b, agg))));
        if (a === null || b === null) return null;
        if (n.op === '+') return a + b;
        if (n.op === '-') return a - b;
        if (n.op === '*') return a * b;
        return b === 0 ? null : a / b;
      }
      case 'cmp': {
        // 빈칸은 상대가 글자면 "", 아니면 0 (엑셀과 같게)
        let a = scalar(ev(n.a, agg));
        let b = scalar(ev(n.b, agg));
        if (a === null) a = typeof b === 'string' ? '' : 0;
        if (b === null) b = typeof a === 'string' ? '' : 0;
        const r = n.op === '>' ? a > b : n.op === '<' ? a < b : n.op === '>=' ? a >= b : n.op === '<=' ? a <= b : n.op === '=' ? a === b : a !== b;
        return r ? 1 : 0;
      }
      case 'fn': {
        if (n.name === 'IF') {
          const c = blank0(scalar(ev(n.args[0], agg)));
          return scalar(ev(c !== 0 && c !== '' ? n.args[1] : n.args[2], agg));
        }
        if (n.name === 'ROUND') {
          const v = num(blank0(scalar(ev(n.args[0], agg))));
          const d = n.args[1] ? num(blank0(scalar(ev(n.args[1], agg)))) ?? 0 : 0;
          if (v === null) return null;
          // 엑셀 ROUND처럼 0에서 먼 쪽으로 (-2.5 → -3), 소수 오차 보정
          const f = 10 ** d;
          return (Math.sign(v) * Math.round(Number((Math.abs(v) * f).toPrecision(15)))) / f;
        }
        // 개수: 빈칸이 아닌 값(숫자·글자)의 수 (예: 이수 인원 = 개수([이름]))
        if (n.name === 'COUNTA') return n.args.map((a) => ev(a, true)).flat().filter((v) => v !== null && v !== '').length;
        const xs = nums(n.args.map((a) => ev(a, true)));
        if (n.name === 'SUM') return xs.reduce((s, x) => s + x, 0);
        if (xs.length === 0) return null;
        if (n.name === 'AVERAGE') return xs.reduce((s, x) => s + x, 0) / xs.length;
        return n.name === 'MIN' ? Math.min(...xs) : Math.max(...xs);
      }
    }
  };
  const r = scalar(ev(node, false));
  return typeof r === 'number' && !Number.isFinite(r) ? null : r;
}

const blank0 = (v: Value): Value => (v === null ? 0 : v);

function scalar(v: Value | Value[]): Value {
  return Array.isArray(v) ? (v.length === 1 ? v[0] : null) : v;
}
function num(v: Value): number | null {
  return typeof v === 'number' ? v : null;
}

/** 글자 그대로 검사: 문법 오류가 있으면 메시지, 없으면 null */
export function formulaProblem(src: string | undefined, known: (name: string) => boolean): string | null {
  if (!src?.trim()) return '계산식을 입력해 주세요.';
  try {
    const node = parseFormula(src);
    const missing = formulaRefs(node).filter((r) => !known(r));
    if (missing.length) return `[${missing[0]}] 칸을 찾을 수 없어요.`;
    return null;
  } catch (e) {
    return e instanceof FormulaError ? `${e.message}.` : '계산식을 읽을 수 없어요.';
  }
}
