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
        <FormulaEditor value={f.formula ?? ''} onChange={(formula) => onPatch({ formula })} scope={scope ?? { names: [], aggregateOnly: [] }} />
        <CalcFormat f={f} onPatch={onPatch} />
        <div className="rounded-btn bg-auto px-2.5 py-1.5 text-xs text-auto-ink">{normalizeHint(f)}</div>
      </div>
    );
  }
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
      <FormatEditor f={f} set={onPatch} />
      <div className="flex items-center gap-2">
        {!hideRequired && (<><span className="text-sub">필수 입력</span><Toggle label="필수 입력" checked={f.required} onChange={(v) => onPatch({ required: v })} /></>)}
        <span className="flex-1" />
        <span className="text-xs text-muted">이렇게 보여요: <b className="text-ink">{formatSample(f) || '—'}</b></span>
      </div>
      <F label="작성 안내 (엑셀에서 칸을 누르면 보임)">
        <TextArea className="min-h-10" value={f.help ?? ''} placeholder="1인당 교육비를 원 단위로 입력" onChange={(e) => onPatch({ help: e.target.value || undefined })} />
      </F>
      <div className="rounded-btn bg-auto px-2.5 py-1.5 text-xs text-auto-ink">{normalizeHint(f)}</div>
    </div>
  );
}
