import type { CellValue } from '@contract/meta';
import type { Field, FieldType } from '@contract/schema';
import { PATTERN_INFO, resolveDate, type IssueCode, type NormalizeResult } from '@contract/fieldTypes';
import { isBlank, normLabel, similar } from './cellValue';

/**
 * ③ 값 정리 — 01-contract.md 5절 표 그대로.
 * 계약의 FieldTypeDef.normalize 자리는 취합 파트 몫이지만, LLM은 src/contract/를 고치지 않는다(01 10절).
 * 그래서 여기 두고, 개발자1과 합의하면 계약 쪽 normalize가 이 함수를 부르도록 옮긴다.
 */

export interface Ctx { year: number; today: Date }

const ok = (value: CellValue): NormalizeResult => ({ status: 'ok', value });
const auto = (value: CellValue): NormalizeResult => ({ status: 'auto', value });
const proposal = (raw: unknown, p: CellValue, issue: IssueCode): NormalizeResult => ({ status: 'proposal', value: rawText(raw), proposal: p, issue });
const invalid = (raw: unknown, issue: IssueCode): NormalizeResult => ({ status: 'invalid', value: rawText(raw), issue });

const pad = (n: number, w = 2) => String(n).padStart(w, '0');
const ymd = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;

function rawText(raw: unknown): CellValue {
  if (raw === null || raw === undefined) return null;
  if (raw instanceof Date) return ymd(raw);
  if (typeof raw === 'number') return raw;
  return String(raw);
}

/* ── text · memo ── */
function text(raw: unknown, field: Field): NormalizeResult {
  const original = raw instanceof Date ? ymd(raw) : String(raw);
  const v = original.trim();
  if (field.maxLength && [...v].length > field.maxLength) return invalid(v, 'TOO_LONG');
  return typeof raw === 'string' && v === raw ? ok(v) : auto(v);
}

/* ── number ── */
const KO_NUM: Record<string, number> = { 하나: 1, 한: 1, 둘: 2, 두: 2, 셋: 3, 세: 3, 넷: 4, 네: 4, 다섯: 5, 여섯: 6, 일곱: 7, 여덟: 8, 아홉: 9, 열: 10 };
const UNITS = ['개', '명', '건', '회', '원', '곳', '대', '권', '일', '시간', '%', 'kg', 'km', 'm'];
const NUM_RE = /^[-+]?\d+(\.\d+)?$/;
const APPROX_RE = /^약|(정도|쯤|가량|여)$/;
const KO_SMALL: Record<string, number> = { 십: 10, 백: 100, 천: 1000 };
const KO_BIG: Record<string, number> = { 만: 1e4, 억: 1e8 };

/** 한글 자릿수 단위: "3만" 30000, "6만5천" 65000, "2.5만" 25000, "1억2천만" 120000000. 아니면 null */
function koreanUnits(t: string): number | null {
  if (!/^[-+]?(\d+(\.\d+)?|[십백천만억])+$/.test(t) || !/\d/.test(t) || !/[십백천만억]/.test(t)) return null;
  const sign = t.startsWith('-') ? -1 : 1;
  let total = 0, sec = 0, pending: number | null = null;
  for (const [tok] of t.replace(/^[-+]/, '').matchAll(/\d+(?:\.\d+)?|[십백천만억]/g)) {
    if (tok in KO_SMALL) { sec += (pending ?? 1) * KO_SMALL[tok]; pending = null; }
    else if (tok in KO_BIG) { total += (sec + (pending ?? 0) || 1) * KO_BIG[tok]; sec = 0; pending = null; }
    else pending = Number(tok);
  }
  return sign * Math.round((total + sec + (pending ?? 0)) * 1e6) / 1e6;
}

function number(raw: unknown, field: Field): NormalizeResult {
  let n: number;
  let status: 'ok' | 'auto' = 'ok';
  if (typeof raw === 'number') n = raw;
  else {
    const s = String(raw).trim();
    let t = s.replace(/[,\s₩$]/g, '');
    const approx = APPROX_RE.test(t);   // "약 6만", "10명 정도": 대략 적은 값이라 고친 값은 제안으로만
    t = t.replace(/^약/, '').replace(/(정도|쯤|가량|여)$/, '');
    for (const u of [field.unit?.trim(), ...UNITS].filter(Boolean) as string[]) if (t.endsWith(u)) { t = t.slice(0, -u.length); break; }
    const ko = NUM_RE.test(t) ? Number(t) : koreanUnits(t);
    if (ko !== null && approx) return proposal(raw, ko, 'NOT_NUMBER');
    if (ko !== null) { n = ko; status = 'auto'; }
    else {
      const words = s.replace(/^약\s*/, '').replace(/\s*(정도|여|쯤|가량|이상|이하|개|명|건)$/g, '').trim();
      if (words in KO_NUM) return proposal(raw, KO_NUM[words], 'NOT_NUMBER');
      const nums = s.match(/-?\d[\d,]*(\.\d+)?/g) ?? [];
      if (nums.length === 1) return proposal(raw, Number(nums[0].replace(/,/g, '')), 'NOT_NUMBER');
      return invalid(raw, 'NOT_NUMBER');
    }
  }
  if ((field.min != null && n < field.min) || (field.max != null && n > field.max)) return { status: 'invalid', value: n, issue: 'OUT_OF_RANGE' };
  const d = field.decimals ?? 0;
  const rounded = Math.round(n * 10 ** d) / 10 ** d;
  if (rounded !== n) return { status: 'proposal', value: rawText(raw), proposal: rounded, issue: 'NOT_NUMBER' };
  return status === 'ok' ? ok(n) : auto(n);
}

/* ── date ── */
function excelSerial(n: number): Date { return new Date(Date.UTC(1899, 11, 30) + n * 86400000); }
function validYmd(y: number, m: number, d: number): boolean {
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}

function date(raw: unknown, field: Field, ctx: Ctx): NormalizeResult {
  const fmt = field.dateFormat ?? 'yyyy-mm-dd';
  let y: number | undefined, m: number | undefined, d: number | undefined;
  let guessed = false;   // 연도 두 자리처럼 짐작한 것 → 수정안
  if (raw instanceof Date) { y = raw.getUTCFullYear(); m = raw.getUTCMonth() + 1; d = raw.getUTCDate(); }
  else if (typeof raw === 'number') {
    if (Number.isInteger(raw) && raw >= 1900 && raw <= 9999) y = raw;
    else if (Number.isInteger(raw) && raw >= 0 && raw < 100 && fmt === 'yyyy') { y = 2000 + raw; guessed = true; }
    else if (raw > 20000 && raw < 80000) { const t = excelSerial(Math.floor(raw)); y = t.getUTCFullYear(); m = t.getUTCMonth() + 1; d = t.getUTCDate(); }
  } else {
    const s = String(raw).trim().replace(/\s+/g, ' ');
    let r: RegExpExecArray | null;
    if ((r = /^(\d{4}) ?[.\-/년] ?(\d{1,2}) ?[.\-/월] ?(\d{1,2}) ?일?\.?$/.exec(s))) [y, m, d] = [+r[1], +r[2], +r[3]];
    else if ((r = /^(\d{4})(\d{2})(\d{2})$/.exec(s))) [y, m, d] = [+r[1], +r[2], +r[3]];
    else if ((r = /^(\d{4}) ?[.\-/년] ?(\d{1,2}) ?월?\.?$/.exec(s))) [y, m] = [+r[1], +r[2]];
    else if ((r = /^(\d{1,2}) ?[./월] ?(\d{1,2}) ?일?$/.exec(s))) [y, m, d] = [ctx.year, +r[1], +r[2]];
    else if ((r = /^(\d{4}) ?년?$/.exec(s))) y = +r[1];
    else if ((r = /^(\d{2}) ?년?$/.exec(s)) && fmt === 'yyyy') { y = 2000 + +r[1]; guessed = true; }
  }
  if (y === undefined) return invalid(raw, 'NOT_DATE');
  if (m !== undefined && (m < 1 || m > 12 || (d !== undefined && !validYmd(y, m, d)))) return invalid(raw, 'NOT_DATE');

  let value: string;
  if (fmt === 'yyyy') value = String(y);
  else if (fmt === 'yyyy-mm') { if (m === undefined) return invalid(raw, 'NOT_DATE'); value = `${y}-${pad(m)}`; }
  else { if (m === undefined || d === undefined) return invalid(raw, 'NOT_DATE'); value = `${y}-${pad(m)}-${pad(d)}`; }

  if (guessed) return proposal(raw, value, 'NOT_DATE');
  const lo = resolveDate(field.minDate, ctx.today);
  const hi = resolveDate(field.maxDate, ctx.today);
  const at = new Date(Date.UTC(y, (m ?? 1) - 1, d ?? 1));
  const atEnd = new Date(Date.UTC(y, m === undefined ? 11 : m - 1, d ?? (m === undefined ? 31 : new Date(Date.UTC(y, m, 0)).getUTCDate())));
  if ((lo && atEnd < lo) || (hi && at > hi)) return { status: 'invalid', value, issue: 'OUT_OF_RANGE' };
  const same = raw instanceof Date || (typeof raw === 'number' && fmt === 'yyyy') || String(raw).trim() === value;
  return same ? ok(value) : auto(value);
}

/* ── select ── */
function select(raw: unknown, field: Field): NormalizeResult {
  const s = String(raw).trim();
  const opts = field.options ?? [];
  if (opts.includes(String(raw))) return ok(String(raw));
  const key = normLabel(s);
  const exact = opts.find((o) => normLabel(o) === key);
  if (exact) return auto(exact);
  const cands = opts.filter((o) => similar(normLabel(o), key));
  if (cands.length === 1) return proposal(raw, cands[0], 'NOT_IN_OPTIONS');
  return invalid(raw, 'NOT_IN_OPTIONS');
}

/* ── pattern ── */
function bizCheck(d: string): boolean {
  const w = [1, 3, 7, 1, 3, 7, 1, 3, 5];
  let sum = w.reduce((s, x, i) => s + x * Number(d[i]), 0);
  sum += Math.floor((Number(d[8]) * 5) / 10);
  return (10 - (sum % 10)) % 10 === Number(d[9]);
}

function phoneFormat(digits: string, mobile: boolean): string | null {
  if (mobile) {
    if (!/^01\d{8,9}$/.test(digits)) return null;
    return digits.length === 10 ? `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}` : `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`;
  }
  if (/^02\d{7,8}$/.test(digits)) return digits.length === 9 ? `02-${digits.slice(2, 5)}-${digits.slice(5)}` : `02-${digits.slice(2, 6)}-${digits.slice(6)}`;
  if (/^0\d{9,10}$/.test(digits)) return digits.length === 10 ? `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}` : `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`;
  if (/^1\d{3}\d{4}$/.test(digits)) return `${digits.slice(0, 4)}-${digits.slice(4)}`;   // 1588-0000
  return null;
}

function pattern(raw: unknown, field: Field): NormalizeResult {
  const s = String(raw).trim();
  let out: string | null = null;
  if (field.pattern === 'email') {
    const at = s.lastIndexOf('@');
    out = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) ? s.slice(0, at) + s.slice(at).toLowerCase() : null;
  } else {
    let digits = s.replace(/\D/g, '');
    if (typeof raw === 'number' && field.pattern !== 'bizno') digits = '0' + digits;   // 숫자로 저장돼 앞자리 0이 빠짐
    if (field.pattern === 'bizno') out = digits.length === 10 && bizCheck(digits) ? `${digits.slice(0, 3)}-${digits.slice(3, 5)}-${digits.slice(5)}` : null;
    else out = phoneFormat(digits, field.pattern === 'mobile');
  }
  if (out === null) return invalid(raw, 'BAD_PATTERN');
  return out === raw ? ok(out) : auto(out);
}

const BY_TYPE: Record<FieldType, (raw: unknown, f: Field, ctx: Ctx) => NormalizeResult> = {
  text, memo: text, number, date, select, pattern,
  calc: (raw) => ok(typeof raw === 'number' || typeof raw === 'string' ? raw : null),
};

/** 칸 하나 정리. 빈칸은 ok(null), 엑셀 오류 값은 FORMULA_ERROR */
export function normalize(raw: unknown, field: Field, ctx: Ctx): NormalizeResult {
  if (isBlank(raw)) return ok(null);
  if (typeof raw === 'object' && raw !== null && 'error' in raw) return { status: 'invalid', value: null, issue: 'FORMULA_ERROR' };
  return BY_TYPE[field.type](raw, { ...field, maxLength: field.type === 'memo' ? undefined : field.maxLength }, ctx);
}

/** 확인할 칸에 보여 줄 문장 */
export function issueMessage(code: IssueCode, field: Field): string {
  switch (code) {
    case 'REQUIRED_EMPTY': return '꼭 채워야 하는 칸이 비어 있어요';
    case 'TOO_LONG': return `${field.maxLength}자를 넘어요`;
    case 'NOT_NUMBER': return (field.decimals ?? 0) > 0 ? `숫자(소수 ${field.decimals}자리까지)로 읽기 어려워요` : '숫자로 읽기 어려워요';
    case 'NOT_DATE': return '날짜로 읽기 어려워요';
    case 'OUT_OF_RANGE': return `허용 범위를 벗어났어요${field.min != null || field.max != null ? ` (${field.min ?? ''}~${field.max ?? ''})` : ''}`;
    case 'NOT_IN_OPTIONS': return `선택 목록에 없는 값이에요 (${(field.options ?? []).slice(0, 5).join(', ')})`;
    case 'BAD_PATTERN': return `${field.pattern ? PATTERN_INFO[field.pattern].label : ''} 형식이 아니에요`;
    case 'FORMULA_ERROR': return '수식 오류 값(#REF! 등)이에요';
  }
}
