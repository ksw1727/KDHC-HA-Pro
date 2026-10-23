import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useCloudSession } from '../cloud';
import { Slogan, Swoosh } from './brand';

export type Tab = 'home' | 'ai' | 'aggregator' | 'account' | 'admin';
const MAIN: [Tab, string][] = [['home', '내 업무공간'], ['ai', 'AI로 만들기'], ['aggregator', '취합하기']];

/**
 * 머리줄 = 슬로건 띠 한 줄: 로고 · 주요 화면 단추 · 둥근 아이콘 (관리자, 내 계정 프로필 메뉴 — GitHub처럼) · 슬로건.
 * 관리자 아이콘은 관리자에게만, 프로필은 온라인(로그인) 모드에서만 보인다.
 */
export function AppHeader({ tab, setTab, admin, extra }: { tab: Tab; setTab: (t: Tab) => void; admin: boolean; extra?: ReactNode }) {
  const session = useCloudSession();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', close); document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc); };
  }, [open]);
  const go = (t: Tab) => { setTab(t); setOpen(false); };
  const initial = (session?.email[0] ?? '?').toUpperCase();

  return (
    <header className="relative z-20 flex shrink-0 items-center gap-5 border-b border-line bg-[linear-gradient(100deg,#dff0da_0%,#ffffff_50%,#fde3e0_100%)] px-5">
      {/* 물결은 띠 안에서만 (프로필 메뉴는 띠 밖으로 펼쳐져야 해서 머리줄 자체는 자르지 않는다) */}
      <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden"><Swoosh h={56} /></div>
      <span className="relative flex shrink-0 items-center gap-2 py-2.5 text-[15px] font-extrabold tracking-tight text-pri">
        <i aria-hidden className="grid size-7 place-items-center rounded-[9px] bg-pri text-[10.5px] not-italic text-white">MOA</i>
        한난<span className="-ml-2 text-ink">MOA</span>
      </span>
      <MainNav tab={tab} setTab={setTab} />
      <span className="flex-1" />
      {extra && <span className="relative">{extra}</span>}
      {admin && (
        <Circle label="관리자" on={tab === 'admin'} onClick={() => go('admin')}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="size-[17px]"><path d="M12 3 5 6v5c0 4.5 3 8.3 7 10 4-1.7 7-5.5 7-10V6z" /><path d="m9 12 2 2 4-4" /></svg>
        </Circle>
      )}
      {session && (
        <div ref={box} className="relative">
          <button type="button" aria-label="내 계정 메뉴" aria-haspopup="menu" aria-expanded={open} title={session.email} onClick={() => setOpen((v) => !v)}
            className={'relative grid size-[34px] place-items-center rounded-full border-2 border-white bg-[linear-gradient(135deg,#8fd08a,#e8857f)] text-[13px] font-extrabold text-white ' +
              (open || tab === 'account' ? 'shadow-[0_0_0_3px_var(--color-pri-bg),0_0_0_4px_var(--color-pri)]' : 'shadow-[0_0_0_1px_var(--color-line)]')}>
            {initial}
            <span aria-hidden className="absolute -bottom-0.5 -right-1.5 grid size-3.5 place-items-center rounded-full border border-line bg-white text-[8px] text-sub">▾</span>
          </button>
          {open && (
            <div role="menu" className="absolute right-0 top-[46px] w-[250px] rounded-card border border-line bg-white p-1.5 shadow-[0_12px_32px_-12px_#1d24204d]">
              <div className="mb-1 border-b border-line px-2.5 pb-2.5 pt-2">
                <b className="block truncate">{session.email}</b>
                <span role="status" className="text-xs text-muted">{session.status}</span>
              </div>
              <MenuItem onClick={() => go('account')} icon={<path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM4 21c1.5-4 4.5-6 8-6s6.5 2 8 6" />}>내 계정</MenuItem>
              {admin && <MenuItem onClick={() => go('admin')} icon={<path d="M12 3 5 6v5c0 4.5 3 8.3 7 10 4-1.7 7-5.5 7-10V6z" />}>관리자</MenuItem>}
              <hr className="my-1 border-0 border-t border-line" />
              <MenuItem disabled={session.busy} onClick={() => { setOpen(false); session.signOut(); }} icon={<path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4M10 17l5-5-5-5M15 12H3" />}>로그아웃</MenuItem>
            </div>
          )}
        </div>
      )}
      <Slogan height={34} className="relative shrink-0" />
    </header>
  );
}

/** 주요 화면 단추. 지금 화면은 녹색으로 채운다 */
function MainNav({ tab, setTab }: { tab: Tab; setTab: (t: Tab) => void }) {
  return (
    <nav className="relative flex shrink-0 gap-2" aria-label="주요 화면">
      {MAIN.map(([id, label]) => (
        <button key={id} type="button" onClick={() => setTab(id)} aria-current={tab === id ? 'page' : undefined}
          className={'whitespace-nowrap rounded-full border px-4 py-[7px] text-[13.5px] font-semibold transition-colors ' +
            (tab === id
              ? 'border-pri bg-pri text-white shadow-[0_2px_8px_-2px_#37a13780]'
              : 'border-line bg-white/85 text-ink shadow-[0_1px_2px_#1d242014] hover:border-pri hover:bg-white hover:text-pri')}>
          {label}
        </button>
      ))}
    </nav>
  );
}

function Circle({ label, on, onClick, children }: { label: string; on: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" aria-label={label} title={label} aria-current={on ? 'page' : undefined} onClick={onClick}
      className={'relative grid size-[34px] shrink-0 place-items-center rounded-full border bg-white ' + (on ? 'border-pri text-pri shadow-[0_0_0_3px_var(--color-pri-bg)]' : 'border-line text-sub hover:border-pri hover:text-pri')}>
      {children}
    </button>
  );
}
function MenuItem({ icon, onClick, disabled, children }: { icon: ReactNode; onClick: () => void; disabled?: boolean; children: ReactNode }) {
  return (
    <button type="button" role="menuitem" disabled={disabled} onClick={onClick}
      className="flex w-full items-center gap-2.5 rounded-box px-2.5 py-[7px] text-left hover:bg-pri-bg hover:text-pri-ink disabled:opacity-50">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="size-[15px] shrink-0">{icon}</svg>
      {children}
    </button>
  );
}
