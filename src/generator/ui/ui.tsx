import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, TextareaHTMLAttributes } from 'react';
import { useId } from 'react';

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'default' | 'pri' | 'ghost' | 'danger'; size?: 'sm' | 'md' };
export function Button({ variant = 'default', size = 'md', className, type = 'button', ...p }: BtnProps) {
  return (
    <button
      type={type}
      {...p}
      className={cx(
        'inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-btn border font-medium outline-none focus-visible:ring-3 focus-visible:ring-pri-bg disabled:opacity-50',
        size === 'sm' ? 'px-2 py-0.5 text-xs' : 'px-3 py-1.5 text-[13px]',
        variant === 'pri' && 'border-pri bg-pri font-bold text-white hover:bg-pri-ink',
        variant === 'default' && 'border-line-strong bg-white text-ink hover:bg-panel',
        variant === 'ghost' && 'border-transparent bg-transparent text-sub hover:bg-chip',
        variant === 'danger' && 'border-line-strong bg-white text-err-ink hover:bg-err',
        className,
      )}
    />
  );
}

export function Chip({ tone = 'gray', children, className }: { tone?: 'gray' | 'pri' | 'req' | 'warn' | 'err' | 'auto'; children: ReactNode; className?: string }) {
  return (
    <span
      className={cx(
        'inline-block whitespace-nowrap rounded-[5px] border px-1.5 text-[11.5px] leading-[18px]',
        tone === 'gray' && 'border-line bg-chip text-sub',
        tone === 'pri' && 'border-pri-line bg-pri-bg text-pri-ink',
        tone === 'req' && 'border-req-line bg-req text-req-ink',
        tone === 'warn' && 'border-[#f3cfa5] bg-warn text-warn-ink',
        tone === 'err' && 'border-[#f5c2bd] bg-err text-err-ink',
        tone === 'auto' && 'border-[#bfe3d6] bg-auto text-auto-ink',
        className,
      )}
    >
      {children}
    </span>
  );
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-semibold text-sub">{label}</span>
      {children}
      {hint && <span className="text-xs text-muted">{hint}</span>}
    </label>
  );
}

export function TextInput({ className, ...p }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...p}
      className={cx(
        'h-8 min-w-0 rounded-btn border border-line-strong bg-white px-2.5 text-[13px] outline-none focus:border-pri focus:ring-3 focus:ring-pri-bg',
        className,
      )}
    />
  );
}

export function TextArea({ className, ...p }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...p}
      className={cx(
        'min-h-16 rounded-btn border border-line-strong bg-white px-2.5 py-1.5 text-[13px] leading-snug outline-none focus:border-pri focus:ring-3 focus:ring-pri-bg',
        className,
      )}
    />
  );
}

/** 숫자 입력: 비우면 undefined */
export function NumberInput({ value, onValue, ...p }: Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'> & { value: number | undefined; onValue: (v: number | undefined) => void }) {
  return (
    <TextInput
      {...p}
      inputMode="decimal"
      value={value ?? ''}
      onChange={(e) => {
        const t = e.target.value.replace(/,/g, '').trim();
        if (t === '' || t === '-') return onValue(undefined);
        const n = Number(t);
        if (!Number.isNaN(n)) onValue(n);
      }}
    />
  );
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cx('relative inline-block h-4 w-7 shrink-0 rounded-full outline-none transition-colors focus-visible:ring-3 focus-visible:ring-pri-bg', checked ? 'bg-pri' : 'bg-line-strong')}
    >
      <span className={cx('absolute top-0.5 h-3 w-3 rounded-full bg-white transition-all', checked ? 'right-0.5' : 'left-0.5')} />
    </button>
  );
}

export function Seg<T extends string>({ value, options, onChange, label, size = 'md' }: {
  value: T; options: readonly (readonly [T, string])[]; onChange: (v: T) => void; label: string; size?: 'sm' | 'md';
}) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex overflow-hidden rounded-btn border border-line-strong">
      {options.map(([v, text]) => (
        <button
          key={v}
          type="button"
          role="radio"
          aria-checked={v === value}
          onClick={() => onChange(v)}
          className={cx(
            'whitespace-nowrap border-r border-line-strong outline-none last:border-r-0 focus-visible:bg-pri-bg',
            size === 'sm' ? 'px-2 py-0.5 text-xs' : 'px-2.5 py-1 text-[13px]',
            v === value ? 'bg-pri-bg font-bold text-pri-ink' : 'bg-white text-sub hover:bg-panel',
          )}
        >
          {text}
        </button>
      ))}
    </div>
  );
}

export function Checkbox({ checked, onChange, label, disabled, locked }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode; disabled?: boolean; locked?: boolean }) {
  const id = useId();
  return (
    <label htmlFor={id} className={cx('flex items-center gap-2', disabled ? 'text-muted' : 'cursor-pointer')}>
      <input id={id} type="checkbox" className="h-4 w-4 accent-[#1f5fbf]" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
      {locked && <span aria-label="필수">🔒</span>}
    </label>
  );
}

export function Dialog({ title, children, footer, onClose, tone = 'default' }: { title: ReactNode; children: ReactNode; footer: ReactNode; onClose: () => void; tone?: 'default' | 'err' }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(16,24,40,.42)] p-5" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" className="w-[620px] max-w-full overflow-hidden rounded-[14px] bg-white shadow-2xl" onKeyDown={(e) => e.key === 'Escape' && onClose()}>
        <div className="flex items-center gap-2.5 border-b border-line px-5 py-4">
          {tone === 'err' && <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-err font-bold text-err-ink">!</span>}
          <b className="text-[17px]">{title}</b>
          <span className="flex-1" />
          <Button variant="ghost" size="sm" onClick={onClose} aria-label="닫기">✕</Button>
        </div>
        <div className="flex max-h-[60vh] flex-col gap-3.5 overflow-auto px-5 py-4">{children}</div>
        <div className="flex items-center gap-2 border-t border-line bg-panel px-5 py-3">{footer}</div>
      </div>
    </div>
  );
}

export { cx };
