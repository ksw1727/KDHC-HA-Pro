import type { SheetModel } from '@contract/layout';
import type { FormSchema } from '@contract/schema';
import type { Resolved } from './resolve';

/** ⑦ 검산 — 한 줄도 잃지 않았는지, 숫자 합계가 맞는지 (03-aggregator.md 3.8) */

export interface VerifyLine { check: string; detail: string; ok: boolean }
export interface VerifyResult { ok: boolean; lines: VerifyLine[] }

const n = (v: unknown) => (typeof v === 'number' ? v : 0);
const round = (x: number) => Math.round(x * 1e6) / 1e6;

export function verify(schema: FormSchema, res: Resolved, model?: SheetModel): VerifyResult {
  const lines: VerifyLine[] = [];
  const included = res.included.filter((s) => !s.fromAggregate);

  // 1. 줄 수: 읽은 줄 = 반영 + 제외(사유별)
  if (schema.blocks.some((b) => b.kind === 'list' || (b.kind === 'grid' && b.spareRows > 0))) {
    let allOk = true;
    const sum = { read: 0, kept: 0, blank: 0, example: 0, total: 0, operator: 0, duplicate: 0, hidden: 0 };
    for (const s of included) {
      const kept = s.rows.length + (s.gridSpareRows?.length ?? 0);
      const ex = { blank: 0, example: 0, total: 0, operator: 0, duplicate: 0, hidden: 0 };
      for (const e of s.read.excludedRows) ex[e.reason]++;
      for (const e of s.removedRows) ex[e.reason]++;
      const accounted = kept + ex.blank + ex.example + ex.total + ex.operator + ex.duplicate + ex.hidden;
      if (accounted !== s.read.readCount) {
        allOk = false;
        lines.push({ check: '줄 수', detail: `${s.label}: 읽은 줄 ${s.read.readCount} ≠ 반영 ${kept} + 제외 ${accounted - kept}`, ok: false });
      }
      sum.read += s.read.readCount; sum.kept += kept;
      for (const k of Object.keys(ex) as (keyof typeof ex)[]) sum[k] += ex[k];
    }
    const parts = [['빈 줄', sum.blank], ['예시', sum.example], ['합계 줄', sum.total], ['운영자 제외', sum.operator], ['중복', sum.duplicate], ['숨긴 줄 제외', sum.hidden]].filter(([, c]) => c).map(([l, c]) => `${l} ${c}`);
    lines.unshift({ check: '줄 수', detail: `읽은 줄 ${sum.read} = 반영 ${sum.kept}${parts.length ? ` + ${parts.join(' + ')}` : ''}`, ok: allOk });
  }

  // 2. 파일 수: 넣은 파일 = 반영 + 제외 + 건너뜀
  const by = (st: string) => res.files.filter((f) => f.status === st).length;
  const fileParts = [['반영', by('included')], ['중복', by('duplicate')], ['운영자 제외', by('operator')], ['양식 시트 없음', by('form-sheet-missing')], ['다른 양식', by('other-form')], ['내용 같음', by('duplicate-content')], ['건너뜀', by('unreadable')]].filter(([, c]) => c);
  const fileSum = fileParts.reduce((s, [, c]) => s + (c as number), 0);
  lines.push({ check: '파일 수', detail: `넣은 파일 ${res.files.length} = ${fileParts.map(([l, c]) => `${l} ${c}`).join(' + ')}${res.missingOrgs.length ? ` · 미제출 ${res.missingOrgs.length}곳(${res.missingOrgs.join(' · ')})` : ''}`, ok: fileSum === res.files.length });

  // 3. 숫자 합계: 원본(값 정리 후) → 수정·제외 차이 → 같은 틀 시트에 실제로 들어간 합
  const list = schema.blocks.find((b) => b.kind === 'list');
  if (list?.kind === 'list' && model) {
    const lm = model.cellMap.blocks[list.id];
    for (const f of list.columns.filter((c) => c.type === 'number')) {
      let source = 0, fixed = 0, removed = 0, hiddenOut = 0;
      for (const s of res.included) {
        const at = (row: number) => n(s.before.find((x) => x.sourceRow === row)?.values[f.key]);
        for (const r of s.before) source += n(r.values[f.key]);
        for (const r of s.rows) fixed += n(r.values[f.key]) - at(r.sourceRow);
        for (const r of s.removedRows) { if (r.reason === 'hidden') hiddenOut -= at(r.sourceRow); else removed -= at(r.sourceRow); }
      }
      let sheet = 0;
      if (lm?.kind === 'list') {
        const col = lm.columns[f.key];
        for (const c of model.cells) {
          const p = /^([A-Z]+)(\d+)$/.exec(c.address)!;
          if (p[1] === col && +p[2] >= lm.firstDataRow && +p[2] <= lm.lastDataRow) sheet += n(c.value);
        }
      }
      const expected = round(source + fixed + removed + hiddenOut);
      const diffs = [fixed && `수정으로 ${fixed > 0 ? '+' : ''}${round(fixed)}`, removed && `운영자 제외로 ${round(removed)}`, hiddenOut && `숨긴 줄 제외로 ${round(hiddenOut)}`].filter(Boolean);
      lines.push({ check: `숫자 합계 · ${f.label}`, detail: `원본 ${round(source)}${diffs.length ? ` (${diffs.join(', ')})` : ''} → 같은 틀 시트 ${round(sheet)}`, ok: round(sheet) === expected });
    }
  }
  for (const matrix of schema.blocks) {
    if (matrix.kind !== 'matrix' || !model) continue;
    const mm = model.cellMap.blocks[matrix.id];
    const source = res.included.reduce((s, x) => s + (x.matrices?.[matrix.id] ?? []).flat().reduce<number>((a, v) => a + n(v), 0), 0);
    let sheet = 0;
    if (mm?.kind === 'matrix') {
      const addrs = new Set(mm.cells.flat());
      for (const c of model.cells) if (addrs.has(c.address)) sheet += n(c.value);
    }
    lines.push({ check: `숫자 합계 · ${matrix.title?.trim() || '표'}`, detail: `제출 값 합 ${round(source)} → 같은 틀 시트 ${round(sheet)}`, ok: round(source) === round(sheet) });
  }

  // 4. 원본 파일에 적힌 합계와 대조 (합계 줄·합계 행·계 열)
  const checks = included.flatMap((s) => s.read.totalRowChecks.map((c) => ({ s, c })));
  if (checks.length) {
    const bad = checks.filter(({ c }) => Math.abs(c.written - c.computed) > 1e-9);
    // 원본 파일에 적힌 합계가 틀린 것은 작성자 쪽 문제라 우리 검산 결과(일치/불일치)에는 넣지 않고 참고로만 보인다
    lines.push({ check: '참고 · 원본 합계', detail: bad.length ? `${bad.map(({ s, c }) => `${s.label} ${c.label ?? `${c.sourceRow}행 합계 줄`}: 적힌 ${c.written} ≠ 계산 ${round(c.computed)}`).join(' · ')} — 원본 파일에 적힌 합계가 틀렸어요(취합 문제는 아님)` : `원본 파일에 적힌 합계 ${checks.length}곳이 모두 맞아요`, ok: true });
  }

  // 5. 빈칸채우기: 입력칸 = 채운 칸 + 빈칸, 충돌
  const grid = schema.blocks.find((b) => b.kind === 'grid');
  if (grid?.kind === 'grid') {
    const inputs = grid.rows.flat().filter((c) => c.kind === 'input');
    const filled = Object.keys(res.gridOverlay).length;
    const conflicts = res.questions.filter((q) => q.kind === 'grid-conflict').length;
    lines.push({ check: '빈칸채우기', detail: `입력칸 ${inputs.length} = 채운 칸 ${filled} + 빈칸 ${inputs.length - filled}${res.crossIssues.length ? ` (필수 빈칸 ${res.crossIssues.length})` : ''} · 충돌 ${conflicts}`, ok: true });
  }

  return { ok: lines.every((l) => l.ok), lines };
}
