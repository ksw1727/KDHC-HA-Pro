import { useState } from 'react';
import type { Layout } from '@contract/schema';
import { LAYOUT_LABELS } from '@contract/schema';
import type { Builder } from '../state/useBuilder';
import { changeLayout } from '../state/changeLayout';
import { randomKey } from '../state/newSchema';
import { Button, Dialog } from '../ui/ui';
import { StructureStory } from '../landing/StructureStory';

const ORDER: Layout[] = ['list', 'matrix', 'header-list', 'fill-in', 'collect'];
const ONE_LINE: Record<Layout, string> = {
  list: '지사마다 여러 줄을 적어요',
  matrix: '칸 제목이 정해진 표에 숫자만 적어요',
  'header-list': '지사 정보는 한 번, 명단은 여러 줄',
  'fill-in': '본사가 만든 표의 빈칸만 채워요',
  collect: '모양이 제각각인 보고서를 시트째 모아요',
};

/** ② 양식 구조. 지워지는 것이 있으면 확인 창 (02-generator.md 2.1 마지막 줄) */
export function LayoutPanel({ b }: { b: Builder }) {
  const [pending, setPending] = useState<{ to: Layout; lost: string[]; notes: string[]; keys: string[] } | null>(null);
  const [hover, setHover] = useState<Layout | null>(null);
  const shown = hover ?? b.schema.layout;
  const choose = (to: Layout) => {
    if (to === b.schema.layout) return;
    const keys = Array.from({ length: 8 }, randomKey);
    const pool = [...keys];
    const r = changeLayout(b.schema, to, () => pool.shift()!);
    const go = () => { b.act({ type: 'layout/change', layout: to, keys }); b.setSelected(null); };
    if (r.lost.length || r.lostNotes.length) setPending({ to, lost: r.lost.map((f) => f.label), notes: r.lostNotes, keys });
    else go();
  };
  return (
    <>
      <div className="grid grid-cols-1 gap-1.5" role="radiogroup" aria-label="양식 구조">
        {ORDER.map((l) => (
          <button key={l} type="button" role="radio" aria-checked={b.schema.layout === l} onClick={() => choose(l)}
            onMouseEnter={() => setHover(l)} onMouseLeave={() => setHover(null)} onFocus={() => setHover(l)} onBlur={() => setHover(null)}
            className={'flex items-center gap-2 rounded-box border px-2.5 py-1.5 text-left ' + (b.schema.layout === l ? 'border-pri bg-pri-bg' : 'border-line hover:border-pri-line')}>
            <span className={'inline-block h-3.5 w-3.5 rounded-full border-[1.5px] ' + (b.schema.layout === l ? 'border-pri bg-pri shadow-[inset_0_0_0_2px_#fff]' : 'border-line-strong')} />
            <b className={b.schema.layout === l ? 'text-pri-ink' : ''}>{LAYOUT_LABELS[l]}</b>
            <span className="text-xs text-muted">{ONE_LINE[l]}</span>
          </button>
        ))}
      </div>
      <div className="rounded-card border border-line bg-panel p-2">
        <div className="mb-1 flex items-center text-xs"><b>{LAYOUT_LABELS[shown]}</b><span className="ml-1.5 text-muted">{hover && hover !== b.schema.layout ? '미리 보기 · 누르면 바뀌어요' : '지금 구조'}</span></div>
        <StructureStory layout={shown} size="sm" />
      </div>
      {pending && (
        <Dialog title={`${LAYOUT_LABELS[pending.to]}으로 바꿀까요?`} onClose={() => setPending(null)}
          footer={<><span className="flex-1" /><Button onClick={() => setPending(null)}>취소</Button><Button variant="pri" onClick={() => { b.act({ type: 'layout/change', layout: pending.to, keys: pending.keys }); b.setSelected(null); setPending(null); }}>{LAYOUT_LABELS[pending.to]}으로 바꾸기</Button></>}>
          <StructureStory layout={pending.to} />
          <p className="m-0">바꾸면 아래 내용은 옮길 곳이 없어서 지워져요.</p>
          <ul className="m-0 pl-5">
            {pending.lost.length > 0 && <li>항목 {pending.lost.length}개: {pending.lost.join(', ')}</li>}
            {pending.notes.map((n) => <li key={n}>{n}</li>)}
          </ul>
        </Dialog>
      )}
    </>
  );
}
