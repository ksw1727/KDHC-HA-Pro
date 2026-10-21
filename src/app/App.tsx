import { useEffect, useState } from 'react';
import { GeneratorRoot } from '@gen/index';
import { AggregatorRoot } from '@agg/index';
import { AiPage } from '../ai/AiPage';
import type { FormSchema } from '@contract/schema';

type Tab = 'ai' | 'generator' | 'aggregator';

export function App() {
  const [tab, setTab] = useState<Tab>('ai');
  const [formId, setFormId] = useState<string>();
  // AI로 만들기의 [빌더에서 열어 고치기]: 그 양식을 빌더로 연다
  const [incoming, setIncoming] = useState<{ schema: FormSchema; at: number }>();
  // 양식 만들기 완료 화면의 [취합하기로 이동]
  useEffect(() => {
    const on = (e: Event) => {
      const { tab: next, formId: id } = (e as CustomEvent<{ tab: Tab; formId?: string }>).detail;
      setTab(next);
      if (id) setFormId(id);
    };
    const open = (e: Event) => { setIncoming({ schema: (e as CustomEvent<{ schema: FormSchema }>).detail.schema, at: Date.now() }); setTab('generator'); };
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
              ['generator', '양식 만들기'],
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
        <span id="app-header-slot" className="flex min-w-0 flex-1 items-center gap-3" />
      </header>
      <main className="min-h-0 flex-1">
        {tab === 'ai' ? (
          <div className="h-full overflow-auto"><AiPage /></div>
        ) : tab === 'generator' ? (
          <GeneratorRoot incoming={incoming} />
        ) : (
          <div className="h-full overflow-auto"><AggregatorRoot formId={formId} /></div>
        )}
      </main>
    </div>
  );
}
