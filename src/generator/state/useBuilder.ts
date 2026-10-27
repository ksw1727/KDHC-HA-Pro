import { useCallback, useEffect, useMemo, useReducer, useState } from 'react';
import type { FormSchema } from '@contract/schema';
import { blockFields } from '@contract/schema';
import { formReducer, type Action } from './formReducer';
import { newSchema, randomFormId, randomKey } from './newSchema';
import { nextVersion } from './versioning';
import type { ExportProblem, Where } from './validateForExport';
import { isSavedAsIs, loadCurrent, saveForm, type StoredForm } from '../storage/localForms';

export type PanelId = Where;

export interface Selection { blockId: string; key: string }

function initial(): StoredForm {
  return loadCurrent() ?? { schema: newSchema('header-list', new Date(), { formId: randomFormId(), key: randomKey }), savedAt: '' };
}

/** 빌더 화면 상태: 양식 정의 + 선택 항목 + 펼친 패널 + 검사 결과 + 자동 저장 */
export function useBuilder(start?: StoredForm) {
  const [init] = useState(() => start ?? initial());
  const [schema, dispatch] = useReducer(formReducer, init.schema);
  const [lastExported, setLastExported] = useState<FormSchema | undefined>(init.lastExported);
  const [selected, setSelected] = useState<Selection | null>(null);
  const [openPanel, setOpenPanel] = useState<PanelId | null>('fields');
  const [problems, setProblems] = useState<ExportProblem[]>([]);
  const [saved, setSaved] = useState<boolean | null>(null);

  const save = useCallback(() => {
    // 손대지 않은 제목 없는 새 양식은 최근 양식에 쌓지 않는다
    if (schema === init.schema && !schema.title && !init.savedAt) return null;
    // 열기만 하고 고치지 않았으면 다시 쓰지 않는다 (서버 버전만 올라 다른 탭·기기와 충돌하던 원인)
    if (isSavedAsIs({ schema, lastExported })) return true;
    const now = new Date();
    return saveForm({ schema: { ...schema, updatedAt: now.toISOString() }, lastExported }, now);
  }, [schema, lastExported, init]);
  useEffect(() => {
    const t = setTimeout(() => setSaved(save()), 500);
    return () => clearTimeout(t);
  }, [save]);

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

  /** 내보내기 성공: 내보낸 버전을 지금 양식 버전으로 기록 */
  const markExported = useCallback((exported: FormSchema) => {
    dispatch({ type: 'schema/load', schema: exported });
    setLastExported(exported);
  }, []);

  return {
    markExported,
    /** 화면을 떠나기 전에 바로 저장 (자동 저장은 0.5초 뒤라서) */
    flush: save,
    schema, act, selected, setSelected, selectKey, openPanel, setOpenPanel,
    problems, setProblems, saved, lastExported,
    version: nextVersion(schema, lastExported),
  };
}

export type Builder = ReturnType<typeof useBuilder>;
