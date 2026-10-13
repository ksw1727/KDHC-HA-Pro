import type { FormSchema } from './schema';
import { orgLabel } from './schema';
import { availableAggregations, requiredAggregations, type AggregationId } from './aggregationIds';
import { addr, parseAddr } from './layout/address';

/**
 * 자유 제작형 (01-contract.md 3.2절): 판 위 영역 계산과 취합 가능 검사.
 * 생성 파트(빌더 검사·내보내기)와 취합 파트(같은 틀 시트 규칙)가 함께 쓴다.
 */

export type RegionKind = 'fields' | 'list' | 'matrix';

/** 판 위 입력 영역 하나 (판 좌표, 1부터, 양 끝 포함) */
export interface FreeRegion {
  kind: RegionKind;
  blockId: string;
  key?: string;          // 입력 칸이면 항목 key
  name: string;          // 화면 문구에 쓰는 이름
  r1: number; c1: number; r2: number; c2: number;
}

/** 판 A1이 놓이는 엑셀 행: 제출처 줄이 있으면 6행, 없으면 4행 */
export const freeTop = (s: Pick<FormSchema, 'org'>) => (s.org.mode === 'none' ? 4 : 6);

export function freeRegions(s: FormSchema): FreeRegion[] {
  const places = s.free?.places ?? {};
  const out: FreeRegion[] = [];
  for (const b of s.blocks) {
    if (b.kind === 'fields') {
      for (const f of b.fields) {
        if (!places[f.key]) continue;
        const p = parseAddr(places[f.key]);
        out.push({ kind: 'fields', blockId: b.id, key: f.key, name: f.label.trim() || '이름 없는 입력 칸', r1: p.row, c1: p.col, r2: p.row, c2: p.col });
      }
    } else if (b.kind === 'list' && places[b.id]) {
      const p = parseAddr(places[b.id]);
      out.push({ kind: 'list', blockId: b.id, name: b.title?.trim() || '입력 줄 영역', r1: p.row, c1: p.col, r2: p.row + b.maxRows, c2: p.col + Math.max(1, b.columns.length) - 1 });
    } else if (b.kind === 'matrix' && places[b.id]) {
      const p = parseAddr(places[b.id]);
      const w = b.colLabels.length + (b.totalCol ? 1 : 0) + (b.calcCols?.length ?? 0);
      const h = b.rowLabels.length + (b.totalRow ? 1 : 0) + (b.calcRows?.length ?? 0);
      out.push({ kind: 'matrix', blockId: b.id, name: b.title?.trim() || '숫자 표', r1: p.row, c1: p.col, r2: p.row + h, c2: p.col + w });
    }
  }
  return out;
}

/** 판 크기: 설정값과 영역·글자 칸 중 큰 쪽 */
export function freeSize(s: FormSchema): { rows: number; cols: number } {
  let rows = s.free?.rows ?? 1;
  let cols = s.free?.cols ?? 1;
  for (const r of freeRegions(s)) { rows = Math.max(rows, r.r2); cols = Math.max(cols, r.c2); }
  for (const a of Object.keys(s.free?.texts ?? {})) { const p = parseAddr(a); rows = Math.max(rows, p.row); cols = Math.max(cols, p.col); }
  return { rows, cols };
}

export const inRegion = (g: Pick<FreeRegion, 'r1' | 'c1' | 'r2' | 'c2'>, row: number, col: number) => row >= g.r1 && row <= g.r2 && col >= g.c1 && col <= g.c2;
const overlaps = (a: FreeRegion, b: FreeRegion) => a.r1 <= b.r2 && b.r1 <= a.r2 && a.c1 <= b.c2 && b.c1 <= a.c2;
const rangeOf = (g: FreeRegion) => (g.r1 === g.r2 && g.c1 === g.c2 ? addr(g.c1, g.r1) : `${addr(g.c1, g.r1)}:${addr(g.c2, g.r2)}`);
/** 받침 있으면 을/과/이, 없으면 를/와/가 */
const josa = (w: string, a: string, b: string) => {
  const ch = w.trim().at(-1) ?? '';
  const code = ch.charCodeAt(0) - 0xac00;
  return w + (code >= 0 && code < 11172 && code % 28 !== 0 ? a : b);
};

export interface FreeIssue {
  message: string;
  fix?: string;
  blockId?: string;
  key?: string;
  cell?: string;         // 판 주소 (글자 칸 등)
}

/** 모든 취합 방식에 공통인 문제: 영역 없음, 겹침, 영역 안 글자·합친 칸 */
export function freeProblems(s: FormSchema): FreeIssue[] {
  const regions = freeRegions(s);
  const out: FreeIssue[] = [];
  if (regions.length === 0) out.push({ message: '입력 영역이 없어요.', fix: '칸을 고르고 [입력 칸]·[입력 줄 영역]·[숫자 표] 중 하나로 지정해 주세요.' });
  regions.forEach((a, i) => regions.slice(i + 1).forEach((b) => {
    if (overlaps(a, b)) out.push({ message: `${josa(`'${a.name}'`, '과', '와')} '${b.name}' 영역이 겹쳐요 (${rangeOf(a)} · ${rangeOf(b)}).`, fix: '한쪽 영역을 옮기거나 지정을 풀어 주세요.', blockId: b.blockId, key: b.key });
  }));
  for (const a of Object.keys(s.free?.texts ?? {})) {
    const p = parseAddr(a);
    const g = regions.find((r) => inRegion(r, p.row, p.col));
    if (g) out.push({ message: `'${g.name}' 영역 안 ${a}에 글자 칸이 있어요.`, fix: '글자를 지우거나 영역을 옮겨 주세요.', cell: a, blockId: g.blockId, key: g.key });
  }
  for (const m of s.free?.merges ?? []) {
    const [a, b = a] = m.split(':');
    const p = parseAddr(a);
    const q = parseAddr(b);
    const box = { kind: 'fields' as const, blockId: '', name: '', r1: p.row, c1: p.col, r2: q.row, c2: q.col };
    const g = regions.find((r) => overlaps(r, box));
    if (g) out.push({ message: `${m} 합친 칸이 '${g.name}' 영역에 걸쳐 있어요.`, fix: '입력 영역은 합칠 수 없어요. 합치기를 풀어 주세요.', cell: a, blockId: g.blockId, key: g.key });
  }
  return out;
}

export type CheckStatus = 'ok' | 'fix' | 'no';

export interface AggCheck {
  id: AggregationId;
  status: CheckStatus;   // ok = 가능, fix = 고치면 됨, no = 이 양식으론 안 됨
  why: string;
  fix?: string;
  at?: FreeIssue;
  required: boolean;
}

/** ④ 취합 방식마다 이 모양으로 취합되는지, 안 되면 왜·무엇을 고칠지 (02-generator.md 2.7) */
export function freeAggregationChecks(s: FormSchema): AggCheck[] {
  const regions = freeRegions(s);
  const lists = regions.filter((r) => r.kind === 'list');
  const inputs = regions.filter((r) => r.kind === 'fields');
  const matrices = regions.filter((r) => r.kind === 'matrix');
  const list = lists[0];
  const label = s.org.mode === 'none' ? '파일' : orgLabel(s);
  const req = requiredAggregations(s);
  const names = (rs: FreeRegion[]) => rs.map((r) => r.name).join('·');

  return availableAggregations(s).map((id): AggCheck => {
    const required = req.includes(id);
    switch (id) {
      case 'same-frame': {
        if (lists.length > 1) {
          return { id, required, status: 'fix', why: `입력 줄 영역이 ${lists.length}개예요. 취합본 한 장에 줄을 이어 붙일 곳은 하나여야 해요.`, fix: '하나만 남기고 나머지는 지정을 풀거나 숫자 표로 바꾸세요.', at: { message: '', blockId: lists[1].blockId } };
        }
        if (list) {
          // 줄이 늘어나면 아래 칸을, 자동 칸이 붙으면 오른쪽 칸을 덮어쓴다
          const blocked = (row: number, col: number) => row > list.r2 || (row >= list.r1 && col > list.c2);
          const other = regions.find((r) => r !== list && blocked(r.r1, r.c1));
          const text = Object.keys(s.free?.texts ?? {}).find((a) => { const p = parseAddr(a); return blocked(p.row, p.col); });
          if (other || text) {
            const what = other ? `${rangeOf(other)} '${other.name}'` : `${text} 글자 칸`;
            const below = other ? other.r1 > list.r2 : parseAddr(text!).row > list.r2;
            return {
              id, required, status: 'fix',
              why: `취합하면 '${list.name}' ${below ? `줄이 제출 수만큼 늘어나 아래 ${josa(what, '을', '를')}` : `오른쪽에 ${label}·출처 칸이 붙어 ${josa(what, '을', '를')}`} 덮어써요.`,
              fix: `${josa(other ? `'${other.name}'` : `${text} 글자 칸`, '을', '를')} 줄 영역 위로 옮기세요. 줄 영역의 아래와 오른쪽은 비워 둬야 해요.`,
              at: other ? { message: '', blockId: other.blockId, key: other.key } : { message: '', cell: text },
            };
          }
          const parts = [`'${list.name}' 줄이 한 표로 이어지고`];
          parts.push(inputs.length ? `입력 칸(${names(inputs)})과 ${josa(label, '이', '가')} 줄마다 오른쪽에 붙어요.` : `오른쪽에 ${label} 칸이 붙어요.`);
          if (matrices.length) parts.push('숫자 표는 칸끼리 더해요.');
          return { id, required, status: 'ok', why: parts.join(' ') };
        }
        if (!inputs.length && !matrices.length) return { id, required, status: 'fix', why: '입력 영역이 없어 모을 값이 없어요.', fix: '입력 칸·입력 줄 영역·숫자 표 중 하나를 지정해 주세요.' };
        return {
          id, required, status: 'ok',
          why: [matrices.length ? '숫자 표는 칸끼리 더하고' : '', inputs.length ? `입력 칸 자리에는 "(${label}별 시트 참고)"가 들어가요. 값은 ${label}별 펼치기 시트에 모여요.` : '같은 모양 한 장으로 모여요.'].filter(Boolean).join(', '),
        };
      }
      case 'spread': {
        if (!inputs.length && !matrices.length) return { id, required, status: 'no', why: '입력 줄 영역만 있어 옆으로 펼칠 값이 없어요.', fix: '이 방식은 빼세요. 줄은 같은 틀 시트에 한 표로 모여요.' };
        const what = [inputs.length ? `입력 칸(${names(inputs)})` : '', matrices.length ? '숫자 표 칸' : '', list ? `'${list.name}' 줄 수` : ''].filter(Boolean).join(', ');
        return { id, required, status: 'ok', why: `${label}마다 한 줄에 ${what}을 나란히 모아요.${required ? ' 입력 칸 값이 모이는 곳이라 꼭 넣어요.' : ''}` };
      }
      case 'collect-sheets':
        return { id, required, status: 'ok', why: `어떤 모양이든 ${label}별 시트로 그대로 모아요.` };
      case 'submission-status':
        return { id, required, status: 'ok', why: `${label}명 칸으로 누가 냈는지 셉니다.` };
    }
  });
}
