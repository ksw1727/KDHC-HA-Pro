import { layoutSheet, type AggregateFill, type SheetModel } from '@contract/layout';
import type { CellValue } from '@contract/meta';
import { computeHeader, computeListRow } from '@contract/formula';
import { orgLabel, type FormSchema, type ListBlock } from '@contract/schema';
import { slotId } from './parse';
import { STATUS_LABEL, type FinalSubmission, type Resolved } from './resolve';

/** ⑥ 취합 — 같은 틀 시트(contract/layout으로) + 선택 시트(표) */

export interface Table {
  name: string;
  columns: { header: string; width?: number }[];
  rows: CellValue[][];
}

/** 화면·결과 파일에 쓰는 시각: 이 PC 시간대로 'YYYY-MM-DD HH:mm' */
export const fmtTime = (iso: string) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const p = (x: number) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
};
/** 같은 틀 시트의 각 목록 줄이 어느 제출의 몇 행인지 (작성자 메모를 같은 칸에 옮길 때 씀) */
export interface FrameRowRef { fileId: string; sourceRow: number }

export interface SameFrame { model: SheetModel; rowRefs: FrameRowRef[]; spareRefs: FrameRowRef[]; matrixNotes: Record<string, string> }

const statusOf = (s: FinalSubmission, sourceRow: number, keys: string[], flags: string[] = []): string => {
  const words = new Set<string>();
  if (flags.includes('hidden')) words.add('숨긴 줄');
  if (flags.includes('strike')) words.add('취소선');
  for (const k of keys) {
    const m = s.marks.get(slotId({ part: 'row', key: k, sourceRow }));
    if (!m) continue;
    words.add(m.mark === 'error' ? '오류' : m.note.includes('수정:') ? '수정' : '자동 정리');
  }
  return [...words].join(', ');
};

export function buildSameFrame(schema: FormSchema, res: Resolved, info: string, today: Date): SameFrame {
  const useOrg = schema.org.mode !== 'none';
  const fieldsBlock = schema.blocks.find((b) => b.kind === 'fields');
  const headerFields = fieldsBlock?.kind === 'fields' ? fieldsBlock.fields : [];
  const list = schema.blocks.find((b) => b.kind === 'list') as ListBlock | undefined;
  const data: AggregateFill = { autoColumns: [] };
  const rowRefs: FrameRowRef[] = [];
  const spareRefs: FrameRowRef[] = [];
  const matrixNotes: Record<string, string> = {};

  if (list) {
    data.autoColumns = [...(useOrg ? [orgLabel(schema)] : []), ...headerFields.map((f) => f.label), '출처 파일', '원본 줄', '상태'];
    data.rows = [];
    const keys = list.columns.map((c) => c.key);
    for (const s of res.included) {
      const headerAll = computeHeader(schema, s.header, s.rows.map((r) => r.values));
      const headerByName = Object.fromEntries(headerFields.map((f) => [f.label.trim(), headerAll[f.key] ?? null]));
      const head = headerFields.map((f) => headerAll[f.key] ?? null);
      const lead = useOrg ? [s.label] : [];
      if (!s.rows.length && headerFields.length) {
        data.rows.push({ values: {}, auto: [...lead, ...head, s.sourceFile, null, '목록 없음'] });
        rowRefs.push({ fileId: s.fileId, sourceRow: -1 });
      }
      for (const r of s.rows) {
        data.rows.push({
          values: computeListRow(list, r.values, headerByName),
          auto: [...lead, ...head, s.sourceFile, r.sourceRow, statusOf(s, r.sourceRow, keys, r.flags) || null],
          marks: keys.flatMap((k) => { const m = s.marks.get(slotId({ part: 'row', key: k, sourceRow: r.sourceRow })); return m ? [{ key: k, mark: m.mark, note: m.note }] : []; }),
          muted: r.flags?.includes('hidden'),
          strike: r.flags?.includes('strike'),
        });
        rowRefs.push({ fileId: s.fileId, sourceRow: r.sourceRow });
      }
    }
  }

  const matrix = schema.blocks.find((b) => b.kind === 'matrix');
  if (matrix?.kind === 'matrix') {
    data.matrixSums = matrix.rowLabels.map((_, r) => matrix.colLabels.map((__, c) => {
      let sum = 0, skipped = 0, any = false;
      for (const s of res.included) {
        const v = s.matrix?.[r]?.[c];
        if (typeof v === 'number') { sum += v; any = true; } else if (v !== null && v !== undefined) skipped++;
      }
      if (skipped) matrixNotes[`${r}:${c}`] = `[자동] 숫자가 아니라서 합에서 뺀 값 ${skipped}개`;
      return any ? sum : null;
    }));
  }

  const grid = schema.blocks.find((b) => b.kind === 'grid');
  if (grid?.kind === 'grid') {
    data.grid = res.gridOverlay;
    if (grid.spareRows > 0) {
      data.autoColumns = [...(useOrg ? [orgLabel(schema)] : []), '출처 파일', '원본 줄'];
      data.gridSpare = res.included.flatMap((s) => (s.gridSpareRows ?? []).map((r) => {
        spareRefs.push({ fileId: s.fileId, sourceRow: r.sourceRow });
        return { values: (grid.spareColumns ?? []).map((f) => r.values[f.key] ?? null), auto: [...(useOrg ? [s.label] : []), s.sourceFile, r.sourceRow] };
      }));
    }
  }

  const model = layoutSheet(schema, { mode: 'aggregate', info, data }, { today });
  return { model, rowRefs, spareRefs, matrixNotes };
}

/** 지사별 펼치기 (spread): 제출당 1행 */
export function spreadTable(schema: FormSchema, res: Resolved): Table {
  const first = schema.org.mode !== 'none' ? orgLabel(schema) : '출처 파일';
  const lead = (s: FinalSubmission) => (schema.org.mode !== 'none' ? s.label : s.sourceFile);
  const b = schema.blocks.find((x) => x.kind === 'matrix');
  if (b?.kind === 'matrix') {
    const cols = b.rowLabels.flatMap((r) => b.colLabels.map((c) => `${r} ${c}`));
    const rows = res.included.map((s) => [lead(s), ...b.rowLabels.flatMap((_, r) => b.colLabels.map((__, c) => s.matrix?.[r]?.[c] ?? null))]);
    const total = cols.map((_, i) => rows.reduce((sum, row) => sum + (typeof row[i + 1] === 'number' ? (row[i + 1] as number) : 0), 0));
    return { name: '지사별', columns: [first, ...cols].map((header) => ({ header })), rows: [...rows, ['합계', ...total]] };
  }
  const g = schema.blocks.find((x) => x.kind === 'grid');
  if (g?.kind === 'grid') {
    const inputs = g.rows.flat().flatMap((c) => (c.kind === 'input' ? [c.field] : []));
    return { name: '지사별', columns: [first, ...inputs.map((f) => f.label)].map((header) => ({ header })), rows: res.included.map((s) => [lead(s), ...inputs.map((f) => s.grid?.[f.key] ?? null)]) };
  }
  const fb = schema.blocks.find((x) => x.kind === 'fields');
  const hf = fb?.kind === 'fields' ? fb.fields : [];
  return {
    name: '지사별',
    columns: [first, ...hf.map((f) => f.label), '목록 행 수'].map((header) => ({ header })),
    rows: res.included.map((s) => { const h = computeHeader(schema, s.header, s.rows.map((r) => r.values)); return [lead(s), ...hf.map((f) => h[f.key] ?? null), s.rows.length]; }),
  };
}

/** 제출 현황 (submission-status): 지사 목록 전체 + 목록 밖 지사 */
export function statusTable(schema: FormSchema, res: Resolved): Table {
  const errCount = (id: string) => res.valueIssues.filter((i) => i.fileId === id && i.choice === '적혀 있던 값 그대로').length;
  const fixCount = (id: string) => res.valueIssues.filter((i) => i.fileId === id && i.choice !== '적혀 있던 값 그대로').length;
  const rows: CellValue[][] = [];
  for (const s of res.files) {
    if (s.status === 'unreadable' || s.status === 'other-form' || s.status === 'duplicate-content') {
      rows.push([s.label, '제외', s.fileName, fmtTime(s.savedAt), 0, 0, 0, s.reason ?? STATUS_LABEL[s.status]]);
      continue;
    }
    const fin = res.included.find((x) => x.fileId === s.fileId);
    const count = fin ? fin.rows.length + (fin.gridSpareRows?.length ?? 0) : 0;
    const state = s.status === 'included' ? (fin && !count && schema.blocks.some((b) => b.kind === 'list') ? '해당 없음' : '제출') : s.status === 'duplicate' ? '중복' : '제외';
    rows.push([s.label, state, s.fileName, fmtTime(s.savedAt), count, errCount(s.fileId), fixCount(s.fileId), s.status === 'included' ? '포함' : s.reason ?? STATUS_LABEL[s.status]]);
  }
  for (const o of res.missingOrgs) rows.push([o, '미제출', null, null, null, null, null, null]);
  return {
    name: '제출 현황',
    columns: [orgLabel(schema), '상태', '파일명', '저장 시각', '반영 행 수', '오류 수', '수정 수', '처리'].map((header) => ({ header })),
    rows,
  };
}
