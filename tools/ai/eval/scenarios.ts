/**
 * AI로 만들기 비교 시험 시나리오. 대화(turns)를 보내고, 마지막 form.json·답을 채점 항목으로 본다.
 * 채점은 모두 기계로 한다 (사람 판단 없음) — 항목 이름·종류·제출처·계산·"만들 수 없음" 첫 줄.
 */
import type { Block, Field, FormSchema } from '@contract/schema';

export interface Turn { message: string; files?: string[] }   // files: 프로그램 폴더 기준 경로
export interface Check { name: string; pass: boolean }
export interface Scenario {
  id: string;
  title: string;
  layout: string;
  turns: Turn[];
  grade: (form: FormSchema | undefined, answer: string, firstForm?: FormSchema) => Check[];
}

/** 양식 안의 모든 칸 (블록 종류 상관없이) */
export function fieldsOf(s?: FormSchema): Field[] {
  if (!s) return [];
  return s.blocks.flatMap((b: Block) => {
    if (b.kind === 'list') return b.columns;
    if (b.kind === 'fields') return b.fields;
    if (b.kind === 'matrix') return [b.cell, ...(b.calcRows ?? []), ...(b.calcCols ?? [])];
    if (b.kind === 'grid') return b.rows.flat().flatMap((c) => (c.kind === 'input' || c.kind === 'calc' ? [c.field] : []));
    return [];
  });
}
const find = (s: FormSchema | undefined, name: string) => fieldsOf(s).find((f) => f.label.replace(/\s|\*/g, '').includes(name));
const has = (s: FormSchema | undefined, name: string, type?: string) => { const f = find(s, name); return !!f && (!type || f.type === type); };
const c = (name: string, pass: boolean): Check => ({ name, pass });
const sameSet = (a: string[] = [], b: string[]) => a.length === b.length && b.every((x) => a.includes(x));
const PLACEHOLDER = /^(1행|2행|1열|2열|항목 ?\d|값|입력|내용)$/;
const noPlaceholder = (s?: FormSchema) => !fieldsOf(s).some((f) => PLACEHOLDER.test(f.label))
  && !(s?.blocks ?? []).some((b) => (b.kind === 'matrix' && [...b.rowLabels, ...b.colLabels].some((l) => PLACEHOLDER.test(l)))
    || (b.kind === 'grid' && (b.colLabels.some((l) => PLACEHOLDER.test(l)) || b.rows.some((r) => r[0]?.kind === 'fixed' && PLACEHOLDER.test(String(r[0].value))))));
const CANNOT = '이 양식은 한난MOA로 다시 만들 수 없어요.';

export const SCENARIOS: Scenario[] = [
  {
    id: 'S1', title: '목록형 + 이어서 고치기', layout: 'list',
    turns: [
      { message: '지사별 동절기 안전교육 이수자 명단을 받고 싶어요. 이름, 직급(1급~4급 중 선택), 이수일, 휴대폰. 받을 곳은 중앙지사·강남지사·대구지사.' },
      { message: '휴대폰은 빼고, 비고(긴 글)를 추가해 주세요.' },
    ],
    grade: (f, _a, first) => [
      c('구조: 목록형', f?.layout === 'list'),
      c('이름 칸', has(f, '이름')),
      c('직급: 1~4급 고르기', find(f, '직급')?.type === 'select' && sameSet(find(f, '직급')?.options, ['1급', '2급', '3급', '4급'])),
      c('이수일: 날짜', has(f, '이수일', 'date')),
      c('1차: 휴대폰 형식 칸', find(first, '휴대폰')?.type === 'pattern' && find(first, '휴대폰')?.pattern === 'mobile'),
      c('2차: 휴대폰 뺌', !find(f, '휴대폰')),
      c('2차: 비고 긴 글', has(f, '비고', 'memo')),
      c('2차: 처음부터 다시 만들지 않음(key 유지)', !!first && find(first, '이름')?.key === find(f, '이름')?.key),
      c('제출처: 3개 지사 정확히', f?.org.mode === 'preset' && sameSet(f.org.orgs, ['중앙지사', '강남지사', '대구지사'])),
      c('자리표시 항목 없음', noPlaceholder(f)),
    ],
  },
  {
    id: 'S2', title: '혼합형 + 계산 + 부서 직접 입력', layout: 'header-list',
    turns: [{ message: '위에 담당자·연락처를 받고, 아래에 안전보호구 지급 내역(품목·수량·단가·금액)을 받는 양식이요. 금액은 수량×단가로 자동 계산해 주세요. 제출처는 부서이고, 부서 이름은 작성자가 직접 적게 해 주세요.' }],
    grade: (f) => [
      c('구조: 혼합형', f?.layout === 'header-list'),
      c('담당자 칸', has(f, '담당자')),
      c('연락처 칸', has(f, '연락처')),
      c('품목 칸', has(f, '품목')),
      c('수량: 숫자', has(f, '수량', 'number')),
      c('단가: 숫자', has(f, '단가', 'number')),
      c('금액: 수량×단가 계산', find(f, '금액')?.type === 'calc' && /수량/.test(find(f, '금액')?.formula ?? '') && /단가/.test(find(f, '금액')?.formula ?? '')),
      c('제출처: 직접 적기', f?.org.mode === 'input'),
      c('제출처 이름: 부서', f?.org.label === '부서'),
      c('자리표시 항목 없음', noPlaceholder(f)),
    ],
  },
  {
    id: 'S3', title: '표형 숫자 표', layout: 'matrix',
    turns: [{ message: '협력기관에서 분기별(1~4분기) 에너지 절감량을 전기·가스·열 항목별 숫자 표로 받고 싶어요. 합계도 보여 주세요. 단위는 MWh. 기관 이름은 작성자가 적게 해 주세요.' }],
    grade: (f) => {
      const m = f?.blocks.find((b) => b.kind === 'matrix');
      const labels = m?.kind === 'matrix' ? [...m.rowLabels, ...m.colLabels].map((l) => l.replace(/\s/g, '')) : [];
      return [
        c('구조: 표형', f?.layout === 'matrix'),
        c('항목: 전기·가스·열', ['전기', '가스', '열'].every((x) => labels.some((l) => l === x || l.startsWith(x)))),
        c('분기: 1~4분기', ['1분기', '2분기', '3분기', '4분기'].every((x) => labels.includes(x))),
        c('칸: 숫자, 단위 MWh', m?.kind === 'matrix' && m.cell.type === 'number' && /mwh/i.test(m.cell.unit ?? '')),
        c('합계 있음', m?.kind === 'matrix' && (m.totalRow || m.totalCol)),
        c('제출처: 직접 적기', f?.org.mode === 'input'),
        c('제출처 이름: 기관', f?.org.label === '기관'),
        c('자리표시 항목 없음', noPlaceholder(f)),
      ];
    },
  },
  {
    id: 'S4', title: '빈칸채우기형 지사별 열', layout: 'fill-in',
    turns: [{ message: '2027 사업예산 요구표를 만들어 주세요. 사업은 시설보수·안전점검·교육훈련 세 가지이고, 중앙지사·강남지사가 각자 자기 열에 요구액(천원)을 적게 해 주세요.' }],
    grade: (f) => {
      const g = f?.blocks.find((b) => b.kind === 'grid');
      const rows = g?.kind === 'grid' ? g.rows : [];
      const inputs = rows.flat().filter((x) => x.kind === 'input');
      const text = JSON.stringify(rows);
      return [
        c('구조: 빈칸채우기형', f?.layout === 'fill-in'),
        c('사업 3가지 행', ['시설보수', '안전점검', '교육훈련'].every((x) => text.includes(x))),
        c('지사 열 2개', g?.kind === 'grid' && ['중앙지사', '강남지사'].every((x) => g.colLabels.includes(x))),
        c('입력 칸 6개 (3사업×2지사)', inputs.length === 6),
        c('요구액: 숫자, 천원', inputs.length > 0 && inputs.every((x) => x.kind === 'input' && x.field.type === 'number' && x.field.unit === '천원')),
        c('제출처: 2개 지사 정확히', f?.org.mode === 'preset' && sameSet(f.org.orgs, ['중앙지사', '강남지사'])),
        c('자리표시 항목 없음', noPlaceholder(f)),
      ];
    },
  },
  {
    id: 'S5', title: '쓰던 엑셀 그대로 만들기', layout: 'header-list',
    turns: [{ message: '이 엑셀 양식 그대로 만들어 주세요.', files: ['samples/혼합형_교육참가자조사_서울.xlsx'] }],
    grade: (f) => [
      c('구조: 혼합형', f?.layout === 'header-list'),
      c('제목 그대로', f?.title === '2026 하반기 교육 참가자 조사'),
      c('담당자 필수', find(f, '담당자')?.required === true),
      c('연락처 칸', has(f, '연락처')),
      c('이름 필수', find(f, '이름')?.required === true && !/\*/.test(find(f, '이름')?.label ?? '*')),
      c('교육비: 숫자', has(f, '교육비', 'number')),
      c('인원: 숫자', has(f, '인원', 'number')),
      c('합계: 인원×교육비 계산', find(f, '합계')?.type === 'calc' && /인원/.test(find(f, '합계')?.formula ?? '') && /교육비/.test(find(f, '합계')?.formula ?? '')),
      c('번호 칸을 항목으로 만들지 않음', !find(f, '번호')),
      c('항목 순서 그대로 (이름→교육비→인원→합계)', ['이름', '교육비', '인원', '합계'].map((x) => fieldsOf(f).findIndex((y) => y.label.includes(x))).every((v, i, a) => v >= 0 && (i === 0 || v > a[i - 1]))),
    ],
  },
  {
    id: 'S6', title: '만들 수 없음 (매크로 양식)', layout: '없음',
    turns: [{ message: '지사에서 쓰던 이 엑셀을 그대로 받고 싶어요.', files: ['tools/ai/eval/fixtures/매크로_집계양식.xlsm'] }],
    grade: (f, a) => [
      c('첫 줄 정확히 "만들 수 없어요"', a.trim().split('\n')[0].trim() === CANNOT),
      c('양식을 만들지 않음', !f),
      c('이유에 매크로를 말함', /매크로/.test(a)),
      c('바꾸는 방법을 알려 줌', /(바꾸|빼|대신|없애|하면|제거|저장해|다시 올려)/.test(a)),
    ],
  },
];
