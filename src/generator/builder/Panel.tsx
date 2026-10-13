import type { ReactNode } from 'react';
import { cx } from '../ui/ui';

export function Panel({ n, title, summary, open, onToggle, bad, children }: {
  n: number; title: string; summary?: ReactNode; open: boolean; onToggle: () => void; bad?: number; children: ReactNode;
}) {
  const id = `panel-${n}`;
  return (
    <section className={cx('rounded-card border bg-white', bad ? 'border-[#f5c2bd] ring-3 ring-err' : 'border-line')}>
      <h3 className="m-0">
        <button type="button" aria-expanded={open} aria-controls={id} onClick={onToggle}
          className="flex w-full items-center gap-2 whitespace-nowrap rounded-card px-3 py-2.5 text-left font-semibold outline-none focus-visible:ring-3 focus-visible:ring-pri-bg">
          <span className={cx('inline-flex h-[19px] w-[19px] items-center justify-center rounded-full text-[11px]', bad ? 'bg-err-ink text-white' : open ? 'bg-pri text-white' : 'bg-chip text-sub')}>{n}</span>
          {title}
          <span className={cx('ml-auto min-w-0 truncate pl-2 text-xs font-normal', bad ? 'text-err-ink' : 'text-muted')}>{bad ? `고칠 것 ${bad}` : summary}</span>
        </button>
      </h3>
      {open && <div id={id} className="flex flex-col gap-3 px-3 pb-3">{children}</div>}
    </section>
  );
}
