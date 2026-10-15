/**
 * 조사 붙이기: 앞말에 받침이 있으면 a(을·과·이·으로), 없으면 b(를·와·가·로).
 * 따옴표·괄호는 건너뛰고 마지막 글자를 본다. 숫자·영문은 읽는 소리로 판단한다 (B12 → "이", 3 → "삼").
 */
export function josa(word: string, a: string, b: string): string {
  const w = word.replace(/[\s'"’”)\]}>」』]+$/, '');
  const ch = w.at(-1) ?? '';
  let batchim: boolean;
  const code = ch.charCodeAt(0) - 0xac00;
  if (code >= 0 && code < 11172) batchim = code % 28 !== 0;
  else if (/\d/.test(ch)) batchim = '013678'.includes(ch);
  else if (/[a-z]/i.test(ch)) batchim = 'lmnr'.includes(ch.toLowerCase());
  else batchim = false;
  return word + (batchim ? a : b);
}
