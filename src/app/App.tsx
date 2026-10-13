import { useEffect, useState } from 'react';
import { GeneratorRoot } from '@gen/index';

type Tab = 'generator' | 'aggregator';

export function App() {
  const [tab, setTab] = useState<Tab>('generator');
  // 양식 만들기 완료 화면의 [취합하기로 이동]
  useEffect(() => {
    const on = (e: Event) => setTab((e as CustomEvent<{ tab: Tab }>).detail.tab);
    window.addEventListener('hanan-moa:tab', on);
    return () => window.removeEventListener('hanan-moa:tab', on);
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
        {tab === 'generator' ? (
          <GeneratorRoot />
        ) : (
          <div className="p-8 text-sub">취합하기 화면은 개발자 2가 만들고 있어요.</div>
        )}
      </main>
    </div>
  );
}
