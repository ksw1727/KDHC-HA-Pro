import type { FormSchema } from '@contract/schema';
import type { Builder } from '../state/useBuilder';
import { Field, TextArea, TextInput } from '../ui/ui';

export function MetaPanel({ b }: { b: Builder }) {
  const s = b.schema;
  const set = (patch: Partial<Pick<FormSchema, 'title' | 'guide' | 'deadline' | 'contact'>>) => b.act({ type: 'meta/set', patch });
  return (
    <>
      <Field label="제목 (필수)">
        <TextInput value={s.title} placeholder="2026 하반기 교육 참가자 조사" onChange={(e) => set({ title: e.target.value })} />
      </Field>
      <Field label="작성 안내" hint="엑셀 2행에 보여요.">
        <TextArea value={s.guide ?? ''} placeholder="노란 칸은 꼭 채워 주세요" onChange={(e) => set({ guide: e.target.value || undefined })} />
      </Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label="제출 기한">
          <TextInput type="date" value={s.deadline ?? ''} onChange={(e) => set({ deadline: e.target.value || undefined })} />
        </Field>
        <Field label="문의처">
          <TextInput value={s.contact ?? ''} placeholder="인사팀 02-000-0000" onChange={(e) => set({ contact: e.target.value || undefined })} />
        </Field>
      </div>
    </>
  );
}
