import type { CellValue } from '@contract/meta';
import type { Field, FieldType } from '@contract/schema';
import { NUMBER_LIMIT, PATTERN_INFO, resolveDate, type IssueCode, type NormalizeResult } from '@contract/fieldTypes';
import { isBlank, normLabel, similar } from './cellValue';
import { excelTime, isTimeField, standardTime } from './timeText';

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
  if (isTimeField(field)) { const t = time(raw); if (t) return t; }
  const original = raw instanceof Date ? ymd(raw) : String(raw);
  const v = original.trim();
  if (field.maxLength && [...v].length > field.maxLength) return invalid(v, 'TOO_LONG');
  return typeof raw === 'string' && v === raw ? ok(v) : auto(v);
}

/* ── 시간 (이름에 시간·시각이 들어간 글자 칸): 13:00 / 13:00~18:00 으로 맞춘다 ── */
function time(raw: unknown): NormalizeResult | null {
  if (raw instanceof Date) { const v = excelTime(raw); return v ? auto(v) : null; }   // 엑셀이 시각으로 저장한 칸
  if (typeof raw === 'number') {
    if (raw > 0 && raw < 1) { const min = Math.round(raw * 1440); return auto(`${pad(Math.floor(min / 60) % 24)}:${pad(min % 60)}`); }   // 엑셀 시각 숫자(0.5 = 12:00)
    return null;
  }
  const s = String(raw).trim();
  const fix = standardTime(s);
  if (!fix) return null;
  if (fix.value === s) return ok(s);
  return fix.guessed ? proposal(raw, fix.value, 'NOT_TIME') : auto(fix.value);
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
    // 쉼표가 천 단위 자리(1,200·12,345,678)가 아니면("1,2") 1.2인지 12인지 알 수 없어 제안으로만
    const oddComma = (s.match(/\d[\d,]*\d/g) ?? []).some((g) => g.includes(',') && !/^\d{1,3}(,\d{3})+$/.test(g));
    if (ko !== null && (approx || oddComma)) return proposal(raw, ko, 'NOT_NUMBER');
    if (ko !== null) { n = ko; status = 'auto'; }
    else {
      const words = s.replace(/^약\s*/, '').replace(/\s*(정도|여|쯤|가량|이상|이하|개|명|건)$/g, '').trim();
      if (words in KO_NUM) return proposal(raw, KO_NUM[words], 'NOT_NUMBER');
      const nums = s.match(/-?\d[\d,]*(\.\d+)?/g) ?? [];
      if (nums.length === 1) return proposal(raw, Number(nums[0].replace(/,/g, '')), 'NOT_NUMBER');
      return invalid(raw, 'NOT_NUMBER');
    }
  }
  // 최소·최대가 없으면 빈 양식의 입력 규칙과 같은 한도(±999,999,999,999)로 본다
  if (n < (field.min ?? -NUMBER_LIMIT) || n > (field.max ?? NUMBER_LIMIT)) return { status: 'invalid', value: n, issue: 'OUT_OF_RANGE' };
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

/** 날짜 글자 하나 → 연·월·일. 연도 두 자리처럼 짐작한 것은 guessed */
function dateText(s: string, ctx: Ctx, fmt: string): { y?: number; m?: number; d?: number; guessed: boolean } | null {
  let r: RegExpExecArray | null;
  if ((r = /^(\d{4}) ?[.\-/년] ?(\d{1,2}) ?[.\-/월] ?(\d{1,2}) ?일?\.?$/.exec(s))) return { y: +r[1], m: +r[2], d: +r[3], guessed: false };
  if ((r = /^(\d{4})(\d{2})(\d{2})$/.exec(s))) return { y: +r[1], m: +r[2], d: +r[3], guessed: false };
  if ((r = /^(\d{4}) ?[.\-/년] ?(\d{1,2}) ?월?\.?$/.exec(s))) return { y: +r[1], m: +r[2], guessed: false };
  // 연도 두 자리("26년 12월", "26.12.5", "26-12-05", "261205"): 2000년대로 짐작해 수정안으로
  if ((r = /^(\d{2}) ?[.\-/년] ?(\d{1,2}) ?[.\-/월] ?(\d{1,2}) ?일?\.?$/.exec(s))) return { y: 2000 + +r[1], m: +r[2], d: +r[3], guessed: true };
  if ((r = /^(\d{2})(\d{2})(\d{2})$/.exec(s))) return { y: 2000 + +r[1], m: +r[2], d: +r[3], guessed: true };
  if ((r = /^(\d{2}) ?년 ?(\d{1,2}) ?월?\.?$/.exec(s))) return { y: 2000 + +r[1], m: +r[2], guessed: true };
  if ((r = /^(\d{1,2}) ?[./월] ?(\d{1,2}) ?일?\.?$/.exec(s))) return { y: ctx.year, m: +r[1], d: +r[2], guessed: false };
  if ((r = /^(\d{1,2}) ?월$/.exec(s)) && fmt === 'yyyy-mm') return { y: ctx.year, m: +r[1], guessed: false };
  if ((r = /^(\d{4}) ?년?$/.exec(s))) return { y: +r[1], guessed: false };
  if ((r = /^(\d{2}) ?년?$/.exec(s)) && fmt === 'yyyy') return { y: 2000 + +r[1], guessed: true };
  return null;
}
const WEEKDAYS = '일월화수목금토';
/** 끝에 붙은 요일: "(금)", "(금요일)", " 금요일" */
function cutWeekday(s: string): { s: string; wd?: number } {
  const w = /\s*(?:\(\s*([월화수목금토일])(?:요일)?\s*\)|\s([월화수목금토일])요일)\.?$/.exec(s);
  return w && w.index > 0 ? { s: s.slice(0, w.index).trim(), wd: WEEKDAYS.indexOf(w[1] ?? w[2]) } : { s };
}
/** 날짜 뒤에 붙은 시각: "2026-12-04 14:00", "12/4 오후 2시" */
const TIME_TAIL = /\s+(?:(?:오전|오후|am|pm)\s*)?\d{1,2}(?::\d{2}(?::\d{2})?|\s*시(?:\s*\d{1,2}\s*분)?)\s*(?:am|pm)?$/i;

function date(raw: unknown, field: Field, ctx: Ctx): NormalizeResult {
  const fmt = field.dateFormat ?? 'yyyy-mm-dd';
  let y: number | undefined, m: number | undefined, d: number | undefined;
  let guessed = false;   // 연도 두 자리처럼 짐작한 것 → 수정안
  let why: IssueCode = 'NOT_DATE';
  let weekday: number | undefined;
  if (raw instanceof Date) { y = raw.getUTCFullYear(); m = raw.getUTCMonth() + 1; d = raw.getUTCDate(); }
  else if (typeof raw === 'number') {
    if (Number.isInteger(raw) && raw >= 1900 && raw <= 9999) y = raw;
    else if (Number.isInteger(raw) && raw >= 0 && raw < 100 && fmt === 'yyyy') { y = 2000 + raw; guessed = true; }
    else if (raw > 20000 && raw < 80000) { const t = excelSerial(Math.floor(raw)); y = t.getUTCFullYear(); m = t.getUTCMonth() + 1; d = t.getUTCDate(); }
  } else {
    // 전각 숫자·기호(２０２６．１２．０４)는 보통 글자로
    let s = String(raw).normalize('NFKC').trim().replace(/\s+/g, ' ');
    // 기간("12/3~12/4", "12월 3일부터 4일까지"): 날짜 칸에는 하루만 넣을 수 있어 시작일을 수정안으로
    const range = s.replace(/\s*까지$/, '').split(/\s*(?:~|∼|〜|부터)\s*/);
    if (range.length === 2 && range[0] && range[1]) { s = range[0]; why = 'DATE_RANGE'; guessed = true; }
    const cut = cutWeekday(s);
    s = cut.s; weekday = cut.wd;
    let got = dateText(s, ctx, fmt);
    // 시각이 붙은 날짜: 날짜만 수정안으로 (시각은 날짜 칸에 넣지 못함)
    if (!got && TIME_TAIL.test(s)) { const c2 = cutWeekday(s.replace(TIME_TAIL, '').trim()); got = dateText(c2.s, ctx, fmt); weekday ??= c2.wd; if (got) guessed = true; }
    if (got) { ({ y, m, d } = got); guessed ||= got.guessed; }
  }
  if (y === undefined) return invalid(raw, 'NOT_DATE');
  if (m !== undefined && (m < 1 || m > 12 || (d !== undefined && !validYmd(y, m, d)))) return invalid(raw, 'NOT_DATE');
  // 적은 요일과 날짜가 다르면 어느 쪽이 맞는지 몰라 수정안으로
  if (weekday !== undefined && m !== undefined && d !== undefined && new Date(Date.UTC(y, m - 1, d)).getUTCDay() !== weekday) { guessed = true; if (why === 'NOT_DATE') why = 'WEEKDAY_MISMATCH'; }

  let value: string;
  if (fmt === 'yyyy') value = String(y);
  else if (fmt === 'yyyy-mm') { if (m === undefined) return invalid(raw, 'NOT_DATE'); value = `${y}-${pad(m)}`; }
  else { if (m === undefined || d === undefined) return invalid(raw, 'NOT_DATE'); value = `${y}-${pad(m)}-${pad(d)}`; }

  if (guessed) return proposal(raw, value, why);
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
    case 'OUT_OF_RANGE': return field.min != null || field.max != null ? `허용 범위를 벗어났어요 (${field.min ?? ''}~${field.max ?? ''})` : '엑셀 숫자칸에 넣을 수 있는 범위(±999,999,999,999)를 벗어났어요';
    case 'NOT_IN_OPTIONS': return `선택 목록에 없는 값이에요 (${(field.options ?? []).slice(0, 5).join(', ')})`;
    case 'BAD_PATTERN': return `${field.pattern ? PATTERN_INFO[field.pattern].label : ''} 형식이 아니에요`;
    case 'FORMULA_ERROR': return '수식 오류 값(#REF! 등)이에요';
    case 'DATE_RANGE': return '기간이 적혀 있어요. 날짜 칸에는 하루만 넣을 수 있어 시작일로 고쳤어요';
    case 'WEEKDAY_MISMATCH': return '적힌 요일과 날짜가 맞지 않아요';
    case 'NOT_TIME': return '오전·오후가 분명하지 않아 짐작해서 고쳤어요';
  }
}
