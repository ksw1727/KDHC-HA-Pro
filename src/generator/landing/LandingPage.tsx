import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Layout } from '@contract/schema';
import { LAYOUT_LABELS, orgLabel } from '@contract/schema';
import { StructureStory } from './StructureStory';
import { duplicateForm, openFormJson, openFormXlsx, shortTime, type OpenResult } from './openForm';
import { listForms, removeForm, saveForm, type StoredForm } from '../storage/localForms';
import { nextVersion } from '../state/versioning';
import { randomFormId } from '../state/newSchema';
import { exportFormJson } from '../export/exportJson';
import { Button, Chip, Dialog, TextInput } from '../ui/ui';

const cx = (...c: (string | false | undefined)[]) => c.filter(Boolean).join(' ');

/** 구조 카드 순서와 설명 (02-generator.md 2.1) */
const ORDER: Layout[] = ['list', 'matrix', 'header-list', 'fill-in', 'collect', 'free'];
const INFO: Record<Layout, { one: string; ex: string[] }> = {
  list: { one: '지사마다 여러 줄을 적어요', ex: ['교육 참가자 명단', '물품 구매 내역', '차량 운행 기록'] },
  matrix: { one: '칸 제목이 정해진 표에 숫자만 적어요', ex: ['학년×성별 인원표', '월별 실적표', '시설별 점검 수'] },
  'header-list': { one: '지사 정보는 한 번, 명단은 여러 줄 적어요', ex: ['담당자 + 참가자 명단', '기관 정보 + 구매 내역'] },
  'fill-in': { one: '본사가 만든 표의 빈칸만 지사가 채워요', ex: ['사업별 지사 예산 배분표', '지사별 목표 확인표'] },
  collect: { one: '모양이 제각각인 보고서를 시트째 모아요', ex: ['안전점검 결과 보고', '부서별 추진 실적'] },
  free: { one: '표를 직접 그리고 입력할 곳을 지정해요', ex: ['쓰던 서식 그대로', '점검표·확인서'] },
};
/** "목록형으로", "시트 모으기형으로" — 모두 '형'으로 끝나 받침이 있다 */
const withEuro = (l: Layout) => `${LAYOUT_LABELS[l]}으로`;

function useHeaderSlot() {
  const [el, setEl] = useState<HTMLElement | null>(null);
  useEffect(() => setEl(document.getElementById('app-header-slot')), []);
  return el;
}

/** 양식 만들기 첫 화면: 구조 고르기 + 이미 만든 양식 열기 + 최근 양식 */
export function LandingPage({ onNew, onOpen }: { onNew: (layout: Layout) => void; onOpen: (entry: StoredForm) => void }) {
  const slot = useHeaderSlot();
  const [preview, setPreview] = useState<Layout | null>(null);
  const [reco, setReco] = useState<Layout | null>(null);
  const [quizOpen, setQuizOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [forms, setForms] = useState(() => listForms());
  const [all, setAll] = useState(false);
  const [err, setErr] = useState('');

  const recommend = (l: Layout) => {
    setReco(l);
    setPreview(l);
  };
  const open = (r: OpenResult) => (r.ok ? onOpen(r.entry) : setErr(r.message));
  const refresh = () => setForms(listForms());

  return (
    <div className="h-full overflow-auto bg-panel">
      {slot && createPortal(<><span className="flex-1" /><span className="text-xs text-muted">파일은 이 컴퓨터 밖으로 나가지 않아요</span></>, slot)}
      <div className="mx-auto flex max-w-[1240px] flex-col gap-4 px-6 py-6">
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-0 flex-1">
            <h1 className="m-0 text-[22px] font-bold">어떤 모양의 양식을 만들까요?</h1>
            <p className="m-0 mt-0.5 text-sub">카드를 누르면 지사가 작성하고 취합되는 과정을 크게 보여드려요.</p>
          </div>
          <Button variant="ghost" className="text-pri" aria-expanded={quizOpen} onClick={() => setQuizOpen((v) => !v)}>잘 모르겠어요 · 질문으로 고르기 {quizOpen ? '▴' : '▾'}</Button>
          <Button aria-expanded={drawerOpen} onClick={() => setDrawerOpen((v) => !v)}>이미 만든 양식 열기 {drawerOpen ? '▴' : '▾'}</Button>
        </div>

        {forms.length === 0 && (
          <div className="rounded-box border border-pri-line bg-pri-bg px-3.5 py-2.5 text-pri-ink">
            처음 오셨네요. 한난MOA는 <b>① 양식 만들기 → ② 메신저·메일로 보내고 받기 → ③ 취합하기</b> 순서로 씁니다. 어떤 구조가 맞는지 모르겠으면 오른쪽 위 "질문으로 고르기"를 눌러 보세요.
          </div>
        )}

        {drawerOpen && (
          <div className="grid gap-3 md:grid-cols-2">
            <DropZone icon="{ }" title="양식 파일 불러오기" hint="저장해 둔 .form.json을 끌어다 놓거나 파일 선택" accept=".json,application/json"
              onFile={async (f) => open(openFormJson(await f.text()))} />
            <DropZone icon="⤺" title="엑셀에서 양식 되살리기" hint="한난MOA로 만든 빈 양식·취합본 .xlsx를 끌어다 놓거나 파일 선택" accept=".xlsx"
              onFile={async (f) => open(await openFormXlsx(await f.arrayBuffer()))} />
          </div>
        )}

        {quizOpen && <Quiz onPick={recommend} />}

        <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
          {ORDER.map((l) => (
            <button key={l} type="button" aria-label={`${LAYOUT_LABELS[l]} 크게 보기`} onClick={() => setPreview(l)}
              className={cx('flex flex-col overflow-hidden rounded-card border bg-white text-left outline-none transition-shadow hover:border-pri hover:shadow-[0_0_0_2px_#b9cff2] focus-visible:ring-3 focus-visible:ring-pri-bg',
                reco === l ? 'border-pri shadow-[0_0_0_2px_#b9cff2]' : 'border-line')}>
              <div className="pointer-events-none h-[78px] overflow-hidden border-b border-line bg-panel p-1.5" aria-hidden>
                <div className="origin-top-left" style={{ width: '200%', transform: 'scale(.5)' }}><StructureStory layout={l} size="sm" still /></div>
              </div>
              <div className="flex flex-1 flex-col gap-1 p-2.5">
                <div className="flex items-center gap-1.5 font-bold">
                  {LAYOUT_LABELS[l]}
                  {reco === l && <Chip tone="pri">추천</Chip>}
                </div>
                <div className="text-[12.5px] text-sub">{INFO[l].one}</div>
                <div className="mt-auto flex flex-wrap gap-1 pt-1">{INFO[l].ex.map((e) => <span key={e} className="rounded bg-chip px-1.5 text-[11px] text-sub">{e}</span>)}</div>
              </div>
            </button>
          ))}
        </div>

        {forms.length > 0 && (
          <Recent forms={all ? forms : forms.slice(0, 4)} total={forms.length} all={all} onToggleAll={() => setAll((v) => !v)}
            onOpen={onOpen} onDuplicate={(e) => onOpen(duplicateForm(e.schema, new Date(), randomFormId()))}
            onRename={(e, title) => { saveForm({ ...e, schema: { ...e.schema, title } }, new Date(e.savedAt || Date.now())); refresh(); }}
            onDelete={(e) => { removeForm(e.schema.formId); refresh(); }} />
        )}
      </div>

      {preview && <StoryDialog layout={preview} onClose={() => setPreview(null)} onStart={() => onNew(preview)} />}

      {err && (
        <Dialog tone="err" title={err} onClose={() => setErr('')} footer={<><span className="flex-1" /><Button variant="pri" onClick={() => setErr('')}>확인</Button></>}>
          <p className="m-0">양식 파일은 한난MOA에서 [양식 파일 저장]으로 만든 .form.json이에요. 엑셀은 한난MOA로 내보낸 빈 양식이나 취합본만 되살릴 수 있어요.</p>
        </Dialog>
      )}
    </div>
  );
}

/** 카드를 누르면 뜨는 크게 보기: 3컷 이야기 + [다시 보기]·[멈춤] + 시작 버튼 */
function StoryDialog({ layout, onClose, onStart }: { layout: Layout; onClose: () => void; onStart: () => void }) {
  const [paused, setPaused] = useState(false);
  const [run, setRun] = useState(0);
  return (
    <Dialog wide title={`${LAYOUT_LABELS[layout]}은 이렇게 쓰여요`} onClose={onClose}
      footer={<>
        <span className="text-xs text-muted">구조는 만드는 중에도 ② 양식 구조에서 바꿀 수 있어요.</span>
        <span className="flex-1" />
        <Button variant="pri" onClick={onStart}>{withEuro(layout)} 새 양식 만들기 →</Button>
      </>}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sub">{INFO[layout].one}</span>
        <span className="flex-1" />
        <Button size="sm" onClick={() => { setRun((n) => n + 1); setPaused(false); }}>↻ 다시 보기</Button>
        <Button size="sm" aria-pressed={paused} onClick={() => setPaused((v) => !v)}>{paused ? '▶ 재생' : '❚❚ 멈춤'}</Button>
      </div>
      <div className="text-[13px] [&_table]:text-[12px] [&_td]:h-[22px]">
        <StructureStory key={run} layout={layout} paused={paused} />
      </div>
    </Dialog>
  );
}

/** 질문으로 고르기: 무엇을 받나요? → (명단이면) 위에 지사 정보도 받나요? */
function Quiz({ onPick }: { onPick: (l: Layout) => void }) {
  const [q1, setQ1] = useState<string | null>(null);
  const [q2, setQ2] = useState<Layout | null>(null);
  const opt = (on: boolean, title: string, sub: string, onClick: () => void) => (
    <button key={title} type="button" aria-pressed={on} onClick={onClick}
      className={cx('rounded-box border px-3 py-2 text-left outline-none focus-visible:ring-3 focus-visible:ring-pri-bg', on ? 'border-pri bg-pri-bg' : 'border-line bg-white hover:bg-panel')}>
      <div className={cx('font-semibold', on && 'text-pri-ink')}>{title}</div><div className="text-xs text-muted">{sub}</div>
    </button>
  );
  const Q1: [string, string, string, Layout | null][] = [
    ['rows', '여러 줄 명단이나 내역', '사람, 물품, 건별 기록', null],
    ['matrix', '정해진 표에 숫자만', '칸 제목이 미리 정해진 통계표', 'matrix'],
    ['fill', '우리가 만든 표의 빈칸만', '대부분 채워 두고 일부만 받기', 'fill-in'],
    ['collect', '모양이 제각각인 보고서', '칸 규칙 없이 시트째 모으기', 'collect'],
    ['free', '쓰던 서식 모양 그대로', '표를 직접 그리고 입력할 곳 지정', 'free'],
  ];
  return (
    <section aria-label="질문으로 고르기" className="flex flex-col gap-3 rounded-card border border-line bg-white p-3.5">
      <b>지사·부서에서 무엇을 받나요?</b>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
        {Q1.map(([id, t, sub, l]) => opt(q1 === id, t, sub, () => { setQ1(id); setQ2(null); if (l) onPick(l); }))}
      </div>
      {q1 === 'rows' && (
        <>
          <b>명단 위에 지사 정보(담당자, 연락처 등)도 한 번 받나요?</b>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {opt(q2 === 'list', '아니요, 명단만 받아요', '→ 목록형', () => { setQ2('list'); onPick('list'); })}
            {opt(q2 === 'header-list', '네, 위쪽에 한 번 받아요', '→ 혼합형', () => { setQ2('header-list'); onPick('header-list'); })}
          </div>
        </>
      )}
    </section>
  );
}

function DropZone({ icon, title, hint, accept, onFile }: { icon: string; title: string; hint: string; accept: string; onFile: (f: File) => Promise<void> }) {
  const ref = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const take = async (f?: File) => {
    if (!f) return;
    setBusy(true);
    try { await onFile(f); } finally { setBusy(false); }
  };
  return (
    <div onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); void take(e.dataTransfer.files[0]); }}
      className={cx('flex items-center gap-3 rounded-card border-2 border-dashed bg-white p-3.5', over ? 'border-pri bg-pri-bg' : 'border-line-strong')}>
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-box bg-pri-bg font-bold text-pri" aria-hidden>{icon}</span>
      <div className="min-w-0 flex-1"><div className="font-semibold">{title}</div><div className="text-xs text-muted">{hint}</div></div>
      <Button disabled={busy} onClick={() => ref.current?.click()}>{busy ? '읽는 중…' : '파일 선택'}</Button>
      <input ref={ref} type="file" accept={accept} className="hidden" aria-label={title}
        onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; void take(f); }} />
    </div>
  );
}

function Recent({ forms, total, all, onToggleAll, onOpen, onDuplicate, onRename, onDelete }: {
  forms: StoredForm[]; total: number; all: boolean; onToggleAll: () => void;
  onOpen: (e: StoredForm) => void; onDuplicate: (e: StoredForm) => void; onRename: (e: StoredForm, title: string) => void; onDelete: (e: StoredForm) => void;
}) {
  const now = new Date();
  const [renaming, setRenaming] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<StoredForm | null>(null);
  const where = (e: StoredForm) => e.schema.org.mode === 'none' ? '식별 안 함' : `${orgLabel(e.schema)} ${e.schema.org.orgs?.length ?? 0}곳`;
  return (
    <section aria-label="최근 양식" className="flex flex-col gap-2 pt-2">
      <div className="flex items-center gap-2">
        <b className="text-[15px]">최근 양식</b>
        <span className="text-xs text-muted">이 브라우저에 저장됨</span>
        <span className="flex-1" />
        {total > 4 && <Button variant="ghost" className="text-pri" onClick={onToggleAll}>{all ? '접기' : `모두 보기 (${total}) →`}</Button>}
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {forms.map((e) => {
          const s = e.schema;
          const notExported = !e.lastExported;
          return (
            <article key={s.formId} className="flex flex-col gap-1.5 rounded-card border border-line bg-white p-3">
              {renaming === s.formId ? (
                <form onSubmit={(ev) => { ev.preventDefault(); const t = new FormData(ev.currentTarget).get('t'); onRename(e, String(t ?? '').trim()); setRenaming(null); }} className="flex gap-1">
                  <TextInput name="t" aria-label="새 이름" defaultValue={s.title} autoFocus className="flex-1" />
                  <Button size="sm" type="submit">확인</Button>
                </form>
              ) : (
                <b className="truncate" title={s.title}>{s.title || '제목 없는 양식'}</b>
              )}
              <div className="text-xs text-muted">{LAYOUT_LABELS[s.layout]} · {where(e)} · v{nextVersion(s, e.lastExported)} · {shortTime(s.updatedAt || e.savedAt, now)}</div>
              <div className="mt-auto flex flex-wrap items-center gap-1.5 pt-1">
                {notExported && <Chip tone="warn">내보내기 전</Chip>}
                <Button size="sm" variant={notExported ? 'pri' : 'default'} onClick={() => onOpen(e)}>{notExported ? '이어서 고치기' : '열기'}</Button>
                <Button size="sm" onClick={() => onDuplicate(e)}>복제</Button>
                {all && (
                  <>
                    <Button size="sm" variant="ghost" onClick={() => setRenaming(s.formId)}>이름 바꾸기</Button>
                    <Button size="sm" variant="ghost" onClick={() => exportFormJson(s)}>양식 파일로 저장</Button>
                    <Button size="sm" variant="ghost" className="text-err-ink" onClick={() => setDeleting(e)}>삭제</Button>
                  </>
                )}
              </div>
            </article>
          );
        })}
      </div>
      {deleting && (
        <Dialog tone="err" title="이 양식을 지울까요?" onClose={() => setDeleting(null)}
          footer={<><span className="flex-1" /><Button onClick={() => setDeleting(null)}>취소</Button><Button variant="danger" onClick={() => { onDelete(deleting); setDeleting(null); }}>삭제</Button></>}>
          <p className="m-0">"{deleting.schema.title || '제목 없는 양식'}"을 이 브라우저에서 지워요. 이미 내보낸 엑셀 파일과 저장해 둔 양식 파일은 그대로 남아요.</p>
        </Dialog>
      )}
    </section>
  );
}
