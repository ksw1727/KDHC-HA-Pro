import type { CellValue, RowRecord } from '@contract/meta';
import { blockFields, gridOwners, orgLabel, sameOrg, type Field, type FormSchema } from '@contract/schema';
import { josa } from '@contract/josa';
import { normalize, type Ctx } from './normalize';
import { slotId } from './parse';
import type { Decisions, IdentifiedFile, Issue, ParsedSubmission, Question, Slot } from './types';

/** ⑤ 결정 반영 — 03-aggregator.md 3.6 정책 표. 결정이 바뀌면 여기부터 다시 계산한다 */

export type FileStatusKind =
  | 'included' | 'duplicate' | 'operator' | 'form-sheet-missing'
  | 'other-form' | 'unreadable' | 'duplicate-content';

export const STATUS_LABEL: Record<FileStatusKind, string> = {
  included: '포함', duplicate: '중복(다른 파일 사용)', operator: '운영자 제외', 'form-sheet-missing': '양식 시트 없음',
  'other-form': '다른 양식', unreadable: '건너뜀', 'duplicate-content': '내용 같음',
};

export interface CellMarkInfo { mark: 'auto-fixed' | 'error'; note: string }

export interface FinalSubmission extends ParsedSubmission {
  label: string;                                   // 화면·시트에 쓰는 이름 (지사명, 없으면 파일명)
  before: RowRecord[];                             // 결정 전(값 정리 후) 목록 줄 — 검산에서 수정·제외 차이를 나눠 보일 때 씀
  marks: Map<string, CellMarkInfo>;                // slotId →
  removedRows: { sourceRow: number; reason: 'operator' | 'duplicate'; preview: string }[];
  extraFromAlias: { header: string; values: { sourceRow: number; value: unknown }[] }[];
}

export interface FileState {
  fileId: string;
  fileName: string;
  label: string;
  org?: string;
  status: FileStatusKind;
  reason?: string;
  savedAt: string;
  parsed?: ParsedSubmission;
  needsOrgLink: boolean;
  dupGroup?: string[];                             // 같은 지사 파일들 (fileId)
}

export interface DecisionLog { what: string; target: string; choice: string; defaulted: boolean }

export interface Resolved {
  files: FileState[];
  included: FinalSubmission[];
  valueIssues: (Issue & { choice: string; defaulted: boolean })[];
  questions: Question[];
  gridOverlay: Record<string, { value: CellValue; note: string }>;
  crossIssues: Issue[];                            // 여러 파일을 겹친 뒤의 확인 (빈칸채우기 필수 칸)
  missingOrgs: string[];
  log: DecisionLog[];
}

const FIX_LABEL = { proposal: '자동으로 고친 값', manual: '직접 고침', keep: '적혀 있던 값 그대로' } as const;
const show = (v: unknown) => (v === null || v === undefined || v === '' ? '(빈칸)' : v instanceof Date ? v.toISOString().slice(0, 10) : String(v));

export function resolve(schema: FormSchema, all: IdentifiedFile[], parsed: ParsedSubmission[], d: Decisions, ctx: Ctx): Resolved {
  const useOrg = schema.org.mode !== 'none';
  const orgs = schema.org.orgs ?? [];
  const log: DecisionLog[] = [];

  // 1. 파일마다 상태 정하기
  const files: FileState[] = [];
  for (const f of all) {
    if (f.status !== 'ok') {
      files.push({ fileId: f.file.id, fileName: f.file.fileName, label: f.file.fileName, status: f.status, reason: f.skipReason, savedAt: f.savedAt, needsOrgLink: false });
    }
  }
  for (const p of parsed) {
    const linked = d.orgLink[p.fileId];
    const org = useOrg ? (linked ?? p.org) : undefined;
    const needsOrgLink = useOrg && !linked && orgs.length > 0 && (!org || !orgs.includes(org));
    if (linked) log.push({ what: `${orgLabel(schema)} 연결`, target: p.sourceFile, choice: linked, defaulted: false });
    const base: FileState = { fileId: p.fileId, fileName: p.sourceFile, label: org ?? p.sourceFile, org, status: 'included', savedAt: p.savedAt, parsed: p, needsOrgLink };
    const missing = schema.layout === 'collect' ? !p.read.collectSheets?.length : p.read.infos.some((i) => i.code === 'FORM_SHEET_MISSING');
    if (missing && !p.fromAggregate) Object.assign(base, { status: 'form-sheet-missing', reason: '양식 시트가 없어요' });
    else if (d.excludeFile[p.fileId]) {
      Object.assign(base, { status: 'operator', reason: '운영자 제외' });
      log.push({ what: '파일 제외', target: p.sourceFile, choice: '제외', defaulted: false });
    }
    files.push(base);
  }

  // 2. 같은 지사 파일이 둘 이상이면 저장 시각이 가장 늦은 것 (운영자가 바꿀 수 있음)
  if (useOrg) {
    const groups = new Map<string, FileState[]>();
    for (const s of files) if (s.status === 'included' && s.org) groups.set(s.org, [...(groups.get(s.org) ?? []), s]);
    for (const [org, g] of groups) {
      if (g.length < 2) continue;
      const latest = [...g].sort((a, b) => b.savedAt.localeCompare(a.savedAt))[0];
      const chosenId = d.duplicateChoice[org] && g.some((s) => s.fileId === d.duplicateChoice[org]) ? d.duplicateChoice[org] : latest.fileId;
      for (const s of g) {
        s.dupGroup = g.map((x) => x.fileId);
        if (s.fileId !== chosenId) Object.assign(s, { status: 'duplicate', reason: `같은 ${orgLabel(schema)}의 다른 파일을 썼어요` });
      }
      log.push({ what: '중복 파일 선택', target: org, choice: g.find((s) => s.fileId === chosenId)!.fileName, defaulted: !d.duplicateChoice[org] });
    }
  }

  // 3. 포함된 파일에 결정 반영
  const fieldOf = new Map<string, Field>();
  for (const b of schema.blocks) for (const f of blockFields(b)) fieldOf.set(f.key, f);
  const questions: Question[] = [];
  const valueIssues: Resolved['valueIssues'] = [];
  const included: FinalSubmission[] = [];

  for (const s of files) {
    if (s.status !== 'included' || !s.parsed) continue;
    const p = s.parsed;
    const fin: FinalSubmission = {
      ...p, org: s.org, label: s.label, before: p.rows, header: { ...p.header }, rows: p.rows.map(copyRow),
      matrices: p.matrices ? Object.fromEntries(Object.entries(p.matrices).map(([id, m]) => [id, m.map((r) => [...r])])) : undefined, grid: p.grid ? { ...p.grid } : undefined, gridSpareRows: p.gridSpareRows?.map(copyRow),
      marks: new Map(), removedRows: [], extraFromAlias: [],
    };
    let issues = p.issues.filter((i) => i.severity === 'value');

    // 3-1. 판단 질문 (비슷한 칸 이름, 같은 줄 두 번)
    for (const q of p.read.questions) {
      questions.push(q);
      const ans = d.answers[q.id] ?? q.defaultChoice;
      log.push({ what: '애매한 판단', target: `${s.label} · ${q.message}`, choice: q.choices.find((c) => c.id === ans)?.label ?? ans, defaulted: d.answers[q.id] === undefined });
      if (q.kind === 'column-alias' && ans === 'extra' && q.fieldKey) {
        fin.extraFromAlias.push({ header: q.header ?? '', values: p.read.rows.map((r) => ({ sourceRow: r.sourceRow, value: r.cells[q.fieldKey!]?.raw })).filter((v) => v.value !== null && v.value !== undefined && v.value !== '') });
        for (const r of fin.rows) r.values[q.fieldKey] = null;
        issues = issues.filter((i) => !(i.slot?.part === 'row' && i.slot.key === q.fieldKey));
      }
      if (q.kind === 'same-row-twice' && ans === 'one' && q.sourceRow) removeRow(fin, q.sourceRow, 'duplicate');
    }

    // 3-2. [이 줄 빼기]
    for (const r of [...fin.rows, ...(fin.gridSpareRows ?? [])]) {
      if (d.excludeRow[`${p.fileId}:${r.sourceRow}`]) {
        removeRow(fin, r.sourceRow, 'operator');
        log.push({ what: '줄 빼기', target: `${s.label} · ${r.sourceRow}행`, choice: '운영자 제외', defaulted: false });
      }
    }
    const gone = new Set(fin.removedRows.map((r) => r.sourceRow));
    issues = issues.filter((i) => !(i.slot && 'sourceRow' in i.slot && gone.has(i.slot.sourceRow)));

    // 3-3. 자동 정리 칸: 연한 파랑 + 원래 값 메모
    for (const a of p.autoFixed) if (!('sourceRow' in a.slot && gone.has(a.slot.sourceRow))) fin.marks.set(slotId(a.slot), { mark: 'auto-fixed', note: `[자동] 원래 값: ${show(a.from)} · 자동 정리` });

    // 3-4. 확인할 칸: 미결정이면 수정안 있으면 수정안, 없으면 그대로
    for (const iss of issues) {
      const chosen = d.cellFix[iss.id];
      const mode = chosen?.mode ?? (iss.proposal !== undefined ? 'proposal' : 'keep');
      const field = iss.slot ? fieldOf.get(iss.slot.key) : undefined;
      let value: CellValue = getSlot(fin, iss.slot!);
      let mark: CellMarkInfo;
      if (mode === 'proposal' && iss.proposal !== undefined) {
        value = iss.proposal;
        mark = { mark: 'auto-fixed', note: `[자동] 원래 값: ${show(iss.raw)} · 수정: 수정안` };
      } else if (mode === 'manual') {
        const r = field ? normalize(chosen?.value ?? null, field, ctx) : null;
        value = r && (r.status === 'ok' || r.status === 'auto') ? r.value : chosen?.value ?? null;
        mark = { mark: 'auto-fixed', note: `[자동] 원래 값: ${show(iss.raw)} · 수정: 운영자` };
      } else {
        mark = { mark: 'error', note: `[자동] ${iss.message}` };
      }
      setSlot(fin, iss.slot!, value);
      fin.marks.set(slotId(iss.slot!), mark);
      valueIssues.push({ ...iss, choice: FIX_LABEL[mode], defaulted: !chosen });
      log.push({ what: '확인할 칸', target: `${s.label} · ${iss.location} (${show(iss.raw)})`, choice: `${FIX_LABEL[mode]}${mode !== 'keep' ? `: ${show(value)}` : ''}`, defaulted: !chosen });
    }
    included.push(fin);
  }

  // 4. 빈칸채우기: 모든 제출을 겹친다. 다른 값이 있으면 물어보고(기본 = 최신 파일), 필수 칸은 겹친 뒤에도 비면 1건
  const gridOverlay: Resolved['gridOverlay'] = {};
  const crossIssues: Issue[] = [];
  const grid = schema.blocks.find((b) => b.kind === 'grid');
  const owners = gridOwners(schema);
  if (grid?.kind === 'grid') {
    for (const cell of grid.rows.flat()) {
      if (cell.kind !== 'input') continue;
      const key = cell.field.key;
      const got = included.filter((x) => x.grid?.[key] !== undefined && x.grid[key] !== null).map((x) => ({ x, v: x.grid![key] }));
      const owner = owners.get(key);
      if (!got.length) {
        // 작성처가 정해진 칸: 그 제출처가 냈는데 비었을 때만 (안 냈으면 미제출로 보인다)
        const ownerIn = owner ? included.find((x) => x.org && sameOrg(x.org, owner)) : undefined;
        if (cell.field.required && (!owner || ownerIn)) crossIssues.push({ id: `grid-required:${key}`, fileId: ownerIn?.fileId ?? '', code: 'REQUIRED_EMPTY', severity: 'value', sheet: '', location: cell.field.label, fieldLabel: cell.field.label, message: owner ? `${josa(owner, '이', '가')} 채우지 않은 필수 칸이에요` : '어느 파일에도 채워지지 않은 필수 칸이에요' });
        continue;
      }
      const distinct = [...new Set(got.map((g) => JSON.stringify(g.v)))];
      let pick = got[0];
      if (distinct.length > 1) {
        const latest = [...got].sort((a, b) => b.x.savedAt.localeCompare(a.x.savedAt))[0];
        const q: Question = {
          id: `grid:${key}`, kind: 'grid-conflict', fieldKey: key,
          message: `"${cell.field.label}" 칸에 파일마다 다른 값이 있어요. 어느 값을 쓸까요?`,
          choices: got.map((g) => ({ id: g.x.fileId, label: `${g.x.label}: ${show(g.v)}` })), defaultChoice: latest.x.fileId,
        };
        questions.push(q);
        const ans = d.answers[q.id] ?? q.defaultChoice;
        pick = got.find((g) => g.x.fileId === ans) ?? latest;
        log.push({ what: '빈칸채우기 충돌', target: cell.field.label, choice: `${pick.x.label}: ${show(pick.v)}`, defaulted: d.answers[q.id] === undefined });
      }
      const others = got.filter((g) => g !== pick).map((g) => `${g.x.label}: ${show(g.v)}`);
      gridOverlay[key] = { value: pick.v, note: `[자동] 출처: ${pick.x.label} (${pick.x.sourceFile})${others.length ? `\n다른 값 — ${others.join(', ')}` : ''}` };
    }
  }

  const missingOrgs = useOrg ? orgs.filter((o) => !files.some((s) => s.org === o && (s.status === 'included' || s.status === 'duplicate'))) : [];
  return { files, included: sortByOrg(included, orgs), valueIssues, questions, gridOverlay, crossIssues, missingOrgs, log };
}

const copyRow = (r: RowRecord): RowRecord => ({ ...r, values: { ...r.values } });

function removeRow(fin: FinalSubmission, sourceRow: number, reason: 'operator' | 'duplicate') {
  for (const list of [fin.rows, fin.gridSpareRows ?? []]) {
    const i = list.findIndex((r) => r.sourceRow === sourceRow);
    if (i < 0) continue;
    const preview = Object.values(list[i].values).filter((v) => v !== null).join(' · ').slice(0, 60);
    list.splice(i, 1);
    fin.removedRows.push({ sourceRow, reason, preview });
  }
}

function getSlot(s: FinalSubmission, slot: Slot): CellValue {
  switch (slot.part) {
    case 'header': return s.header[slot.key] ?? null;
    case 'grid': return s.grid?.[slot.key] ?? null;
    case 'row': return s.rows.find((r) => r.sourceRow === slot.sourceRow)?.values[slot.key] ?? null;
    case 'spare': return s.gridSpareRows?.find((r) => r.sourceRow === slot.sourceRow)?.values[slot.key] ?? null;
    case 'matrix': return s.matrices?.[slot.blockId]?.[slot.r]?.[slot.c] ?? null;
  }
}

function setSlot(s: FinalSubmission, slot: Slot, v: CellValue) {
  switch (slot.part) {
    case 'header': s.header[slot.key] = v; break;
    case 'grid': (s.grid ??= {})[slot.key] = v; break;
    case 'row': { const r = s.rows.find((x) => x.sourceRow === slot.sourceRow); if (r) r.values[slot.key] = v; break; }
    case 'spare': { const r = s.gridSpareRows?.find((x) => x.sourceRow === slot.sourceRow); if (r) r.values[slot.key] = v; break; }
    case 'matrix': { const m = s.matrices?.[slot.blockId]; if (m?.[slot.r]) m[slot.r][slot.c] = v; break; }
  }
}

/** 지사 순서: 목록 순 → 가나다 (지사 없으면 파일명 순) */
function sortByOrg<T extends { org?: string; label: string }>(xs: T[], orgs: string[]): T[] {
  const rank = (x: T) => (x.org && orgs.includes(x.org) ? orgs.indexOf(x.org) : orgs.length);
  return [...xs].sort((a, b) => rank(a) - rank(b) || a.label.localeCompare(b.label, 'ko'));
}
