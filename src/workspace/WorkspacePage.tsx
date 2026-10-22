import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { LAYOUT_LABELS, type Layout } from '@contract/schema';
import { listForms } from '@gen/storage/localForms';
import { StructureStory } from '@gen/landing/StructureStory';
import { Button, Chip, cx } from '@gen/ui/ui';
import { listLocalAggregations, loadAggregations, type AggregationRecord } from './history';
import { byDeadline, counts, DAY, dayDiff, midnight, weekBars, workItems, type WorkItem } from './plan';

/** 내 업무공간: 취합 일정(만든 날 → 제출 기한), 취합 기다리는 양식, 내가 만든 양식, 취합 이력 (모형 docs/mockups/workspace-landing.html) */

const W = '일월화수목금토';
const md = (d: Date) => `${d.getMonth() + 1}/${d.getDate()}`;
const mdw = (d: Date) => `${md(d)}(${W[d.getDay()]})`;
const counter = (unit: string) => (unit === '담당자' ? '명' : unit === '파일' ? '개' : '곳');
const who = (i: { unit: string; total: number | null }) => (i.total === null ? (i.unit === '파일' ? '제출처 식별 안 함' : `${i.unit}명 직접 입력`) : `${i.unit} ${i.total}${counter(i.unit)}`);

// 양식마다 달력 막대 색 (공공 블루 토큰 안에서)
const TONES = [
  { bg: '#e8f0fc', fg: '#174a96', solid: '#1f5fbf' },
  { bg: '#e5f4ee', fg: '#0f6e56', solid: '#0f6e56' },
  { bg: '#fff5d1', fg: '#7a5a00', solid: '#b58600' },
  { bg: '#fdf1e3', fg: '#9a4a07', solid: '#c4620d' },
];
const DONE_TONE = { bg: '#f1f4f8', fg: '#56616e', solid: '#8a95a2' };

const go = (tab: 'ai' | 'generator' | 'aggregator', formId?: string) => window.dispatchEvent(new CustomEvent('hanan-moa:tab', { detail: { tab, formId } }));
const openForm = (i: WorkItem) => window.dispatchEvent(new CustomEvent('hanan-moa:open-form', { detail: { schema: i.schema, lastExported: i.entry.lastExported } }));

export function WorkspacePage() {
  const today = useMemo(() => midnight(new Date()), []);
  const [aggs, setAggs] = useState<AggregationRecord[]>(listLocalAggregations);
  const [syncError, setSyncError] = useState('');
  useEffect(() => {
    let alive = true;
    void loadAggregations().then((r) => { if (!alive) return; setAggs(r.list); setSyncError(r.error ?? ''); });
    return () => { alive = false; };
  }, []);
  const items = useMemo(() => workItems(listForms(), aggs), [aggs]);
  const c = counts(items, aggs, today);
  const waiting = items.filter((i) => i.state === 'waiting').sort(byDeadline);
  const tone = useMemo(() => {
    const m = new Map<string, typeof TONES[number]>();
    items.filter((i) => i.state === 'waiting').sort((a, b) => a.made.getTime() - b.made.getTime()).forEach((i, n) => m.set(i.schema.formId, TONES[n % TONES.length]));
    return (i: WorkItem) => m.get(i.schema.formId) ?? DONE_TONE;
  }, [items]);
  const [hl, setHl] = useState<string | null>(null);
  const [tab, setTab] = useState<'forms' | 'hist'>('forms');
  const nextDue = waiting.find((i) => i.deadline && i.deadline >= today);

  return (
    <div className="mx-auto flex max-w-[1240px] flex-col gap-5 px-5 pb-12 pt-5">
      <section className="flex flex-wrap items-start gap-4">
        <div>
          <h1 className="m-0 text-[20px] tracking-tight">내 업무공간</h1>
          <p className="m-0 mt-0.5 text-sub">
            {today.getMonth() + 1}월 {today.getDate()}일 {W[today.getDay()]}요일 · 취합 기다리는 양식 {c.waiting}건{c.dueThisWeek ? ` 중 이번 주가 기한인 양식이 ${c.dueThisWeek}건 있어요` : '이 있어요'}.
          </p>
        </div>
        <span className="flex-1" />
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => go('ai')}>AI로 만들기</Button>
          <Button onClick={() => go('aggregator')}>받은 파일 취합하기</Button>
          <Button variant="pri" onClick={() => go('generator')}>＋ 새 양식 만들기</Button>
        </div>
      </section>

      {syncError && <div className="rounded-box border border-[#f3cfa5] bg-warn px-3 py-2 text-warn-ink">{syncError}</div>}

      <section aria-label="한눈에 보기" className="grid grid-cols-2 overflow-hidden rounded-card border border-line md:grid-cols-4">
        <Kpi label="취합 기다리는 양식" value={c.waiting} sub={c.noDeadline ? `내보냈고 아직 취합 전 (기한 없음 ${c.noDeadline}건)` : '내보냈고 아직 취합 전'} />
        <Kpi label="이번 주 제출 기한" value={c.dueThisWeek} tone={c.dueThisWeek ? 'text-err-ink' : undefined} sub={nextDue ? `${mdw(nextDue.deadline!)} ${nextDue.schema.title}` : '이번 주 기한 없음'} />
        <Kpi label="기한 지났는데 취합 전" value={c.overdue} tone={c.overdue ? 'text-warn-ink' : undefined} sub="제출 기한이 지나면 여기로 와요" />
        <Kpi label="이번 달 마친 취합" value={c.doneThisMonth} tone={c.doneThisMonth ? 'text-auto-ink' : undefined} sub="요약은 아래 취합 이력에" />
      </section>

      <section className="grid items-start gap-[18px] lg:grid-cols-[minmax(0,1fr)_340px]">
        <div>
          <div className="mb-2.5 flex flex-wrap items-baseline gap-2">
            <h2 className="m-0 text-[15px]">취합 일정</h2>
            <span className="text-xs text-muted">양식을 만든 날 → 양식에 적은 제출 기한까지 막대로 보여줘요</span>
          </div>
          <Calendar items={items} aggs={aggs} today={today} tone={tone} hl={hl} setHl={setHl} />
        </div>
        <aside>
          <div className="mb-2.5 flex items-baseline gap-2"><h2 className="m-0 text-[15px]">취합 기다리는 양식</h2><span className="text-xs text-muted">{waiting.length}건</span></div>
          <div className="flex flex-col gap-2.5">
            {waiting.length === 0 && (
              <div className="rounded-card border border-dashed border-line-strong bg-panel p-4 text-center text-sub">
                기다리는 양식이 없어요.<br />양식을 엑셀로 내보내면 여기에 올라와요.
              </div>
            )}
            {waiting.map((i) => <WaitCard key={i.schema.formId} i={i} today={today} tone={tone(i)} hl={hl === i.schema.formId} setHl={setHl} />)}
          </div>
        </aside>
      </section>

      <section>
        <div role="tablist" className="mb-3.5 flex gap-[18px] border-b border-line">
          {([['forms', '내가 만든 양식', items.length], ['hist', '취합 이력', aggs.length]] as const).map(([id, label, n]) => (
            <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => setTab(id)}
              className={cx('-mb-px border-b-2 px-0.5 pb-2.5 pt-2 text-[14px]', tab === id ? 'border-pri font-bold text-ink' : 'border-transparent text-sub')}>
              {label}<span className="ml-1 text-xs font-normal text-muted">{n}</span>
            </button>
          ))}
        </div>
        {tab === 'forms' ? <Forms items={items} /> : <History aggs={aggs} items={items} />}
      </section>
    </div>
  );
}

function Kpi({ label, value, sub, tone }: { label: string; value: number; sub: string; tone?: string }) {
  return (
    <div className="flex flex-col gap-0.5 border-line px-4 py-3.5 [&:not(:first-child)]:border-l max-md:[&:nth-child(3)]:border-l-0 max-md:[&:nth-child(n+3)]:border-t">
      <span className="text-xs text-sub">{label}</span>
      <b className={cx('text-[24px] leading-tight tracking-tight', tone)}>{value}<small className="ml-0.5 text-[13px] font-medium text-muted">건</small></b>
      <span className="truncate text-xs text-muted" title={sub}>{sub}</span>
    </div>
  );
}

type Tone = typeof TONES[number];

function Calendar({ items, aggs, today, tone, hl, setHl }: {
  items: WorkItem[]; aggs: AggregationRecord[]; today: Date; tone: (i: WorkItem) => Tone; hl: string | null; setHl: (id: string | null) => void;
}) {
  const [month, setMonth] = useState(() => new Date(today.getFullYear(), today.getMonth(), 1));
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const start = new Date(first.getTime() - first.getDay() * DAY);
  const last = new Date(month.getFullYear(), month.getMonth() + 1, 0);
  const weeks = Math.ceil((dayDiff(last, start) + 1) / 7);
  const move = (n: number) => setMonth(new Date(month.getFullYear(), month.getMonth() + n, 1));
  const title = (i: WorkItem) => `${i.schema.title}\n${who(i)} · ${i.state === 'done' ? '취합함' : '취합 전'}\n${md(i.made)} 만듦 → ${i.deadline ? `${md(i.deadline)} 제출 기한` : '제출 기한 없음'}`;

  return (
    <div className="overflow-hidden rounded-card border border-line bg-white">
      <div className="flex flex-wrap items-center gap-1.5 border-b border-line px-3 py-2.5">
        <Button size="sm" aria-label="이전 달" onClick={() => move(-1)}>‹</Button>
        <h3 className="m-0 mx-1.5 text-[14px]">{month.getFullYear()}년 {month.getMonth() + 1}월</h3>
        <Button size="sm" aria-label="다음 달" onClick={() => move(1)}>›</Button>
        <Button size="sm" className="ml-1" onClick={() => setMonth(new Date(today.getFullYear(), today.getMonth(), 1))}>오늘</Button>
        <div className="ml-auto flex flex-wrap gap-3 text-xs text-sub max-sm:hidden">
          <span className="inline-flex items-center gap-1"><i className="size-[9px] rounded-full border-2 border-pri bg-white" />만든 날</span>
          <span className="inline-flex items-center gap-1"><i className="rounded-[3px] bg-pri px-1 text-[10px] not-italic text-white">기한</i>제출 기한</span>
          <span className="inline-flex items-center gap-1"><i className="rounded-full bg-auto-ink px-1.5 text-[10px] not-italic text-white">✓ 취합</i>취합한 날</span>
        </div>
      </div>
      <div className="grid grid-cols-7 border-b border-line bg-panel text-[11.5px] text-muted">
        {[...W].map((d, n) => <div key={d} className={cx('px-2 py-1.5', n === 0 && 'text-err-ink')}>{d}</div>)}
      </div>
      {Array.from({ length: weeks }, (_, w) => {
        const ws = new Date(start.getTime() + w * 7 * DAY);
        const bars = weekBars(items, ws);
        const marks = aggs.map((a) => ({ a, d: dayDiff(new Date(a.doneAt), ws) })).filter((m) => m.d >= 0 && m.d <= 6);
        return (
          <div key={w} className="relative grid min-h-[84px] auto-rows-min grid-cols-7 border-b border-line pb-1.5 last:border-b-0">
            {Array.from({ length: 7 }, (_, n) => {
              const d = new Date(ws.getTime() + n * DAY);
              const isToday = d.getTime() === today.getTime();
              return (
                <div key={`c${n}`} style={{ gridColumn: n + 1, gridRow: '1 / span 20' }}
                  className={cx('border-line [&:not(:nth-child(7))]:border-r', isToday && 'bg-pri-bg', (n === 0 || n === 6) && !isToday && 'bg-[repeating-linear-gradient(135deg,#fff_0_6px,#f6f8fb_6px_7px)]')} />
              );
            })}
            {Array.from({ length: 7 }, (_, n) => {
              const d = new Date(ws.getTime() + n * DAY);
              const isToday = d.getTime() === today.getTime();
              return (
                <div key={`n${n}`} style={{ gridColumn: n + 1, gridRow: 1 }}
                  className={cx('pointer-events-none z-[1] px-2 pb-0.5 pt-1 text-xs', d.getMonth() !== month.getMonth() ? 'text-line-strong' : n === 0 ? 'text-err-ink' : 'text-sub')}>
                  {isToday ? <><b className="inline-grid h-5 min-w-5 place-items-center rounded-full bg-pri px-1 text-[11.5px] text-white">{d.getDate()}</b><span className="ml-1 text-[11px] font-semibold text-pri">오늘</span></> : d.getDate()}
                </div>
              );
            })}
            {marks.map(({ a, d }) => (
              <span key={a.id} title={`${a.title} · ${md(new Date(a.doneAt))} 취합`} style={{ gridColumn: d + 1, gridRow: 1 }}
                className="z-[3] mr-1.5 mt-1 self-start justify-self-end whitespace-nowrap rounded-full bg-auto-ink px-1.5 text-[10.5px] font-bold leading-[17px] text-white">✓ 취합</span>
            ))}
            {bars.map((b, n) => {
              const t = b.item.state === 'done' ? DONE_TONE : tone(b.item);
              const id = b.item.schema.formId;
              return (
                <button key={`${id}${n}`} type="button" title={title(b.item)} onClick={() => openForm(b.item)}
                  onMouseEnter={() => setHl(id)} onMouseLeave={() => setHl(null)}
                  style={{ gridColumn: `${b.from + 1} / ${b.to + 2}`, gridRow: n + 2, background: t.bg, color: t.fg, outline: hl === id ? `2px solid ${t.fg}` : undefined, outlineOffset: -1 }}
                  className={cx('z-[2] mx-[3px] mt-0.5 flex h-5 min-w-0 items-center gap-1.5 overflow-hidden whitespace-nowrap rounded px-1.5 text-left text-[11.5px] font-semibold',
                    !b.starts && 'ml-0 rounded-l-none', !b.ends && 'mr-0 rounded-r-none', b.item.state === 'done' && 'opacity-60')}>
                  {b.starts && <i className="size-2 flex-none rounded-full border-2 border-current bg-white" />}
                  <span className="min-w-0 flex-1 truncate">{b.item.schema.title || '제목 없는 양식'}</span>
                  {b.ends && b.item.deadline && <span className="flex-none rounded-[3px] px-1 text-[10.5px] text-white" style={{ background: t.solid }}>기한</span>}
                </button>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

function WaitCard({ i, today, tone, hl, setHl }: { i: WorkItem; today: Date; tone: Tone; hl: boolean; setHl: (id: string | null) => void }) {
  const left = i.deadline ? dayDiff(i.deadline, today) : null;
  const urgent = left !== null && left <= 2;
  const passed = i.deadline && i.deadline > i.made ? Math.max(0, Math.min(1, dayDiff(today, i.made) / dayDiff(i.deadline, i.made))) : 0;
  return (
    <article onMouseEnter={() => setHl(i.schema.formId)} onMouseLeave={() => setHl(null)}
      className={cx('flex flex-col gap-2 rounded-card border bg-white px-3.5 py-3', hl ? 'border-pri shadow-[0_0_0_2px_#b9cff2]' : 'border-line')}>
      <div className="flex items-center gap-1.5">
        <i className="h-4 w-1 flex-none rounded-sm" style={{ background: tone.solid }} />
        <b className="min-w-0 flex-1 truncate text-[14px]" title={i.schema.title}>{i.schema.title || '제목 없는 양식'}</b>
        <span className={cx('rounded px-1.5 text-xs font-bold leading-5', urgent ? 'bg-err text-err-ink' : 'bg-chip text-sub')}>
          {left === null ? '기한 없음' : left > 0 ? `D-${left}` : left === 0 ? 'D-day' : `D+${-left}`}
        </span>
      </div>
      <div className="text-xs text-muted">{LAYOUT_LABELS[i.schema.layout]} · {who(i)}</div>
      {i.deadline ? (
        <div className="flex items-center gap-2.5 text-xs text-sub">
          <span>{md(i.made)} 만듦</span>
          <div className="h-1.5 flex-1 overflow-hidden rounded-sm bg-chip"><i className="block h-full opacity-60" style={{ width: `${passed * 100}%`, background: tone.solid }} /></div>
          <span>{mdw(i.deadline)} 기한</span>
        </div>
      ) : (
        <div className="flex items-center gap-2 text-xs text-sub">
          <span>{md(i.made)} 만듦 · 제출 기한을 적지 않았어요</span><span className="flex-1" />
          <button type="button" className="text-pri" onClick={() => openForm(i)}>기한 넣기</button>
        </div>
      )}
      <div className="rounded-box bg-panel px-2.5 py-1.5 text-xs text-sub"><b className="text-ink">취합 전</b> · 받은 파일을 넣으면 누가 냈는지 알려줘요</div>
      <div className="flex gap-1.5">
        <Button size="sm" variant="pri" onClick={() => go('aggregator', i.schema.formId)}>받은 파일 취합하기</Button>
        <Button size="sm" onClick={() => openForm(i)}>양식 열기</Button>
      </div>
    </article>
  );
}

const LAYOUT_FILTERS: Layout[] = ['matrix', 'list', 'header-list', 'fill-in', 'collect', 'free'];

function Forms({ items }: { items: WorkItem[] }) {
  const [only, setOnly] = useState<Layout | null>(null);
  const shown = items.filter((i) => !only || i.schema.layout === only);
  const used = LAYOUT_FILTERS.filter((l) => items.some((i) => i.schema.layout === l));
  return (
    <>
      {used.length > 1 && (
        <Filters>
          <FilterBtn on={!only} onClick={() => setOnly(null)}>전체</FilterBtn>
          {used.map((l) => <FilterBtn key={l} on={only === l} onClick={() => setOnly(l)}>{LAYOUT_LABELS[l]}</FilterBtn>)}
        </Filters>
      )}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <button type="button" onClick={() => go('generator')}
          className="flex min-h-[200px] flex-col items-center justify-center gap-2 rounded-card border border-dashed border-line-strong bg-panel p-4 text-center text-sub hover:bg-pri-bg">
          <span className="grid size-9 place-items-center rounded-full border border-pri-line bg-white text-[20px] text-pri">＋</span>
          <b className="text-ink">새 양식 만들기</b>
          <span className="text-xs">AI에게 말로 부탁하거나<br />쓰던 엑셀을 올려서 시작해요</span>
        </button>
        {shown.map((i) => {
          const last = i.aggs[0];
          const status = i.state === 'draft' ? ['내보내기 전', 'bg-warn-ink'] : i.state === 'waiting' ? ['취합 전', 'bg-auto-ink'] : [`${md(new Date(last.doneAt))} 취합함${i.aggs.length > 1 ? ` · 모두 ${i.aggs.length}번` : ''}`, 'bg-line-strong'];
          return (
            <article key={i.schema.formId} className="flex flex-col overflow-hidden rounded-card border border-line bg-white hover:border-pri">
              <div className="pointer-events-none h-[78px] overflow-hidden border-b border-line bg-panel p-1.5" aria-hidden>
                <div className="origin-top-left" style={{ width: '200%', transform: 'scale(.5)' }}><StructureStory layout={i.schema.layout} size="sm" still /></div>
              </div>
              <div className="flex flex-1 flex-col gap-1 p-3">
                <div className="flex gap-1"><Chip tone="pri">{LAYOUT_LABELS[i.schema.layout]}</Chip>{i.state === 'draft' && <Chip tone="warn">내보내기 전</Chip>}</div>
                <b className="truncate text-[13.5px]" title={i.schema.title}>{i.schema.title || '제목 없는 양식'}</b>
                <div className="text-xs text-muted">{who(i)} · v{i.schema.formVersion} · {md(i.made)} 만듦{i.deadline ? ` · 기한 ${md(i.deadline)}` : ''}</div>
                <div className="flex items-center gap-1.5 text-xs text-sub"><i className={cx('size-1.5 rounded-full', status[1])} />{status[0]}</div>
                <div className="mt-auto flex flex-wrap gap-1.5 pt-1.5">
                  {i.state === 'draft'
                    ? <Button size="sm" variant="pri" onClick={() => openForm(i)}>이어서 고치기</Button>
                    : <><Button size="sm" onClick={() => openForm(i)}>열기</Button><Button size="sm" onClick={() => go('aggregator', i.schema.formId)}>취합하기</Button></>}
                </div>
              </div>
            </article>
          );
        })}
      </div>
    </>
  );
}

function History({ aggs, items }: { aggs: AggregationRecord[]; items: WorkItem[] }) {
  const [only, setOnly] = useState<'all' | 'full' | 'part'>('all');
  const full = (a: AggregationRecord) => a.total === null || a.missing.length === 0;
  const shown = aggs.filter((a) => only === 'all' || (only === 'full') === full(a));
  return (
    <>
      <Filters>
        <FilterBtn on={only === 'all'} onClick={() => setOnly('all')}>전체</FilterBtn>
        <FilterBtn on={only === 'full'} onClick={() => setOnly('full')}>모두 받음</FilterBtn>
        <FilterBtn on={only === 'part'} onClick={() => setOnly('part')}>일부만 받음</FilterBtn>
        <span className="flex-1" />
        <span className="text-xs text-muted">취합 요약만 계정에 저장돼요 · 결과 엑셀은 취합할 때 내려받은 파일을 쓰세요</span>
      </Filters>
      {shown.length === 0 && <div className="rounded-card border border-dashed border-line-strong bg-panel p-6 text-center text-sub">{aggs.length ? '조건에 맞는 기록이 없어요.' : '아직 취합한 기록이 없어요. 취합을 마치면 여기에 요약이 남아요.'}</div>}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {shown.map((a) => {
          const item = items.find((i) => i.schema.formId === a.formId);
          const n = counter(a.unit);
          return (
            <article key={a.id} className="flex flex-col overflow-hidden rounded-card border border-line bg-white">
              <div className="flex flex-col gap-1 px-3.5 pb-2.5 pt-3">
                <div className="flex items-center gap-1.5">
                  <b className="min-w-0 flex-1 truncate text-[13.5px]" title={a.title}>{a.title || '제목 없는 양식'}</b>
                  {a.total !== null && (a.missing.length ? <Chip tone="warn">{a.missing.length}{n} 못 받음</Chip> : <Chip tone="auto">모두 받음</Chip>)}
                </div>
                <div className="text-xs text-muted">{md(new Date(a.doneAt))} 취합 · {LAYOUT_LABELS[a.layout]} · v{a.formVersion}{a.total !== null ? ` · ${a.unit} ${a.total}${n}` : ''}</div>
              </div>
              <div className="grid grid-cols-3 border-y border-line">
                <Num label="제출">{a.total !== null ? `${a.got}/${a.total}` : `${a.got}${n}`}</Num>
                <Num label={a.layout === 'collect' ? '모은 시트' : '모은 줄'}>{a.layout === 'collect' ? a.got : a.rows}</Num>
                <Num label="확인한 칸" warn={a.checked > 0}>{a.checked}</Num>
              </div>
              <div className="flex flex-wrap items-center gap-1 px-3.5 pt-2.5 text-xs text-sub">
                {a.total === null ? <span>제출처 목록 없이 받은 파일 {a.got}개</span>
                  : a.missing.length ? <>안 낸 {a.unit === '담당자' ? '사람' : '곳'} {a.missing.slice(0, 6).map((m) => <Chip key={m} tone="err">{m}</Chip>)}{a.missing.length > 6 && <Chip>+{a.missing.length - 6}</Chip>}</>
                  : <span className="text-auto-ink">✓ 모든 {a.unit}에서 받았어요</span>}
                {!a.verifyOk && <Chip tone="err">검산 불일치</Chip>}
              </div>
              <div className="mt-auto flex flex-wrap gap-1.5 px-3.5 pb-3 pt-2.5">
                <Button size="sm" onClick={() => go('aggregator', a.formId)}>받은 파일로 다시 취합</Button>
                {item && <Button size="sm" variant="ghost" className="text-pri" onClick={() => openForm(item)}>양식 열기</Button>}
              </div>
            </article>
          );
        })}
      </div>
    </>
  );
}

function Num({ label, children, warn }: { label: string; children: ReactNode; warn?: boolean }) {
  return <div className="px-2.5 py-2 [&:not(:first-child)]:border-l [&:not(:first-child)]:border-line"><span className="block text-[11px] text-muted">{label}</span><b className={cx('text-[15px]', warn && 'text-warn-ink')}>{children}</b></div>;
}
function Filters({ children }: { children: ReactNode }) { return <div className="mb-3 flex flex-wrap items-center gap-1.5">{children}</div>; }
function FilterBtn({ on, onClick, children }: { on: boolean; onClick: () => void; children: ReactNode }) {
  return <button type="button" aria-pressed={on} onClick={onClick}
    className={cx('rounded-full border px-2.5 py-0.5 text-xs', on ? 'border-pri bg-pri-bg font-semibold text-pri-ink' : 'border-line bg-white text-sub')}>{children}</button>;
}
