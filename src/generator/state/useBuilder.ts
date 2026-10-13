import { useCallback, useEffect, useMemo, useReducer, useState } from 'react';
import type { FormSchema, Layout } from '@contract/schema';
import { blockFields } from '@contract/schema';
import { formReducer, type Action } from './formReducer';
import { newSchema, randomFormId, randomKey } from './newSchema';
import { nextVersion } from './versioning';
import type { ExportProblem, Where } from './validateForExport';
import { loadCurrent, saveForm, type StoredForm } from '../storage/localForms';

export type PanelId = Where;

export interface Selection { blockId: string; key: string }

function initial(): StoredForm {
  return loadCurrent() ?? { schema: newSchema('header-list', new Date(), { formId: randomFormId(), key: randomKey }), savedAt: '' };
}

/** 빌더 화면 상태: 양식 정의 + 선택 항목 + 펼친 패널 + 검사 결과 + 자동 저장 */
export function useBuilder() {
  const [init] = useState(initial);
  const [schema, dispatch] = useReducer(formReducer, init.schema);
  const [lastExported, setLastExported] = useState<FormSchema | undefined>(init.lastExported);
  const [selected, setSelected] = useState<Selection | null>(null);
  const [openPanel, setOpenPanel] = useState<PanelId | null>('fields');
  const [problems, setProblems] = useState<ExportProblem[]>([]);
  const [saved, setSaved] = useState<boolean | null>(null);

  useEffect(() => {
    const t = setTimeout(() => {
      const now = new Date();
      setSaved(saveForm({ schema: { ...schema, updatedAt: now.toISOString() }, lastExported }, now));
    }, 500);
    return () => clearTimeout(t);
  }, [schema, lastExported]);

  const keyToBlock = useMemo(() => {
    const m = new Map<string, string>();
    for (const b of schema.blocks) for (const f of blockFields(b)) m.set(f.key, b.id);
    return m;
  }, [schema]);

  const selectKey = useCallback((key: string) => {
    const blockId = keyToBlock.get(key);
    if (!blockId) return;
    setSelected({ blockId, key });
    setOpenPanel('fields');
  }, [keyToBlock]);

  const act = useCallback((a: Action) => {
    dispatch(a);
    setProblems((p) => (p.length ? [] : p));
  }, []);

  const startNew = useCallback((layout: Layout) => {
    dispatch({ type: 'schema/load', schema: newSchema(layout, new Date(), { formId: randomFormId(), key: randomKey }) });
    setLastExported(undefined);
    setSelected(null);
    setProblems([]);
  }, []);

  /** 내보내기 성공: 내보낸 버전을 지금 양식 버전으로 기록 */
  const markExported = useCallback((exported: FormSchema) => {
    dispatch({ type: 'schema/load', schema: exported });
    setLastExported(exported);
  }, []);

  return {
    markExported,
    schema, act, selected, setSelected, selectKey, openPanel, setOpenPanel,
    problems, setProblems, saved, lastExported,
    version: nextVersion(schema, lastExported),
    startNew,
  };
}

export type Builder = ReturnType<typeof useBuilder>;
