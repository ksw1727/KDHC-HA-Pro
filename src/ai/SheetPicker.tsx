import { useState } from 'react';
import type { SheetMeta } from '../../tools/excelDump';
import { cx } from '@gen/ui/ui';

/** 첨부한 엑셀 하나의 시트 고르기 상태 */
export type SheetPick =
  | { status: 'loading' }
  | { status: 'ok'; sheets: SheetMeta[]; picked: string[] }
  | { status: 'error'; message: string }
  /** 열기 암호가 걸려 암호를 받아야 함 (wrong: 방금 넣은 암호가 틀림) */
  | { status: 'locked'; message: string; wrong?: boolean };

/** 처음 고른 상태: 숨기지 않은 시트 전부 (모두 숨김이면 전부) */
export function defaultPick(sheets: SheetMeta[]): string[] {
  const visible = sheets.filter((s) => s.state === 'visible');
  return (visible.length ? visible : sheets).map((s) => s.name);
}

/** AI에게 넘길 시트 이름 (시트를 고를 수 없었으면 undefined = 모든 시트) */
export const pickedSheets = (p: SheetPick | undefined): string[] | undefined => (p?.status === 'ok' ? p.picked : undefined);
/** 일부 시트만 골랐는지 (전부면 굳이 알리지 않는다) */
export const isPartial = (p: SheetPick | undefined) => p?.status === 'ok' && p.picked.length < p.sheets.length;

/** 첨부한 엑셀마다 AI에게 보낼 시트를 고른다. 시트가 하나뿐인 파일은 보여 주지 않는다 */
export function SheetPicker({ files, picks, onChange, onUnlock, disabled }: {
  files: File[];
  picks: Map<File, SheetPick>;
  onChange: (file: File, picked: string[]) => void;
  /** 암호를 넣고 [열기]: 브라우저 안에서만 풀고 보내거나 저장하지 않는다 */
  onUnlock: (file: File, password: string) => void;
  disabled?: boolean;
}) {
  const rows = files.map((file) => ({ file, pick: picks.get(file) })).filter(({ pick }) => pick && (pick.status !== 'ok' || pick.sheets.length > 1));
  if (!rows.length) return null;
  return (
    <div className="flex flex-col gap-1.5">
      {rows.map(({ file, pick }, i) => (
        <div key={`${file.name}-${i}`} className="rounded-box border border-line bg-panel px-3 py-2 text-[13px]">
          {pick!.status === 'loading' && <span className="text-sub">{file.name}: 시트 목록을 읽는 중…</span>}
          {pick!.status === 'error' && <span className="text-warn-ink">{pick!.message}</span>}
          {pick!.status === 'locked' && <Unlock file={file} pick={pick as Extract<SheetPick, { status: 'locked' }>} disabled={disabled} onUnlock={onUnlock} />}
          {pick!.status === 'ok' && (() => {
            const { sheets, picked } = pick as Extract<SheetPick, { status: 'ok' }>;
            const set = new Set(picked);
            const toggle = (name: string) => onChange(file, sheets.map((s) => s.name).filter((n) => (n === name ? !set.has(n) : set.has(n))));
            return (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  <b className="truncate">{file.name}</b>
                  <span className="text-xs text-sub">AI에게 보낼 시트를 골라 주세요 · {picked.length}/{sheets.length}장</span>
                  <span className="flex-1" />
                  <button type="button" disabled={disabled} className="text-xs text-sub hover:text-ink" onClick={() => onChange(file, sheets.map((s) => s.name))}>전체 고르기</button>
                  <button type="button" disabled={disabled} className="text-xs text-sub hover:text-ink" onClick={() => onChange(file, [])}>모두 빼기</button>
                </div>
                <div role="group" aria-label={`${file.name} 시트 고르기`} className="mt-1.5 flex flex-wrap gap-1.5">
                  {sheets.map((s) => {
                    const on = set.has(s.name);
                    return (
                      <label key={s.name} className={cx('inline-flex cursor-pointer items-center gap-1 rounded-full border px-2.5 py-0.5', on ? 'border-pri bg-pri-bg text-ink' : 'border-line bg-white text-sub')}>
                        <input type="checkbox" className="accent-[var(--color-pri)]" checked={on} disabled={disabled} onChange={() => toggle(s.name)} />
                        {s.name}
                        <span className="text-[11px] text-muted">{s.rows ? `${s.rows.toLocaleString()}행` : ''}{s.state !== 'visible' ? `${s.rows ? ' · ' : ''}숨김` : ''}</span>
                      </label>
                    );
                  })}
                </div>
                {picked.length === 0 && <p className="m-0 mt-1 text-xs text-err-ink">시트를 하나 이상 골라 주세요.</p>}
              </>
            );
          })()}
        </div>
      ))}
    </div>
  );
}

/** 열기 암호 입력 (암호는 이 칸과 브라우저 메모리에서만 쓰고 지운다) */
function Unlock({ file, pick, disabled, onUnlock }: { file: File; pick: Extract<SheetPick, { status: 'locked' }>; disabled?: boolean; onUnlock: (file: File, password: string) => void }) {
  const [pw, setPw] = useState('');
  return (
    <form className="flex flex-col gap-1.5" onSubmit={(e) => { e.preventDefault(); if (pw) { onUnlock(file, pw); setPw(''); } }}>
      <div className="flex flex-wrap items-center gap-2">
        <b className="truncate">{file.name}</b>
        <span className={cx('text-xs', pick.wrong ? 'text-err-ink' : 'text-sub')}>{pick.message}</span>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <input type="password" autoComplete="off" aria-label={`${file.name} 열기 암호`} placeholder="열기 암호" value={pw} disabled={disabled}
          onChange={(e) => setPw(e.target.value)} className="h-8 w-[200px] rounded-btn border border-line-strong bg-white px-2 text-[13px]" />
        <button type="submit" disabled={disabled || !pw} className="h-8 rounded-btn border border-pri bg-pri px-3 text-[13px] font-semibold text-white disabled:opacity-50">열기</button>
        <span className="text-xs text-muted">암호는 이 브라우저 안에서만 쓰고 보내거나 저장하지 않아요. 엑셀에서 암호를 지우고 다시 올려도 돼요.</span>
      </div>
    </form>
  );
}
