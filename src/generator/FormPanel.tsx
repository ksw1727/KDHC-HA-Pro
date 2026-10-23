import { useEffect, useRef, useState } from 'react';
import { LAYOUT_LABELS, type FormSchema, type Layout } from '@contract/schema';
import { newSchema, randomFormId, randomKey } from './state/newSchema';
import { loadForm, type StoredForm } from './storage/localForms';
import { openFormJson, openFormXlsx, type OpenResult } from './storage/openForm';
import { BuilderPage } from './pages/BuilderPage';
import { sameForm } from './state/versioning';
import { Button, Dialog } from './ui/ui';

/**
 * AI로 만들기 화면 오른쪽 설정 패널: 대화 속 마지막 양식을 ①~⑤로 고친다 (미리보기는 대화의 양식 카드).
 * 화면끼리는 window 이벤트로 주고받는다.
 *  - 받기 `hanan-moa:select-field` {key}: 카드 미리보기에서 머리글을 눌렀다 → 그 항목을 연다
 *  - 받기 `hanan-moa:form-removed` {formId}: 내 업무공간에서 지운 양식이 열려 있으면 닫는다
 *  - 받기 `hanan-moa:export-form` {schema}: 카드의 [엑셀 내보내기] → 그 양식을 열고 내보내기 창(① 일정 정보부터)을 띄운다
 *  - 보내기 `hanan-moa:form-edit` (FormSchema): 고칠 때마다 → 카드가 바로 따라 바뀐다
 *  - 보내기 `hanan-moa:field-selected` {key}: 고른 항목 → 카드에 표시
 *  - 보내기 `hanan-moa:form-opened` {schema, how}: 패널에서 양식을 새로 열었다 → 대화에 카드를 붙인다
 */
export interface Incoming { schema: FormSchema; at: number; preferStored?: boolean; lastExported?: FormSchema }

const ORDER: Layout[] = ['list', 'matrix', 'header-list', 'fill-in', 'collect', 'free'];
const emit = (name: string, detail: unknown) => window.dispatchEvent(new CustomEvent(name, { detail }));

export function FormPanel({ incoming }: { incoming?: Incoming }) {
  const [open, setOpen] = useState<{ start: StoredForm; at: number } | null>(null);
  const [full, setFull] = useState(false);
  const [focus, setFocus] = useState<{ key: string; at: number }>();
  const [exportReq, setExportReq] = useState<number>();

  // 대화에서 넘어온 양식 (AI가 새로 만들었거나 [패널에서 고치기]). 브라우저에 고친 것이 있으면 그것부터
  useEffect(() => {
    if (!incoming) return;
    // 같은 번호를 쓰는 다른 양식이 저장돼 있으면 그것(과 그 내보내기 기록)은 쓰지 않는다
    const found = loadForm(incoming.schema.formId);
    const stored = found && sameForm(found.schema, incoming.schema) ? found : null;
    setOpen({ at: incoming.at, start: incoming.preferStored && stored ? stored : { schema: incoming.schema, lastExported: incoming.lastExported ?? (stored?.lastExported && sameForm(stored.lastExported, incoming.schema) ? stored.lastExported : undefined), savedAt: '' } });
  }, [incoming]);
  useEffect(() => {
    const on = (e: Event) => setFocus({ key: (e as CustomEvent<{ key: string }>).detail.key, at: Date.now() });
    window.addEventListener('hanan-moa:select-field', on);
    // 카드에서 내보내기: 빌더의 내보내기 창을 거쳐야 기한을 묻고 내보낸 기록이 남는다 (내 업무공간 취합 일정)
    const exp = (e: Event) => {
      const s = (e as CustomEvent<{ schema: FormSchema }>).detail.schema;
      setOpen((o) => {
        if (o && o.start.schema.formId === s.formId) return o;
        const found = loadForm(s.formId);
        return { at: Date.now(), start: found && sameForm(found.schema, s) ? found : { schema: s, savedAt: '' } };
      });
      setFull(false);
      setExportReq(Date.now());
    };
    window.addEventListener('hanan-moa:export-form', exp);
    return () => { window.removeEventListener('hanan-moa:select-field', on); window.removeEventListener('hanan-moa:export-form', exp); };
  }, []);
  const openId = open?.start.schema.formId;
  useEffect(() => {
    const removed = (e: Event) => {
      if ((e as CustomEvent<{ formId: string }>).detail.formId !== openId) return;
      setOpen(null);
      setFull(false);
    };
    window.addEventListener('hanan-moa:form-removed', removed);
    return () => window.removeEventListener('hanan-moa:form-removed', removed);
  }, [openId]);

  const start = (entry: StoredForm, how: 'new' | 'file') => { setOpen({ start: entry, at: Date.now() }); emit('hanan-moa:form-opened', { schema: entry.schema, how }); };
  if (!open) return <EmptyPanel onStart={start} />;

  // [크게 열기]·[패널로 돌아가기]: 다른 쪽이 저장한 양식에서 다시 시작한다
  const reopen = () => { const s = loadForm(open.start.schema.formId); setOpen({ start: s ?? open.start, at: Date.now() }); };
  const common = { start: open.start, onChange: (s: FormSchema) => emit('hanan-moa:form-edit', s), onSelectKey: (key: string | null) => emit('hanan-moa:field-selected', { key }) };
  return (
    <>
      {!full && <BuilderPage key={`${open.start.schema.formId}-${open.at}`} compact focus={focus} exportReq={exportReq} onExportReq={() => setExportReq(undefined)} onExpand={() => { reopen(); setFull(true); }} {...common} />}
      {full && (
        <div className="fixed inset-0 z-40 flex flex-col bg-white" role="dialog" aria-label="양식 크게 보기">
          <div id="app-header-slot" className="flex min-h-[45px] flex-wrap items-center gap-2 border-b border-line px-4 py-1.5" />
          <div className="min-h-0 flex-1">
            <BuilderPage key={`full-${open.at}`} homeLabel="← 패널로 돌아가기" onHome={() => { reopen(); setFull(false); }} {...common} />
          </div>
        </div>
      )}
    </>
  );
}

/** 열린 양식이 없을 때: 대화로 만들기 안내 + 양식 파일 열기 + 빈 양식 */
function EmptyPanel({ onStart }: { onStart: (entry: StoredForm, how: 'new' | 'file') => void }) {
  const [layout, setLayout] = useState<Layout>('list');
  const [err, setErr] = useState('');
  const json = useRef<HTMLInputElement>(null);
  const xlsx = useRef<HTMLInputElement>(null);
  const open = (r: OpenResult) => (r.ok ? onStart(r.entry, 'file') : setErr(r.message));
  return (
    <div className="flex h-full flex-col gap-3 overflow-auto bg-panel p-4">
      <p className="m-0 font-semibold">열린 양식이 없어요</p>
      <p className="m-0 text-sub">왼쪽 대화에서 받고 싶은 내용을 말하면 AI가 양식을 만들고, 여기서 ①~⑤ 설정을 고칠 수 있어요.</p>
      <div className="flex flex-col gap-2 rounded-card border border-line bg-white p-3">
        <b className="text-[13px]">이미 만든 양식 열기</b>
        <Button onClick={() => json.current?.click()}>양식 파일(.form.json) 열기</Button>
        <Button onClick={() => xlsx.current?.click()}>엑셀에서 양식 되살리기</Button>
        <input ref={json} type="file" accept=".json,application/json" hidden aria-label="양식 파일 고르기"
          onChange={async (e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) open(openFormJson(await f.text())); }} />
        <input ref={xlsx} type="file" accept=".xlsx" hidden aria-label="엑셀 파일 고르기"
          onChange={async (e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) open(await openFormXlsx(await f.arrayBuffer())); }} />
      </div>
      <div className="flex flex-col gap-2 rounded-card border border-line bg-white p-3">
        <b className="text-[13px]">AI 없이 빈 양식으로 시작</b>
        <select aria-label="양식 구조" value={layout} onChange={(e) => setLayout(e.target.value as Layout)} className="h-8 rounded-btn border border-line-strong bg-white px-2 text-[13px]">
          {ORDER.map((l) => <option key={l} value={l}>{LAYOUT_LABELS[l]}</option>)}
        </select>
        <Button variant="pri" onClick={() => onStart({ schema: newSchema(layout, new Date(), { formId: randomFormId(), key: randomKey }), savedAt: '' }, 'new')}>빈 양식 만들기</Button>
      </div>
      {err && (
        <Dialog tone="err" title={err} onClose={() => setErr('')} footer={<><span className="flex-1" /><Button variant="pri" onClick={() => setErr('')}>확인</Button></>}>
          <p className="m-0">양식 파일은 한난MOA에서 [양식 파일 저장]으로 만든 .form.json이에요. 엑셀은 한난MOA로 내보낸 빈 양식이나 취합본만 되살릴 수 있어요.</p>
        </Dialog>
      )}
    </div>
  );
}
