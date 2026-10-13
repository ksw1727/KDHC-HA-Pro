import { useState } from 'react';
import { newSchema, randomFormId, randomKey } from './state/newSchema';
import type { StoredForm } from './storage/localForms';
import { LandingPage } from './landing/LandingPage';
import { BuilderPage } from './pages/BuilderPage';

/** 양식 만들기 탭: 첫 화면(구조 고르기) → 빌더 */
export function GeneratorRoot() {
  const [open, setOpen] = useState<StoredForm | null>(null);
  if (!open) {
    return <LandingPage onOpen={setOpen}
      onNew={(layout) => setOpen({ schema: newSchema(layout, new Date(), { formId: randomFormId(), key: randomKey }), savedAt: '' })} />;
  }
  return <BuilderPage key={open.schema.formId} start={open} onHome={() => setOpen(null)} />;
}
