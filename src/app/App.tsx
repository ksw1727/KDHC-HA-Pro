import { CloudGate, cloudEnabled } from '../cloud';
import { useEffect, useState } from 'react';
import { GeneratorRoot } from '@gen/index';
import { AggregatorRoot } from '@agg/index';
import { AiPage } from '../ai/AiPage';
import { AdminPage, probeAdmin } from '../admin/AdminPage';
import { AccountPage } from '../account/AccountPage';
import { WorkspacePage } from '../workspace/WorkspacePage';
import type { FormSchema } from '@contract/schema';

type Tab = 'home' | 'ai' | 'generator' | 'aggregator' | 'account' | 'admin';

export function App() {
  return <CloudGate><Workspace /></CloudGate>;
}

function Workspace() {
  const [tab, setTab] = useState<Tab>('home');
  // 관리자에게만 관리자 탭을 보인다 (권한은 서버가 매 요청 다시 확인)
  const [admin, setAdmin] = useState(false);
  useEffect(() => { let alive = true; void probeAdmin().then((ok) => { if (alive) setAdmin(ok); }); return () => { alive = false; }; }, []);
  const [formId, setFormId] = useState<string>();
  // AI로 만들기의 [빌더에서 열어 고치기]·내 업무공간의 [열기]: 그 양식을 빌더로 연다
  const [incoming, setIncoming] = useState<{ schema: FormSchema; lastExported?: FormSchema; at: number }>();
  // 양식 만들기 완료 화면의 [취합하기로 이동]
  useEffect(() => {
    const on = (e: Event) => {
      const { tab: next, formId: id } = (e as CustomEvent<{ tab: Tab; formId?: string }>).detail;
      setTab(next);
      if (id) setFormId(id);
    };
    const open = (e: Event) => { const { schema, lastExported } = (e as CustomEvent<{ schema: FormSchema; lastExported?: FormSchema }>).detail; setIncoming({ schema, lastExported, at: Date.now() }); setTab('generator'); };
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
              ['home', '내 업무공간'],
              ['ai', 'AI로 만들기'],
              ['generator', '양식 만들기'],
              ['aggregator', '취합하기'],
              ...(cloudEnabled ? [['account', '내 계정']] as const : []),
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
        <span id="app-header-slot" className="flex min-w-0 flex-1 items-center gap-3" />
      </header>
      <main className="min-h-0 flex-1">
        {/* AI로 만들기는 다른 화면에 다녀와도 대화가 이어지도록 늘 켜 두고 숨기기만 한다 */}
        <div className={tab === 'ai' ? 'h-full overflow-auto' : 'hidden'}><AiPage /></div>
        {tab === 'ai' ? null : tab === 'home' ? (
          <div className="h-full overflow-auto"><WorkspacePage /></div>
        ) : tab === 'generator' ? (
          <GeneratorRoot incoming={incoming} />
        ) : tab === 'account' && cloudEnabled ? (
          <div className="h-full overflow-auto"><AccountPage /></div>
        ) : tab === 'admin' && admin ? (
          <div className="h-full overflow-auto"><AdminPage /></div>
        ) : (
          <div className="h-full overflow-auto"><AggregatorRoot formId={formId} /></div>
        )}
      </main>
    </div>
  );
}
