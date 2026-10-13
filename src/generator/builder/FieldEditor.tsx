import type { Field, FieldType } from '@contract/schema';
import { FIELD_TYPES, FIELD_TYPE_ORDER } from '@contract/fieldTypes';
import { Field as F, TextArea, TextInput, Toggle } from '../ui/ui';
import { FormatEditor } from './FormatEditor';
import { formatSample, normalizeHint } from '../preview/formatSample';

/** 항목 편집 칸: 이름·타입·서식·필수·작성 안내 + 정리 안내 한 줄 */
export function FieldEditor({ f, onPatch, lockType, hideRequired }: { f: Field; onPatch: (p: Partial<Field>) => void; lockType?: boolean; hideRequired?: boolean }) {
  return (
    <div className="flex flex-col gap-2.5 rounded-b-card border border-t-0 border-pri-line bg-white p-2.5">
      <div className="flex gap-2">
        <F label="이름">
          <TextInput value={f.label} autoFocus onChange={(e) => onPatch({ label: e.target.value })} />
        </F>
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
