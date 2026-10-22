import { CloudGate } from '../cloud';
import { useEffect, useLayoutEffect, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { FormPanel, type Incoming } from '@gen/FormPanel';
import { AggregatorRoot } from '@agg/index';
import { AiPage } from '../ai/AiPage';
import { AdminPage, probeAdmin } from '../admin/AdminPage';
import type { FormSchema } from '@contract/schema';

type Tab = 'ai' | 'aggregator' | 'admin';
const PANEL_KEY = 'hanan-moa:builder-panel';   // 양식 설정 패널을 켜 두었는지 (새로고침해도 그대로)
const WIDTH_KEY = 'hanan-moa:settings-panel-width';
/** 패널은 340px 이상, AI 대화는 480px 이상 남긴다 */
const clampWidth = (w: number) => Math.round(Math.max(340, Math.min(w, window.innerWidth - 480)));

export function App() {
  return <CloudGate><Workspace /></CloudGate>;
}

function Workspace() {
  const [tab, setTab] = useState<Tab>('ai');
  // 관리자에게만 관리자 탭을 보인다 (권한은 서버가 매 요청 다시 확인)
  const [admin, setAdmin] = useState(false);
  useEffect(() => { let alive = true; void probeAdmin().then((ok) => { if (alive) setAdmin(ok); }); return () => { alive = false; }; }, []);
  const [formId, setFormId] = useState<string>();
  const [panel, setPanel] = useState(() => { try { return localStorage.getItem(PANEL_KEY) !== '0'; } catch { return true; } });
  useEffect(() => { try { localStorage.setItem(PANEL_KEY, panel ? '1' : '0'); } catch { /* 저장 못 해도 됨 */ } }, [panel]);
  // 패널 너비: 왼쪽 경계를 끌어서 바꾼다 (null이면 기본 너비)
  const [width, setWidth] = useState<number | null>(() => { try { return Number(localStorage.getItem(WIDTH_KEY)) || null; } catch { return null; } });
  useEffect(() => { try { if (width) localStorage.setItem(WIDTH_KEY, String(width)); else localStorage.removeItem(WIDTH_KEY); } catch { /* 저장 못 해도 됨 */ } }, [width]);
  const drag = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => setWidth(clampWidth(window.innerWidth - ev.clientX));
    const up = () => { el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); document.body.style.cursor = ''; document.body.style.userSelect = ''; };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  };
  // AI로 만들기의 양식 카드 → 오른쪽 설정 패널. auto: AI가 새로 만든 양식(패널을 억지로 열지 않음)
  const [incoming, setIncoming] = useState<Incoming>();
  // 양식 만들기 완료 화면의 [취합하기로 이동]
  // AiPage가 처음 그릴 때 보내는 이벤트도 받아야 해서 자식 effect보다 먼저 듣는다
  useLayoutEffect(() => {
    const on = (e: Event) => {
      const { tab: next, formId: id } = (e as CustomEvent<{ tab: Tab; formId?: string }>).detail;
      setTab(next);
      if (id) setFormId(id);
    };
    const open = (e: Event) => {
      const d = (e as CustomEvent<{ schema: FormSchema; auto?: boolean; preferStored?: boolean }>).detail;
      setIncoming({ schema: d.schema, preferStored: d.preferStored, at: Date.now() });
      if (!d.auto) { setTab('ai'); setPanel(true); }
    };
    const pick = () => setPanel(true);
    window.addEventListener('hanan-moa:tab', on);
    window.addEventListener('hanan-moa:open-form', open);
    window.addEventListener('hanan-moa:select-field', pick);
    return () => { window.removeEventListener('hanan-moa:tab', on); window.removeEventListener('hanan-moa:open-form', open); window.removeEventListener('hanan-moa:select-field', pick); };
  }, []);
  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-4 overflow-x-auto whitespace-nowrap border-b border-line px-4 py-2.5">
        <span className="shrink-0 text-[15px] font-extrabold tracking-tight text-pri">
          한난<span className="text-ink">MOA</span>
        </span>
        <nav className="flex shrink-0 gap-0.5 rounded-box bg-chip p-[3px]" aria-label="주요 화면">
          {(
            [
              ['ai', 'AI로 만들기'],
              ['aggregator', '취합하기'],
              ...(admin ? [['admin', '관리자']] as const : []),
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              aria-current={tab === id ? 'page' : undefined}
              className={
                'rounded-[6px] px-3 py-1 ' +
                (tab === id ? 'bg-white font-semibold text-ink shadow-sm' : 'text-sub')
              }
            >
              {label}
            </button>
          ))}
        </nav>
        <span className="flex-1" />
        {tab === 'ai' && (
          <button type="button" role="switch" aria-checked={panel} onClick={() => setPanel((v) => !v)}
            className="flex shrink-0 items-center gap-2 rounded-btn px-2 py-1 text-[13px] text-sub hover:bg-chip">
            양식 설정 패널
            <span className={'relative h-[18px] w-8 rounded-full transition-colors ' + (panel ? 'bg-pri' : 'bg-line-strong')}>
              <span className={'absolute top-[2px] h-[14px] w-[14px] rounded-full bg-white shadow-sm transition-[left] ' + (panel ? 'left-[16px]' : 'left-[2px]')} />
            </span>
          </button>
        )}
      </header>
      <main className="min-h-0 flex-1">
        {/* AI로 만들기와 설정 패널은 다른 화면에 다녀와도 이어지도록 늘 켜 두고 숨기기만 한다 */}
        <div className={tab === 'ai' ? 'flex h-full min-h-0' : 'hidden'}>
          <div className="min-w-0 flex-1 overflow-auto"><AiPage panelOpen={panel} /></div>
          {/* 대화가 주인공(약 80%), 패널은 ①~⑤ 설정만. 미리보기는 대화의 양식 카드 */}
          <aside aria-label="양식 설정 패널" style={width ? { width: clampWidth(width) } : undefined}
            className={panel ? 'relative flex w-[clamp(360px,22vw,520px)] shrink-0 flex-col border-l border-line' : 'hidden'}>
            {/* 왼쪽 경계를 끌면 너비가 바뀌고, 두 번 누르면 기본 너비로 */}
            <div role="separator" aria-orientation="vertical" aria-label="패널 너비 조절" title="끌어서 너비 조절 · 두 번 누르면 기본 너비"
              onPointerDown={drag} onDoubleClick={() => setWidth(null)}
              className="absolute -left-[3px] top-0 z-10 h-full w-[6px] cursor-col-resize hover:bg-pri/30 active:bg-pri/40" />
            <div className="min-h-0 flex-1"><FormPanel incoming={incoming} /></div>
          </aside>
        </div>
        {tab === 'aggregator' && <div className="h-full overflow-auto"><AggregatorRoot formId={formId} /></div>}
        {tab === 'admin' && admin && <div className="h-full overflow-auto"><AdminPage /></div>}
      </main>
    </div>
  );
}
