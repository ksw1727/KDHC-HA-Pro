import { useEffect, useState } from 'react';
import type { Field, FieldType } from '@contract/schema';
import { FIELD_TYPES, FIELD_TYPE_ORDER } from '@contract/fieldTypes';
import { Field as F, TextArea, TextInput, Toggle } from '../ui/ui';
import { FormatEditor } from './FormatEditor';
import { formatSample, normalizeHint } from '../preview/formatSample';
import { FormulaEditor } from './FormulaEditor';
import type { FormulaScope } from '@contract/formula';
import { Seg, Toggle as T2 } from '../ui/ui';

/** 항목 편집 칸: 이름·타입·서식·필수·작성 안내 + 정리 안내 한 줄 */
function CalcFormat({ f, onPatch }: { f: Field; onPatch: (p: Partial<Field>) => void }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-sub">결과 서식</span>
      <Seg size="sm" label="소수 자릿수" value={String(f.decimals ?? 0)} options={[['0', '정수'], ['1', '소수 1'], ['2', '소수 2']]} onChange={(v) => onPatch({ decimals: Number(v) })} />
      <span className="text-sub">쉼표</span><T2 label="천 단위 쉼표" checked={f.thousands !== false} onChange={(v) => onPatch({ thousands: v })} />
      <Seg size="sm" label="단위" value={f.unit ?? ''} options={[['', '없음'], ['원', '원'], ['%', '%'], ['명', '명'], ['개', '개']]} onChange={(v) => onPatch({ unit: v || undefined })} />
    </div>
  );
}

/** 접힌 서식을 한 줄로: "원 단위 · 천 단위 쉼표 · 0~100" (기본값이면 짧게) */
export function formatSummary(f: Field): string {
  const parts: string[] = [];
  if (f.type === 'number') {
    parts.push((f.decimals ?? 0) > 0 ? `소수 ${f.decimals}자리` : '정수');
    if (f.unit) parts.push(`${f.unit} 단위`);
    if (f.thousands !== false) parts.push('천 단위 쉼표');
    if (f.min != null || f.max != null) parts.push(`${f.min ?? ''}~${f.max ?? ''}`);
  }
  if (f.type === 'date') {
    const DATE_FMT: Record<string, string> = { 'yyyy.mm.dd': '2026.11.01 형식', 'yyyy-mm': '연월', yyyy: '연도' };
    parts.push(DATE_FMT[f.dateFormat ?? ''] ?? '2026-11-01 형식');
    if (f.minDate || f.maxDate) parts.push(f.minDate === 'today' && f.maxDate === 'today+30' ? '오늘부터 30일' : f.minDate === 'today' && !f.maxDate ? '오늘 이후' : `${f.minDate ?? ''}~${f.maxDate ?? ''}`);
  }
  if ((f.type === 'text' || f.type === 'memo') && f.maxLength) parts.push(`${f.maxLength}자까지`);
  if (f.help) parts.push('작성 안내 있음');
  return parts.join(' · ') || '기본 서식';
}

/** 처음부터 정해야 하는 서식이 있는 타입: 목록에서 고르기(선택지), 형식(휴대폰 등) → 접지 않는다 */
const OPEN_TYPES: FieldType[] = ['select', 'pattern'];

/** hideLabel: 이름을 다른 곳에서 정할 때(여유 줄 열 = 머리글, 여러 칸 한꺼번에 설정) */
export function FieldEditor({ f, onPatch, lockType, hideRequired, hideLabel, scope }: { f: Field; onPatch: (p: Partial<Field>) => void; lockType?: boolean; hideRequired?: boolean; hideLabel?: boolean; scope?: FormulaScope }) {
  if (f.type === 'calc') {
    return (
      <div className="flex flex-col gap-2.5 rounded-b-card border border-t-0 border-pri-line bg-white p-2.5">
        <div className="flex gap-2">
          {!hideLabel && (
            <F label="이름">
              <TextInput value={f.label} autoFocus onChange={(e) => onPatch({ label: e.target.value })} />
            </F>
          )}
          <F label="타입">
            <select disabled={lockType} value={f.type} onChange={(e) => onPatch({ type: e.target.value as FieldType })}
              className="h-8 w-32 rounded-btn border border-line-strong bg-white px-2 text-[13px] outline-none focus:border-pri disabled:bg-chip">
              {FIELD_TYPE_ORDER.map((t) => <option key={t} value={t}>{FIELD_TYPES[t].label}</option>)}
            </select>
          </F>
        </div>
        <FormulaEditor value={f.formula ?? ''} decimals={f.decimals ?? 0} onChange={(formula) => onPatch({ formula })} scope={scope ?? { names: [], aggregateOnly: [] }} />
        <CalcFormat f={f} onPatch={onPatch} />
        <div className="rounded-btn bg-auto px-2.5 py-1.5 text-xs text-auto-ink">{normalizeHint(f)}</div>
      </div>
    );
  }
  return <PlainEditor f={f} onPatch={onPatch} lockType={lockType} hideRequired={hideRequired} hideLabel={hideLabel} />;
}

/** 꼭 정할 것(이름·타입·필수)만 펼치고, 서식·작성 안내는 한 줄 요약 + [자세히] 안에 (02-generator.md 2.3) */
function PlainEditor({ f, onPatch, lockType, hideRequired, hideLabel }: { f: Field; onPatch: (p: Partial<Field>) => void; lockType?: boolean; hideRequired?: boolean; hideLabel?: boolean }) {
  const always = OPEN_TYPES.includes(f.type);
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [f.key]);   // 다른 항목을 고르면 다시 접는다
  const show = always || open;
  return (
    <div className="flex flex-col gap-2.5 rounded-b-card border border-t-0 border-pri-line bg-white p-2.5">
      <div className="flex flex-wrap items-end gap-2">
        {!hideLabel && (
          <F label="이름">
            <TextInput value={f.label} autoFocus onChange={(e) => onPatch({ label: e.target.value })} />
          </F>
        )}
        <F label="타입">
          <select disabled={lockType} value={f.type} onChange={(e) => onPatch({ type: e.target.value as FieldType })}
            className="h-8 w-32 rounded-btn border border-line-strong bg-white px-2 text-[13px] outline-none focus:border-pri disabled:bg-chip">
            {FIELD_TYPE_ORDER.map((t) => <option key={t} value={t}>{FIELD_TYPES[t].label}</option>)}
          </select>
        </F>
        {!hideRequired && <div className="flex h-8 items-center gap-1.5"><span className="text-sub">필수</span><Toggle label="필수 입력" checked={f.required} onChange={(v) => onPatch({ required: v })} /></div>}
      </div>
      {always && <FormatEditor f={f} set={onPatch} />}
      <div className="flex flex-wrap items-center gap-2 rounded-btn border border-line px-2.5 py-1.5">
        <span className="min-w-0 flex-1 text-[13px]">{always ? '' : `${formatSummary(f)} · `}<span className="text-muted">이렇게 보여요</span> <b>{formatSample(f) || '—'}</b></span>
        <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className="text-xs font-semibold text-pri-ink hover:underline">
          {open ? '▾ 접기' : always ? '▸ 작성 안내' : '▸ 자세히'}
        </button>
      </div>
      {show && (
        <>
          {!always && <FormatEditor f={f} set={onPatch} />}
          {open && (
            <>
              <F label="작성 안내 (엑셀에서 칸을 누르면 보임)">
                <TextArea className="min-h-10" value={f.help ?? ''} placeholder="1인당 교육비를 원 단위로 입력" onChange={(e) => onPatch({ help: e.target.value || undefined })} />
              </F>
              <div className="rounded-btn bg-auto px-2.5 py-1.5 text-xs text-auto-ink">{normalizeHint(f)}</div>
            </>
          )}
        </>
      )}
    </div>
  );
}
