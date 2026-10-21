import { useEffect, useState } from 'react';
import type { FormSchema } from '@contract/schema';
import { newSchema, randomFormId, randomKey } from './state/newSchema';
import type { StoredForm } from './storage/localForms';
import { LandingPage } from './landing/LandingPage';
import { BuilderPage } from './pages/BuilderPage';

/** 양식 만들기 탭: 첫 화면(구조 고르기) → 빌더 */
export function GeneratorRoot({ incoming }: { incoming?: { schema: FormSchema; at: number } } = {}) {
  const [open, setOpen] = useState<StoredForm | null>(null);
  // AI로 만들기에서 넘겨준 양식
  useEffect(() => { if (incoming) setOpen({ schema: incoming.schema, savedAt: '' }); }, [incoming]);
  if (!open) {
    return <LandingPage onOpen={setOpen}
      onNew={(layout) => setOpen({ schema: newSchema(layout, new Date(), { formId: randomFormId(), key: randomKey }), savedAt: '' })} />;
  }
  return <BuilderPage key={open.schema.formId} start={open} onHome={() => setOpen(null)} />;
}
