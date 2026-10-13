import { useMemo, useRef, useState } from 'react';
import { calcProblem, evaluate, parseFormula, printFormula, type FormulaScope } from '@contract/formula';
import { cx } from '../ui/ui';

const OPS: [string, string][] = [['+', '+'], ['−', ' - '], ['×', ' × '], ['÷', ' ÷ '], ['(', '('], [')', ')'], [',', ', ']];
const CMP: [string, string][] = [['≥', ' >= '], ['>', ' > '], ['≤', ' <= '], ['<', ' < '], ['=', ' = '], ['≠', ' <> ']];
const FNS: [string, string, string][] = [
  ['합계', '합계(', '여러 값을 더해요'],
  ['평균', '평균(', '여러 값의 평균'],
  ['최소', '최소(', '가장 작은 값'],
  ['최대', '최대(', '가장 큰 값'],
  ['반올림', '반올림(', '반올림(값, 소수 자릿수)'],
  ['조건', '조건(', '조건(비교, 맞을 때, 아닐 때)'],
];

/**
 * 계산식 편집: 버튼으로 조립하거나 글자로 직접 입력 (둘 다).
 * 버튼은 커서 위치에 끼워 넣는다. 아래에 오류 또는 예시 값 계산 결과를 보여준다.
 */
export function FormulaEditor({ value, onChange, scope }: { value: string; onChange: (v: string) => void; scope: FormulaScope }) {
  const ref = useRef<HTMLInputElement>(null);
  const [lit, setLit] = useState('');
  const sel = useRef<{ s: number; e: number }>({ s: value.length, e: value.length });

  const insert = (text: string) => {
    const { s, e } = sel.current;
    const a = Math.min(s, value.length);
    const b = Math.min(e, value.length);
    const next = value.slice(0, a) + text + value.slice(b);
    onChange(next);
    const pos = a + text.length;
    sel.current = { s: pos, e: pos };
    requestAnimationFrame(() => {
      ref.current?.focus();
      ref.current?.setSelectionRange(pos, pos);
    });
  };
  const backspace = () => {
    const a = Math.min(sel.current.s, value.length);
    const before = value.slice(0, a).replace(/\s+$/, '');
    const m = /(\[[^\]]*\]|[가-힣A-Za-z]+\(|"[^"]*"|\d+(\.\d+)?|>=|<=|<>|\S)$/.exec(before);
    const cut = m ? before.length - m[0].length : before.length;
    onChange(value.slice(0, cut) + value.slice(a));
    sel.current = { s: cut, e: cut };
  };

  const rowNames = scope.names.filter((n) => !scope.aggregateOnly.includes(n));
  const { problem, preview } = useMemo(() => {
    const problem = calcProblem(scope, value);
    if (problem) return { problem, preview: '' };
    try {
      const n = parseFormula(value);
      const sample = new Map<string, number>(scope.names.map((name, i) => [name, (i + 1) * 10]));
      const v = evaluate(n, (name, agg) => (scope.aggregateOnly.includes(name) && agg ? [10, 20, 30] : sample.get(name)));
      const vs = v === null ? '(빈칸)' : typeof v === 'number' ? (Math.round(v * 1000) / 1000).toLocaleString('ko-KR') : `"${v}"`;
      const ex = scope.names.slice(0, 3).map((name, i) => `${name}=${(i + 1) * 10}`).join(', ');
      return { problem: null, preview: `${printFormula(n)}  →  예시(${ex}${scope.aggregateOnly.length ? ', 목록 10·20·30' : ''})로 계산하면 ${vs}` };
    } catch {
      return { problem: '계산식을 읽을 수 없어요.', preview: '' };
    }
  }, [value, scope]);

  const chip = 'rounded-btn border px-1.5 py-0.5 text-xs hover:bg-white';
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs font-semibold text-sub">계산식 — 칸 이름을 누르거나 직접 입력하세요</span>
      <input ref={ref} value={value} spellCheck={false} aria-label="계산식"
        placeholder="[여] ÷ ([남] + [여]) × 100"
        onChange={(e) => { onChange(e.target.value); sel.current = { s: e.target.selectionStart ?? 0, e: e.target.selectionEnd ?? 0 }; }}
        onSelect={(e) => { const t = e.currentTarget; sel.current = { s: t.selectionStart ?? 0, e: t.selectionEnd ?? 0 }; }}
        className={cx('h-9 rounded-btn border bg-white px-2.5 font-mono text-[13px] outline-none focus:ring-3', problem && value ? 'border-err-ink focus:ring-err' : 'border-pri-line focus:border-pri focus:ring-pri-bg')} />
      <div className="flex flex-wrap gap-1" role="group" aria-label="칸 이름">
        {rowNames.length === 0 && <span className="text-xs text-muted">쓸 수 있는 칸이 아직 없어요. 다른 항목을 먼저 만들어 주세요.</span>}
        {rowNames.map((n) => <button key={n} type="button" onClick={() => insert(`[${n}]`)} className={cx(chip, 'border-pri-line bg-pri-bg text-pri-ink')}>{n}</button>)}
      </div>
      {scope.aggregateOnly.length > 0 && (
        <div className="flex flex-wrap items-center gap-1" role="group" aria-label="목록 칸 (합계 등 안에서)">
          <span className="text-[11px] text-muted">목록 칸(합계 등 안에서):</span>
          {scope.aggregateOnly.map((n) => <button key={n} type="button" onClick={() => insert(`[${n}]`)} className={cx(chip, 'border-[#bfe3d6] bg-auto text-auto-ink')}>{n}</button>)}
        </div>
      )}
      <div className="flex flex-wrap gap-1" role="group" aria-label="연산">
        {OPS.map(([l, t]) => <button key={l} type="button" onClick={() => insert(t)} className={cx(chip, 'min-w-7 border-line-strong bg-white')}>{l}</button>)}
        <button type="button" onClick={backspace} className={cx(chip, 'border-line-strong bg-white')} aria-label="하나 지우기">⌫</button>
        <button type="button" onClick={() => { onChange(''); sel.current = { s: 0, e: 0 }; }} className={cx(chip, 'border-line-strong bg-white text-err-ink')}>모두 지우기</button>
      </div>
      <div className="flex flex-wrap gap-1" role="group" aria-label="함수와 비교">
        {FNS.map(([l, t, title]) => <button key={l} type="button" title={title} onClick={() => insert(t)} className={cx(chip, 'border-line-strong bg-panel')}>{l}( )</button>)}
        {CMP.map(([l, t]) => <button key={l} type="button" onClick={() => insert(t)} className={cx(chip, 'min-w-7 border-line-strong bg-panel')}>{l}</button>)}
      </div>
      <div className="flex items-center gap-1">
        <input value={lit} onChange={(e) => setLit(e.target.value)} placeholder="숫자나 글자 넣기 (예: 100, 적합)" aria-label="넣을 숫자나 글자"
          className="h-7 min-w-0 flex-1 rounded-btn border border-line-strong bg-white px-2 text-xs outline-none focus:border-pri" />
        <button type="button" disabled={!lit.trim()} onClick={() => { const t = lit.trim().replace(/,/g, ''); insert(/^-?\d+(\.\d+)?$/.test(t) ? t : `"${lit.trim().replace(/"/g, '')}"`); setLit(''); }}
          className={cx(chip, 'shrink-0 whitespace-nowrap border-line-strong bg-white disabled:opacity-50')}>넣기</button>
      </div>
      {value && problem ? (
        <div className="rounded-btn bg-err px-2.5 py-1.5 text-xs text-err-ink" role="alert">{problem}</div>
      ) : preview ? (
        <div className="rounded-btn bg-pri-bg px-2.5 py-1.5 text-xs text-pri-ink">{preview}</div>
      ) : (
        <div className="text-xs text-muted">예: [여] ÷ ([남] + [여]) × 100 · 반올림([금액] × 0.1) · 조건([점수] ≥ 80, "적합", "부적합")</div>
      )}
    </div>
  );
}
