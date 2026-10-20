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

/**
 * 제출 하나의 계산 칸: 목록 계산 열(금액 = 수량 × 단가 등)을 먼저 계산해야 위쪽 계산 항목(합계([금액]) 등)이 맞는다.
 * 목록 계산 열이 위쪽 계산 항목을 쓸 수도 있어서, 위쪽을 계산한 뒤 목록을 한 번 더 계산한다.
 */
export function computeSubmission(schema: FormSchema, header: Record<string, CellValue>, rows: Record<string, CellValue>[]) {
  const list = schema.blocks.find((b) => b.kind === 'list') as ListBlock | undefined;
  const fb = schema.blocks.find((b) => b.kind === 'fields');
  const hf = fb?.kind === 'fields' ? fb.fields : [];
  const byName = (h: Record<string, CellValue>) => Object.fromEntries(hf.map((f) => [f.label.trim(), h[f.key] ?? null]));
  const first = list ? rows.map((r) => computeListRow(list, r, byName(header))) : rows;
  const headerAll = computeHeader(schema, header, first) as Record<string, CellValue>;
  const finalRows = list ? rows.map((r) => computeListRow(list, r, byName(headerAll))) : rows;
  return { header: headerAll, rows: finalRows as Record<string, CellValue>[] };
}

/**
 * 같은 틀 시트. clean = 결과 파일용: 자동 칸은 제출처(식별 안 함이면 출처 파일)만, 표시·[자동] 메모 없이 값만.
 * clean이 아니면 검토 파일용: 출처 파일·원본 줄·상태와 표시·메모까지.
 */
export function buildSameFrame(schema: FormSchema, res: Resolved, info: string, today: Date, clean = false): SameFrame {
  const useOrg = schema.org.mode !== 'none';
  // 결과 파일에 남길 자동 칸: 제출처 + 위쪽 정보 (식별 안 함이면 누가 냈는지 알 수 있게 출처 파일)
  const keepSource = !clean || !useOrg;
  const fieldsBlock = schema.blocks.find((b) => b.kind === 'fields');
  const headerFields = fieldsBlock?.kind === 'fields' ? fieldsBlock.fields : [];
  const list = schema.blocks.find((b) => b.kind === 'list') as ListBlock | undefined;
  const data: AggregateFill = { autoColumns: [] };
  const rowRefs: FrameRowRef[] = [];
  const spareRefs: FrameRowRef[] = [];
  const matrixNotes: Record<string, string> = {};

  if (list) {
    data.autoColumns = [...(useOrg ? [orgLabel(schema)] : []), ...headerFields.map((f) => f.label), ...(keepSource ? ['출처 파일'] : []), ...(clean ? [] : ['원본 줄', '상태'])];
    const frameRows: NonNullable<AggregateFill['rows']> = (data.rows = []);
    const keys = list.columns.map((c) => c.key);
    for (const s of res.included) {
      const calc = computeSubmission(schema, s.header, s.rows.map((r) => r.values));
      const headerAll = calc.header;
      const head = headerFields.map((f) => headerAll[f.key] ?? null);
      const lead = useOrg ? [s.label] : [];
      if (!s.rows.length && headerFields.length) {
        frameRows.push({ values: {}, auto: [...lead, ...head, ...(keepSource ? [s.sourceFile] : []), ...(clean ? [] : [null, '목록 없음'])] });
        rowRefs.push({ fileId: s.fileId, sourceRow: -1 });
      }
      s.rows.forEach((r, ri) => {
        frameRows.push({
          values: calc.rows[ri],
          auto: [...lead, ...head, ...(keepSource ? [s.sourceFile] : []), ...(clean ? [] : [r.sourceRow, statusOf(s, r.sourceRow, keys, r.flags) || null])],
          marks: clean ? [] : keys.flatMap((k) => { const m = s.marks.get(slotId({ part: 'row', key: k, sourceRow: r.sourceRow })); return m ? [{ key: k, mark: m.mark, note: m.note }] : []; }),
          muted: r.flags?.includes('hidden'),
          strike: r.flags?.includes('strike'),
        });
        rowRefs.push({ fileId: s.fileId, sourceRow: r.sourceRow });
      });
    }
  }

  // 숫자 표마다 칸끼리 합 (자유 제작형은 표가 여러 개라 블록 id별로)
  for (const m of schema.blocks) {
    if (m.kind !== 'matrix') continue;
    (data.matrixSumsBy ??= {})[m.id] = m.rowLabels.map((_, r) => m.colLabels.map((__, c) => {
      let sum = 0, skipped = 0, any = false;
      for (const s of res.included) {
        const v = s.matrices?.[m.id]?.[r]?.[c];
        if (typeof v === 'number') { sum += v; any = true; } else if (v !== null && v !== undefined) skipped++;
      }
      if (skipped && !clean) matrixNotes[`${m.id}:${r}:${c}`] = `[자동] 숫자가 아니라서 합에서 뺀 값 ${skipped}개`;
      return any ? sum : null;
    }));
  }

  const grid = schema.blocks.find((b) => b.kind === 'grid');
  if (grid?.kind === 'grid') {
    data.grid = clean ? Object.fromEntries(Object.entries(res.gridOverlay).map(([k, v]) => [k, { value: v.value, note: '' }])) : res.gridOverlay;
    if (grid.spareRows > 0) {
      data.autoColumns = [...(useOrg ? [orgLabel(schema)] : []), ...(keepSource ? ['출처 파일'] : []), ...(clean ? [] : ['원본 줄'])];
      data.gridSpare = res.included.flatMap((s) => (s.gridSpareRows ?? []).map((r) => {
        spareRefs.push({ fileId: s.fileId, sourceRow: r.sourceRow });
        return { values: (grid.spareColumns ?? []).map((f) => r.values[f.key] ?? null), auto: [...(useOrg ? [s.label] : []), ...(keepSource ? [s.sourceFile] : []), ...(clean ? [] : [r.sourceRow])] };
      }));
    }
  }

  const model = layoutSheet(schema, { mode: 'aggregate', info, data }, { today });
  return { model, rowRefs, spareRefs, matrixNotes };
}

/** 지사별 시트 이름: 제출처를 식별하지 않으면(none) 응답 파일 단위라 '파일별' */
export const spreadName = (schema: FormSchema) => (schema.org.mode === 'none' ? '파일별' : `${orgLabel(schema)}별`);

/** 지사별 펼치기 (spread): 제출당 1행 = 위쪽 정보·입력 칸 + 숫자 표 {행제목} {열제목} + 빈칸채우기 입력칸 + (목록 있으면) 목록 행 수 */
export function spreadTable(schema: FormSchema, res: Resolved): Table {
  const useOrg = schema.org.mode !== 'none';
  const fb = schema.blocks.find((x) => x.kind === 'fields');
  const hf = fb?.kind === 'fields' ? fb.fields : [];
  const mats = schema.blocks.flatMap((b) => (b.kind === 'matrix' ? [b] : []));
  const grid = schema.blocks.find((x) => x.kind === 'grid');
  const inputs = grid?.kind === 'grid' ? grid.rows.flat().flatMap((c) => (c.kind === 'input' ? [c.field] : [])) : [];
  const hasList = schema.blocks.some((b) => b.kind === 'list');
  const prefix = (m: (typeof mats)[number]) => (mats.length > 1 ? `${m.title?.trim() || m.id} ` : '');
  const columns = [
    useOrg ? orgLabel(schema) : '출처 파일', ...hf.map((f) => f.label),
    ...mats.flatMap((m) => m.rowLabels.flatMap((r) => m.colLabels.map((c) => `${prefix(m)}${r} ${c}`))),
    ...inputs.map((f) => f.label), ...(hasList ? ['목록 행 수'] : []),
  ];
  const rows: CellValue[][] = res.included.map((s) => {
    const h = computeSubmission(schema, s.header, s.rows.map((r) => r.values)).header;
    return [
      useOrg ? s.label : s.sourceFile, ...hf.map((f) => h[f.key] ?? null),
      ...mats.flatMap((m) => m.rowLabels.flatMap((_, r) => m.colLabels.map((__, c) => s.matrices?.[m.id]?.[r]?.[c] ?? null))),
      ...inputs.map((f) => s.grid?.[f.key] ?? null), ...(hasList ? [s.rows.length] : []),
    ];
  });
  // 숫자 표가 있으면 마지막에 합계 줄 (숫자 칸만 더함)
  if (mats.length) {
    const start = 1 + hf.length;
    const end = start + mats.reduce((n, m) => n + m.rowLabels.length * m.colLabels.length, 0);
    rows.push(columns.map((_, i) => (i === 0 ? '합계' : i >= start && i < end ? rows.reduce((t, r) => t + (typeof r[i] === 'number' ? (r[i] as number) : 0), 0) : null)));
  }
  return { name: spreadName(schema), columns: columns.map((header) => ({ header })), rows };
}

/** 제출 현황 (submission-status): 지사 목록 전체 + 목록 밖 지사 */
export function statusTable(schema: FormSchema, res: Resolved): Table {
  const errCount = (id: string) => res.valueIssues.filter((i) => i.fileId === id && i.choice === '적혀 있던 값 그대로').length;
  const fixCount = (id: string) => res.valueIssues.filter((i) => i.fileId === id && i.choice !== '적혀 있던 값 그대로').length;
  const rows: CellValue[][] = [];
  // 줄을 받는 양식이 아니면(표형·빈칸채우기형 등) 반영 행 수는 비운다 (0으로 보이면 아무것도 안 들어간 것 같아서)
  const hasRows = schema.blocks.some((b) => b.kind === 'list' || (b.kind === 'grid' && b.spareRows > 0));
  for (const s of res.files) {
    if (s.status === 'unreadable' || s.status === 'other-form' || s.status === 'duplicate-content') {
      rows.push([s.label, '제외', s.fileName, fmtTime(s.savedAt), 0, 0, 0, s.reason ?? STATUS_LABEL[s.status]]);
      continue;
    }
    const fin = res.included.find((x) => x.fileId === s.fileId);
    const count = fin ? fin.rows.length + (fin.gridSpareRows?.length ?? 0) : 0;
    const state = s.status === 'included' ? (fin && !count && schema.blocks.some((b) => b.kind === 'list') ? '해당 없음' : '제출') : s.status === 'duplicate' ? '중복' : '제외';
    rows.push([s.label, state, s.fileName, fmtTime(s.savedAt), hasRows ? count : null, errCount(s.fileId), fixCount(s.fileId), s.status === 'included' ? '포함' : s.reason ?? STATUS_LABEL[s.status]]);
  }
  for (const o of res.missingOrgs) rows.push([o, '미제출', null, null, null, null, null, null]);
  return {
    name: '제출 현황',
    columns: [orgLabel(schema), '상태', '파일명', '저장 시각', '반영 행 수', '오류 수', '수정 수', '처리'].map((header) => ({ header })),
    rows,
  };
}
