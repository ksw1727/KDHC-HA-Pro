import type { Field } from '@contract/schema';

/**
 * 시간 글자 표준화 (취합 ③ 값 정리). 양식에 '시간' 종류 칸이 없어서, 이름에 시간·시각이 들어간 글자 칸만 본다.
 *   "오후 1시~6시" → "13:00~18:00", "PM 2~6" → "14:00~18:00", "9~18" → "09:00~18:00",
 *   "10:00~익일 12:00 (1박 2일)" → "10:00~익일 12:00 (1박 2일)", "오후 1시부터 5시까지" → "13:00~17:00"
 * 기간("3시간", "2시간 30분")이나 읽을 수 없는 글은 건드리지 않는다(null).
 * 오전·오후가 없고 1~6시처럼 오후일 가능성이 큰 시각, 끝이 시작보다 이른데 '익일'이 없는 경우는 짐작이라 guessed.
 */

export interface TimeFix { value: string; guessed: boolean }

/** 시간 칸인가: 이름에 시간·시각(또는 time)이 있고, 소요·누적처럼 기간을 받는 칸이 아님 */
export function isTimeField(field: Field): boolean {
  if (field.type !== 'text') return false;
  const l = field.label.replace(/\s/g, '');
  return /시간|시각|time/i.test(l) && !/소요|누적|총|합계|근무시간수|시간수|횟수|기간/.test(l);
}

const pad = (n: number) => String(n).padStart(2, '0');
const hm = (h: number, m: number) => `${pad(h)}:${pad(m)}`;

type Mer = 'am' | 'pm' | null;
interface Part { h: number; m: number; mer: Mer; next: boolean; explicit24: boolean }

const MER_BEFORE = /^(오전|오후|낮|밤|저녁|새벽|아침|am|pm|a\.m\.|p\.m\.)\s*/;
const merOf = (w: string): Mer => (/^(오전|새벽|아침|am|a\.m\.)$/.test(w) ? 'am' : 'pm');

/** 한쪽 시각 하나: "익일 오후 2시 30분", "14:00", "2pm", "9시 반", "09시" */
function part(s: string): Part | null {
  let t = s.trim();
  let next = false;
  const day = /^(익일|다음\s?날|당일)\s*/.exec(t);
  if (day) { next = day[1] !== '당일'; t = t.slice(day[0].length); }
  let mer: Mer = null;
  const mb = MER_BEFORE.exec(t);
  if (mb) { mer = merOf(mb[1]); t = t.slice(mb[0].length); }
  const r = /^(\d{1,2})(?:\s*(?::|시)\s*(?:(\d{1,2})\s*분?|(반))?)?\s*(am|pm|a\.m\.|p\.m\.)?$/.exec(t);
  if (!r) return null;
  if (r[4]) mer = merOf(r[4]);
  const h = Number(r[1]);
  const m = r[3] ? 30 : r[2] !== undefined ? Number(r[2]) : 0;
  if (m > 59 || h > 24 || (mer && (h < 1 || h > 12))) return null;
  // 13시 이상이거나 "09:00"처럼 0을 붙여 쓴 것은 24시간제로 확실
  const explicit24 = h >= 13 || h === 0 || /^0\d/.test(r[1]);
  return { h, m, mer, next, explicit24 };
}

const to24 = (p: Part, mer: Mer) => {
  if (mer === 'pm' && p.h < 12) return p.h + 12;
  if (mer === 'am' && p.h === 12) return 0;
  return p.h;
};

/** 시간 글자 하나를 표준 모양으로. 시간으로 읽을 수 없으면 null */
export function standardTime(raw: string): TimeFix | null {
  let base = raw.normalize('NFKC').trim().replace(/\s+/g, ' ');
  if (!base || /\d\s*시간/.test(base)) return null;   // "3시간", "2시간 30분" = 기간
  // 뒤에 붙은 괄호 설명은 그대로 남긴다: "(1박 2일)"
  let note = '';
  const p = /\s*(\([^()]*\))$/.exec(base);
  if (p && p.index > 0) { note = ` ${p[1]}`; base = base.slice(0, p.index).trim(); }
  const s = base.toLowerCase().replace(/\s*까지$/, '');
  const sides = s.split(/\s*(?:~|∼|〜|～|–|—|-|부터|에서)\s*/).filter((x) => x !== '');
  if (sides.length < 1 || sides.length > 2) return null;
  const a = part(sides[0]);
  if (!a) return null;
  if (sides.length === 1) {
    const h = to24(a, a.mer);
    if (h > 23 && a.m > 0) return null;
    const guessed = !a.mer && !a.explicit24 && a.h >= 1 && a.h <= 6;
    return { value: `${hm(guessed ? a.h + 12 : h, a.m)}${note}`, guessed };
  }
  const b = part(sides[1]);
  if (!b) return null;
  let guessed = false;
  // 오전·오후는 앞에만 적은 경우 뒤에도 (오후 1시~6시), 뒤에만 적은 경우 앞이 뒤보다 작으면 앞에도 (1~6pm)
  const am = a.mer ?? (b.mer && !a.explicit24 && a.h <= b.h ? b.mer : b.mer === 'pm' && !a.explicit24 ? 'am' : null);
  const bm = b.mer ?? (a.mer && !b.explicit24 ? (a.mer === 'am' && b.h < a.h ? 'pm' : a.mer) : null);
  let ha = to24(a, am), hb = to24(b, bm);
  if (!a.mer && !b.mer && !a.explicit24 && !b.explicit24 && a.h >= 1 && a.h <= 6 && b.h <= 7) { ha += 12; hb += 12; guessed = true; }   // "1시~6시"
  const next = b.next;
  if (!next && (hb < ha || (hb === ha && b.m <= a.m))) {
    // "10~2": 끝이 시작보다 이르면 오후로 짐작
    if (!bm && !b.explicit24 && hb + 12 > ha && hb + 12 <= 24) { hb += 12; guessed = true; }
    else return null;
  }
  if (ha > 24 || hb > 24 || (ha === 24 && a.m) || (hb === 24 && b.m)) return null;
  return { value: `${hm(ha, a.m)}~${next ? '익일 ' : ''}${hm(hb, b.m)}${note}`, guessed };
}

/** 엑셀이 시각으로 저장한 칸(1899-12-30 날짜 + 시각)은 그 시각만 */
export function excelTime(d: Date): string | null {
  return d.getUTCFullYear() <= 1900 ? hm(d.getUTCHours(), d.getUTCMinutes()) : null;
}
