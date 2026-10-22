import { useEffect, useState } from 'react';
import { GeneratorRoot } from '@gen/index';
import { AggregatorRoot } from '@agg/index';
import { AiPage } from '../ai/AiPage';
import type { FormSchema } from '@contract/schema';

type Tab = 'ai' | 'aggregator';
const PANEL_KEY = 'hanan-moa:builder-panel';   // 양식 만들기 패널을 켜 두었는지 (새로고침해도 그대로)

export function App() {
  const [tab, setTab] = useState<Tab>('ai');
  const [formId, setFormId] = useState<string>();
  const [panel, setPanel] = useState(() => { try { return localStorage.getItem(PANEL_KEY) === '1'; } catch { return false; } });
  useEffect(() => { try { localStorage.setItem(PANEL_KEY, panel ? '1' : '0'); } catch { /* 저장 못 해도 됨 */ } }, [panel]);
  // AI로 만들기의 [빌더에서 열어 고치기]: 그 양식을 오른쪽 양식 만들기 패널로 연다
  const [incoming, setIncoming] = useState<{ schema: FormSchema; at: number }>();
  // 양식 만들기 완료 화면의 [취합하기로 이동]
  useEffect(() => {
    const on = (e: Event) => {
      const { tab: next, formId: id } = (e as CustomEvent<{ tab: Tab; formId?: string }>).detail;
      setTab(next);
      if (id) setFormId(id);
    };
    const open = (e: Event) => { setIncoming({ schema: (e as CustomEvent<{ schema: FormSchema }>).detail.schema, at: Date.now() }); setTab('ai'); setPanel(true); };
    window.addEventListener('hanan-moa:tab', on);
    window.addEventListener('hanan-moa:open-form', open);
    return () => { window.removeEventListener('hanan-moa:tab', on); window.removeEventListener('hanan-moa:open-form', open); };
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
            양식 만들기
            <span className={'relative h-[18px] w-8 rounded-full transition-colors ' + (panel ? 'bg-pri' : 'bg-line-strong')}>
              <span className={'absolute top-[2px] h-[14px] w-[14px] rounded-full bg-white shadow-sm transition-[left] ' + (panel ? 'left-[16px]' : 'left-[2px]')} />
            </span>
          </button>
        )}
      </header>
      <main className="min-h-0 flex-1">
        {/* AI로 만들기와 양식 만들기 패널은 다른 화면에 다녀와도 이어지도록 늘 켜 두고 숨기기만 한다 */}
        <div className={tab === 'ai' ? 'flex h-full min-h-0' : 'hidden'}>
          <div className="min-w-0 flex-1 overflow-auto"><AiPage /></div>
          <aside aria-label="양식 만들기" className={panel ? 'flex w-[min(62vw,1120px)] shrink-0 flex-col border-l border-line' : 'hidden'}>
            {/* 빌더·첫 화면이 제목·저장·내보내기 버튼을 여기에 띄운다 */}
            <div id="app-header-slot" className="flex min-h-[45px] flex-wrap items-center gap-2 border-b border-line px-3 py-1.5" />
            <div className="min-h-0 flex-1"><GeneratorRoot incoming={incoming} /></div>
          </aside>
        </div>
        {tab === 'aggregator' && <div className="h-full overflow-auto"><AggregatorRoot formId={formId} /></div>}
      </main>
    </div>
  );
}
