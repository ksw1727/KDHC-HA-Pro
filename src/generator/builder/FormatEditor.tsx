import type { Field } from '@contract/schema';
import { PATTERN_INFO } from '@contract/fieldTypes';
import { Field as F, NumberInput, Seg, TextArea, TextInput, Toggle } from '../ui/ui';

type Patch = (p: Partial<Field>) => void;

const UNITS = ['', '개', '원', '명', '%'] as const;

function NumberFormat({ f, set }: { f: Field; set: Patch }) {
  const unit = f.unit ?? '';
  const custom = !UNITS.includes(unit as (typeof UNITS)[number]);
  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <Seg label="자릿수" value={(f.decimals ?? 0) > 0 ? 'dec' : 'int'} options={[['int', '정수'], ['dec', '소수']]} onChange={(v) => set({ decimals: v === 'int' ? 0 : Math.max(1, f.decimals ?? 1) })} />
        {(f.decimals ?? 0) > 0 && (
          <Seg size="sm" label="소수 자릿수" value={String(f.decimals)} options={[['1', '1자리'], ['2', '2자리'], ['3', '3자리'], ['4', '4자리']]} onChange={(v) => set({ decimals: Number(v) })} />
        )}
        <span className="flex-1" />
        <span className="whitespace-nowrap text-sub">천 단위 쉼표</span>
        <Toggle label="천 단위 쉼표" checked={f.thousands !== false} onChange={(v) => set({ thousands: v })} />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="w-14 text-sub">단위</span>
        <Seg size="sm" label="단위" value={custom ? 'custom' : unit} options={[['', '없음'], ['개', '개'], ['원', '원'], ['명', '명'], ['%', '%'], ['custom', '직접']]}
          onChange={(v) => set({ unit: v === 'custom' ? (custom ? unit : '건') : v || undefined })} />
        {custom && <TextInput className="w-16" aria-label="단위 직접 입력" value={unit} onChange={(e) => set({ unit: e.target.value || undefined })} />}
      </div>
      <div className="flex items-center gap-2">
        <span className="w-14 text-sub">범위</span>
        <NumberInput className="w-24" aria-label="최소값" placeholder="최소" value={f.min} onValue={(v) => set({ min: v })} />
        <span>~</span>
        <NumberInput className="w-28" aria-label="최대값" placeholder="최대" value={f.max} onValue={(v) => set({ max: v })} />
      </div>
    </>
  );
}

type DateRange = 'none' | 'future' | 'within30' | 'fixed';
/** '날짜 지정'을 고르면 시작 날짜를 오늘로 채운다 (빈 글자면 '제한 없음'으로 보여 입력칸이 안 나왔음) */
const localToday = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const rangeOf = (f: Field): DateRange =>
  !f.minDate && !f.maxDate ? 'none' : f.minDate === 'today' && !f.maxDate ? 'future' : f.minDate === 'today' && f.maxDate === 'today+30' ? 'within30' : 'fixed';

function DateFormat({ f, set }: { f: Field; set: Patch }) {
  const r = rangeOf(f);
  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <span className="w-14 text-sub">표시</span>
        <Seg size="sm" label="날짜 표시 형식" value={f.dateFormat ?? 'yyyy-mm-dd'}
          options={[['yyyy-mm-dd', '2026-11-01'], ['yyyy.mm.dd', '2026.11.01'], ['yyyy-mm', '연월'], ['yyyy', '연도']]}
          onChange={(v) => set({ dateFormat: v })} />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="w-14 text-sub">허용 범위</span>
        <Seg size="sm" label="허용 범위" value={r} options={[['none', '제한 없음'], ['future', '오늘 이후'], ['within30', '오늘부터 30일'], ['fixed', '날짜 지정']]}
          onChange={(v) => set(v === 'none' ? { minDate: undefined, maxDate: undefined } : v === 'future' ? { minDate: 'today', maxDate: undefined } : v === 'within30' ? { minDate: 'today', maxDate: 'today+30' } : { minDate: localToday(), maxDate: undefined })} />
      </div>
      {r === 'fixed' && (
        <div className="flex items-center gap-2 pl-16">
          <TextInput type="date" aria-label="시작 날짜" value={f.minDate ?? ''} onChange={(e) => set({ minDate: e.target.value || undefined })} />
          <span>~</span>
          <TextInput type="date" aria-label="끝 날짜" value={f.maxDate ?? ''} onChange={(e) => set({ maxDate: e.target.value || undefined })} />
        </div>
      )}
    </>
  );
}

/** 타입별 서식 설정 (02-generator.md 2.3) */
export function FormatEditor({ f, set }: { f: Field; set: Patch }) {
  switch (f.type) {
    case 'text':
      return (
        <div className="flex items-center gap-2">
          <span className="text-sub">최대 글자 수</span>
          <NumberInput className="w-20" aria-label="최대 글자 수" placeholder="제한 없음" value={f.maxLength} onValue={(v) => set({ maxLength: v && v > 0 ? Math.round(v) : undefined })} />
        </div>
      );
    case 'number':
      return <NumberFormat f={f} set={set} />;
    case 'date':
      return <DateFormat f={f} set={set} />;
    case 'select':
      return (
        <F label="선택지 (줄마다 하나)">
          <TextArea value={(f.options ?? []).join('\n')} placeholder={'사원\n대리\n과장'}
            onChange={(e) => set({ options: e.target.value.split('\n') })}
            onBlur={(e) => set({ options: [...new Set(e.target.value.split('\n').map((x) => x.trim()).filter(Boolean))] })} />
        </F>
      );
    case 'pattern':
      return (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sub">종류</span>
          <Seg size="sm" label="패턴 종류" value={f.pattern ?? 'mobile'} options={Object.entries(PATTERN_INFO).map(([k, v]) => [k as NonNullable<Field['pattern']>, v.label] as const)} onChange={(v) => set({ pattern: v })} />
        </div>
      );
    case 'memo':
      return <p className="m-0 text-xs text-muted">메모는 줄바꿈해서 여러 줄로 쓸 수 있어요. 따로 정할 서식은 없어요.</p>;
  }
}
