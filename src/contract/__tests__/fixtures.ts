import type { Field, FormSchema } from '../schema';

export const f = (key: string, label: string, extra: Partial<Field> = {}): Field => ({
  key, label, type: 'text', required: false, ...extra,
});

const base = {
  contractVersion: 1 as const,
  formId: '00000000-0000-4000-8000-000000000001',
  formVersion: 1,
  title: '2026 하반기 교육 참가자 조사',
  guide: '11월 5일까지 회신',
  deadline: '2026-10-20',
  contact: '인사팀 02-000-0000',
  createdAt: '2026-10-13T00:00:00.000Z',
  updatedAt: '2026-10-13T00:00:00.000Z',
};

export const SAMPLE: Record<FormSchema['layout'], FormSchema> = {
  list: {
    ...base, layout: 'list',
    blocks: [{ kind: 'list', id: 'b1', maxRows: 100, columns: [f('name', '이름', { required: true }), f('rank', '직급', { type: 'select', options: ['사원', '대리'] })] }],
    aggregations: ['same-frame', 'submission-status'],
    org: { mode: 'preset', orgs: ['서울', '부산', '대구'] },
  },
  'header-list': {
    ...base, layout: 'header-list',
    blocks: [
      { kind: 'fields', id: 'b1', fields: [f('manager', '담당자', { required: true }), f('phone', '연락처', { type: 'pattern', pattern: 'mobile' })] },
      { kind: 'list', id: 'b2', maxRows: 100, columns: [f('name', '이름', { required: true }), f('fee', '교육비', { type: 'number', thousands: true, unit: '원', min: 0, max: 1000000 })] },
    ],
    aggregations: ['same-frame', 'submission-status'],
    org: { mode: 'preset', orgs: ['서울', '부산', '대구'] },
  },
  matrix: {
    ...base, layout: 'matrix',
    blocks: [{ kind: 'matrix', id: 'b1', rowLabels: ['1학년', '2학년'], colLabels: ['남', '여'], cell: f('cnt', '인원', { type: 'number' }), totalRow: true, totalCol: true }],
    aggregations: ['same-frame', 'spread'],
    org: { mode: 'input' },
  },
  'fill-in': {
    ...base, layout: 'fill-in',
    blocks: [{
      kind: 'grid', id: 'b1', colLabels: ['사업', '예산', '서울'], spareRows: 0,
      rows: [
        [{ kind: 'fixed', value: '교육' }, { kind: 'fixed', value: 900 }, { kind: 'input', field: f('g1', '교육 · 서울', { type: 'number' }) }],
        [{ kind: 'fixed', value: '홍보' }, { kind: 'blank' }, { kind: 'input', field: f('g2', '홍보 · 서울', { type: 'number' }) }],
      ],
    }],
    aggregations: ['same-frame'],
    org: { mode: 'none' },
  },
  collect: {
    ...base, layout: 'collect', title: '10월 안전점검 결과 보고',
    blocks: [], collect: { scope: 'report' },
    aggregations: ['collect-sheets', 'submission-status'],
    org: { mode: 'preset', orgs: ['서울', '부산'] },
  },
  free: {
    ...base, layout: 'free', title: '10월 안전점검 결과',
    // 판: 1행 점검자·점검일 입력 칸, 3행 숫자 표(불량 현황), 6행 입력 줄 영역(점검 내역)
    blocks: [
      { kind: 'fields', id: 'b1', fields: [f('insp', '점검자', { required: true }), f('day', '점검일', { type: 'date' })] },
      { kind: 'matrix', id: 'b2', title: '불량 현황', rowLabels: ['불량 수'], colLabels: ['소화기', '비상등'], cell: f('bad', '불량', { type: 'number' }), totalRow: false, totalCol: true },
      { kind: 'list', id: 'b3', title: '점검 내역', maxRows: 5, columns: [f('item', '항목', { required: true }), f('res', '결과', { type: 'select', options: ['양호', '불량'] }), f('cost', '조치 금액', { type: 'number', unit: '원' })] },
    ],
    free: {
      rows: 11, cols: 4,
      texts: { A1: '점검자', C1: '점검일' },
      merges: [],
      places: { insp: 'B1', day: 'D1', b2: 'A3', b3: 'A6' },
    },
    aggregations: ['same-frame', 'submission-status'],
    org: { mode: 'preset', orgs: ['서울', '부산'] },
  },
};
