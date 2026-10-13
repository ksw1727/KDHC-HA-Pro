import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type { Layout } from '@contract/schema';

/**
 * 구조별 3컷 이야기: ① 배포 양식 → ② 지사 3곳이 작성 → ③ 취합본 (02-generator.md 2.1).
 * 동영상이 아니라 작은 표가 0.5초 간격으로 나타난다. 동작 줄이기 설정이면 멈춘 채 다 보여준다.
 */
const MAX = 16;
const Phase = createContext(MAX);

function At({ n, children, cell }: { n: number; children: ReactNode; cell?: boolean }) {
  const p = useContext(Phase);
  const on = p >= n;
  if (cell) return <span style={{ color: on ? undefined : 'transparent', transition: 'color .3s' }}>{children}</span>;
  return <div style={{ opacity: on ? 1 : 0, transform: on ? 'none' : 'translateY(4px)', transition: 'opacity .35s, transform .35s' }}>{children}</div>;
}

type C = string | number | null | { v: string | number | null; k?: 'h' | 'rq' | 'au' | 'auh' | 'sum' | 'free'; at?: number };
const Tbl = ({ rows }: { rows: C[][] }) => (
  <table className="w-full border-collapse text-[10.5px]" style={{ tableLayout: 'fixed' }}>
    <tbody>
      {rows.map((r, i) => (
        <tr key={i}>
          {r.map((c, j) => {
            const o = c !== null && typeof c === 'object' ? c : { v: c };
            const bg = o.k === 'h' ? '#eef2f7' : o.k === 'rq' ? '#fff5d1' : o.k === 'au' ? '#e5f4ee' : o.k === 'auh' ? '#cfeadf' : o.k === 'sum' ? '#e8f0fc' : o.k === 'free' ? '#f6f9fe' : undefined;
            const color = o.k === 'au' || o.k === 'auh' ? '#0f6e56' : o.k === 'sum' ? '#174a96' : undefined;
            return (
              <td key={j} className="h-[18px] overflow-hidden text-ellipsis whitespace-nowrap border border-[#d9dfe7] px-1" style={{ background: bg, color, fontWeight: o.k === 'h' || o.k === 'auh' || o.k === 'sum' ? 600 : undefined }}>
                {o.at ? <At n={o.at} cell>{o.v}</At> : o.v}
              </td>
            );
          })}
        </tr>
      ))}
    </tbody>
  </table>
);
const h = (v: string): C => ({ v, k: 'h' });
const rq = (v: string | number | null = null, at?: number): C => ({ v, k: 'rq', at });
const au = (v: string, at?: number): C => ({ v, k: 'au', at });
const auh = (v: string): C => ({ v, k: 'auh' });
const sum = (v: string, at?: number): C => ({ v, k: 'sum', at });
const t = (v: string | number, at: number): C => ({ v, at });

const File = ({ name, children }: { name: string; children: ReactNode }) => (
  <div className="min-w-0 flex-1 rounded border border-line bg-[#fbfcfd] p-1"><div className="mb-0.5 text-[10px] font-bold text-sub">{name}</div>{children}</div>
);

interface Story { p1: ReactNode; p2: ReactNode; p3: ReactNode; result: ReactNode }

export const STORIES: Record<Layout, Story> = {
  list: {
    p1: <Tbl rows={[[h('이름 *'), h('직급'), h('참가일')], [rq(), null, null], [rq(), null, null], [rq(), null, null]]} />,
    p2: <div className="flex gap-1">
      <File name="서울.xlsx"><Tbl rows={[[h('이름'), h('직급')], [t('김민수', 3), t('대리', 3)], [t('이서연', 3), t('과장', 3)]]} /></File>
      <File name="부산.xlsx"><Tbl rows={[[h('이름'), h('직급')], [t('박지훈', 4), t('사원', 4)]]} /></File>
      <File name="대구.xlsx"><Tbl rows={[[h('이름'), h('직급')], [t('최유진', 5), t('차장', 5)]]} /></File>
    </div>,
    p3: <Tbl rows={[[h('이름'), h('직급'), auh('지사')], [t('김민수', 8), t('대리', 8), au('서울', 8)], [t('이서연', 9), t('과장', 9), au('서울', 9)], [t('박지훈', 10), t('사원', 10), au('부산', 10)], [t('최유진', 11), t('차장', 11), au('대구', 11)]]} />,
    result: <>모든 지사의 줄이 <b>한 표로 이어지고</b>, 오른쪽에 <b>지사</b> 칸이 자동으로 붙어요.</>,
  },
  matrix: {
    p1: <Tbl rows={[[h(''), h('남'), h('여')], [h('1학년'), rq(), rq()], [h('2학년'), rq(), rq()]]} />,
    p2: <div className="flex gap-1">
      <File name="서울.xlsx"><Tbl rows={[[h(''), h('남'), h('여')], [h('1학년'), t(12, 3), t(10, 3)]]} /></File>
      <File name="부산.xlsx"><Tbl rows={[[h(''), h('남'), h('여')], [h('1학년'), t(20, 4), t(18, 4)]]} /></File>
      <File name="대구.xlsx"><Tbl rows={[[h(''), h('남'), h('여')], [h('1학년'), t(13, 5), t(13, 5)]]} /></File>
    </div>,
    p3: <Tbl rows={[[h('전체'), h('남'), h('여')], [h('1학년'), sum('Σ 45', 8), sum('Σ 41', 8)], [h('2학년'), sum('Σ 38', 9), sum('Σ 40', 9)]]} />,
    result: <>같은 칸끼리 더한 <b>합계표</b>가 되고, 지사별 시트도 함께 들어가요.</>,
  },
  'header-list': {
    p1: <><Tbl rows={[[h('담당자 *'), rq()]]} /><div className="h-1" /><Tbl rows={[[h('이름 *'), h('직급')], [rq(), null], [rq(), null]]} /></>,
    p2: <div className="flex gap-1">
      <File name="서울.xlsx"><Tbl rows={[[h('담당자'), t('홍길동', 3)], [t('김민수', 3), t('대리', 3)]]} /></File>
      <File name="부산.xlsx"><Tbl rows={[[h('담당자'), t('정다은', 4)], [t('박지훈', 4), t('사원', 4)]]} /></File>
      <File name="대구.xlsx"><Tbl rows={[[h('담당자'), t('윤성호', 5)], [t('최유진', 5), t('차장', 5)]]} /></File>
    </div>,
    p3: <Tbl rows={[[h('이름'), h('직급'), auh('지사'), auh('담당자')], [t('김민수', 8), t('대리', 8), au('서울', 8), au('홍길동', 8)], [t('박지훈', 9), t('사원', 9), au('부산', 9), au('정다은', 9)], [t('최유진', 10), t('차장', 10), au('대구', 10), au('윤성호', 10)]]} />,
    result: <>명단이 한 표로 이어지고, 위쪽 정보(<b>담당자</b>)와 <b>지사</b>가 줄마다 오른쪽에 붙어요.</>,
  },
  'fill-in': {
    p1: <Tbl rows={[[h('사업'), h('예산'), h('서울'), h('부산')], ['교육', 900, rq(), rq()], ['홍보', 600, rq(), rq()]]} />,
    p2: <div className="flex gap-1">
      <File name="서울.xlsx"><Tbl rows={[[h('사업'), h('서'), h('부')], ['교육', t(300, 3), null], ['홍보', t(200, 3), null]]} /></File>
      <File name="부산.xlsx"><Tbl rows={[[h('사업'), h('서'), h('부')], ['교육', null, t(350, 4)], ['홍보', null, t(250, 4)]]} /></File>
    </div>,
    p3: <Tbl rows={[[h('사업'), h('예산'), h('서울'), h('부산')], ['교육', 900, au('300', 8), au('350', 9)], ['홍보', 600, au('200', 8), au('250', 9)]]} />,
    result: <>지사마다 채운 빈칸이 <b>하나의 완성된 표로 겹쳐져요</b>. 같은 칸에 다른 값이 오면 확인을 요청해요.</>,
  },
  collect: {
    p1: <Tbl rows={[[h('10월 안전점검 보고'), null], [h('지사명'), '서울'], [{ v: '여기부터 자유롭게', k: 'free' }, { v: '', k: 'free' }]]} />,
    p2: <div className="flex gap-1">
      <File name="서울.xlsx"><Tbl rows={[[h('항목'), h('결과')], [t('소화기', 3), t('양호', 3)]]} /></File>
      <File name="부산.xlsx"><Tbl rows={[[h('총평')], [t('표지 교체 필요', 4)]]} /></File>
      <File name="대구.xlsx"><Tbl rows={[[h('항목'), h('사진')], [t('소화기', 5), t('별첨', 5)]]} /></File>
    </div>,
    p3: <><At n={8}><Tbl rows={[[h('지사'), h('상태'), h('바로가기')], ['서울', '제출', { v: '서울 →', k: 'sum' }], ['부산', '제출', { v: '부산 →', k: 'sum' }]]} /></At>
      <div className="mt-0.5 flex gap-0.5 text-[10px]">
        {['목차', '서울', '부산', '대구'].map((n, i) => <At key={n} n={8 + i}><span className={'rounded-b border border-t-0 border-[#d9dfe7] px-1.5 ' + (i === 0 ? 'bg-pri-bg font-bold text-pri-ink' : 'bg-[#f6f7f9] text-sub')}>{n}</span></At>)}
      </div></>,
    result: <>맨 앞 <b>목차</b>와 <b>지사별 시트</b>로 모여요. 칸 검사 없이 각자 쓴 모양 그대로 옮겨요.</>,
  },
};

function useReducedMotion() {
  const [r] = useState(() => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches);
  return r;
}

/** 3컷 이야기. size='sm'은 작은 미리보기(설명 줄 없음) */
export function StructureStory({ layout, size = 'md', paused = false }: { layout: Layout; size?: 'sm' | 'md'; paused?: boolean }) {
  const reduce = useReducedMotion();
  const [p, setP] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(true);
  useEffect(() => setP(0), [layout]);
  useEffect(() => {
    if (typeof IntersectionObserver !== 'function' || !ref.current) return;
    const io = new IntersectionObserver(([e]) => setVisible(e.isIntersecting));
    io.observe(ref.current);
    return () => io.disconnect();
  }, []);
  useEffect(() => {
    if (reduce || paused || !visible) return;
    const id = setInterval(() => setP((x) => (x >= MAX ? 0 : x + 1)), 500);
    return () => clearInterval(id);
  }, [reduce, paused, visible]);
  const phase = reduce ? MAX : p;
  const cur = phase < 3 ? 1 : phase < 7 ? 2 : 3;
  const s = STORIES[layout];
  const pane = (n: number, title: string, body: ReactNode) => (
    <div className={'min-w-0 rounded-box border bg-white p-1.5 transition-shadow ' + (!reduce && cur === n && phase <= 12 ? 'border-pri-line shadow-[0_0_0_3px_#e8f0fc]' : 'border-line')}>
      <div className="mb-1 text-[10px] font-bold text-muted">{title}</div>{body}
    </div>
  );
  return (
    <div ref={ref} aria-label="구조 미리보기 애니메이션">
      <Phase.Provider value={phase}>
        <div className="grid items-center gap-1" style={{ gridTemplateColumns: '1fr 14px 1.3fr 14px 1.15fr' }}>
          {pane(1, '① 배포 양식', <At n={1}>{s.p1}</At>)}
          <span className={'text-center ' + (phase >= 2 ? 'text-pri' : 'text-line-strong')}>→</span>
          {pane(2, size === 'sm' ? '② 지사 작성' : '② 지사 3곳이 작성', s.p2)}
          <span className={'text-center ' + (phase >= 7 ? 'text-pri' : 'text-line-strong')}>→</span>
          {pane(3, '③ 취합본', s.p3)}
        </div>
      </Phase.Provider>
      {size === 'md' && <div className="mt-1.5 rounded-box border border-line bg-white px-2.5 py-1.5 text-xs text-sub">{s.result}</div>}
    </div>
  );
}
