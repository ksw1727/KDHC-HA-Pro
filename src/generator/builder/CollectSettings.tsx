import { useState } from 'react';
import type { Builder } from '../state/useBuilder';
import { Button, Seg, cx } from '../ui/ui';
import { parsePastedTable } from './parsePastedTable';

type Table = (string | number | null)[][];
const DEFAULT_DESIGN: Table = [['항목', '내용', '비고'], [null, null, null], [null, null, null]];

/** 칸 하나에 붙여넣으면 그 칸부터 표를 채운다 (엑셀에서 복사한 여러 칸) */
function pasteAt(t: Table, r: number, c: number, text: string): Table {
  const block = parsePastedTable(text);
  const rows = Math.max(t.length, r + block.length);
  const cols = Math.max(t[0]?.length ?? 0, c + Math.max(0, ...block.map((x) => x.length)));
  const out: Table = Array.from({ length: rows }, (_, i) => Array.from({ length: cols }, (_, j) => t[i]?.[j] ?? null));
  block.forEach((row, i) => row.forEach((v, j) => { out[r + i][c + j] = v; }));
  return out;
}

/** 시트 모으기형 양식 그리기: 칸마다 글자를 넣고, 빈칸은 작성자가 채우는 자리 */
function CollectDesigner({ table, onChange }: { table: Table; onChange: (t: Table) => void }) {
  const [cur, setCur] = useState<{ r: number; c: number } | null>(null);
  const cols = table[0]?.length ?? 0;
  const set = (r: number, c: number, v: string) =>
    onChange(table.map((row, i) => row.map((x, j) => (i === r && j === c ? (v === '' ? null : v) : x))));
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-1.5">
        <Button size="sm" onClick={() => onChange([...table, Array(cols).fill(null)])}>+ 행</Button>
        <Button size="sm" onClick={() => onChange(table.map((row) => [...row, null]))}>+ 열</Button>
        <span className="flex-1" />
        <Button size="sm" variant="danger" disabled={!cur || table.length <= 1} onClick={() => { if (cur) { onChange(table.filter((_, i) => i !== cur.r)); setCur(null); } }}>행 삭제</Button>
        <Button size="sm" variant="danger" disabled={!cur || cols <= 1} onClick={() => { if (cur) { onChange(table.map((row) => row.filter((_, j) => j !== cur.c))); setCur(null); } }}>열 삭제</Button>
      </div>
      <div className="overflow-auto rounded-card border border-line">
        <table className="border-collapse text-xs" aria-label="시트 모으기 양식 그리기">
          <tbody>
            {table.map((row, r) => (
              <tr key={r}>
                {row.map((v, c) => (
                  <td key={c} className={cx('border border-line p-0', cur?.r === r && cur?.c === c && 'shadow-[inset_0_0_0_2px_var(--color-pri)]')}>
                    <input aria-label={`${r + 1}행 ${c + 1}열`} value={v ?? ''} placeholder={r === 0 ? '제목' : ''}
                      onFocus={() => setCur({ r, c })}
                      onChange={(e) => set(r, c, e.target.value)}
                      onPaste={(e) => {
                        const t = e.clipboardData.getData('text');
                        if (!/[\t\n]/.test(t.trim())) return;
                        e.preventDefault();
                        onChange(pasteAt(table, r, c, t));
                      }}
                      className={cx('w-24 bg-transparent px-1.5 py-1 outline-none focus:bg-white', v != null && v !== '' ? 'bg-[#eef2f7] font-semibold' : 'bg-white')} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="m-0 text-xs leading-relaxed text-muted">
        칸에 글자를 넣으면 제목·안내 칸이 되고, 비워 둔 칸은 작성자가 채우는 자리예요.<br />
        엑셀에서 여러 칸을 복사해 칸 하나에 붙여넣으면 그 칸부터 한 번에 채워져요. 작성자는 받은 뒤 모양을 자유롭게 고칠 수 있어요.
      </p>
    </div>
  );
}

/** 시트 모으기형 설정 (02-generator.md 2.5) */
export function CollectSettings({ b }: { b: Builder }) {
  const c = b.schema.collect ?? { scope: 'report' as const };
  const designed = !!c.starter;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <span className="text-xs font-semibold text-sub">시트 시작 모양</span>
        <Seg label="시트 시작 모양" value={designed ? 'design' : 'blank'} options={[['blank', '빈 시트로 보내기'], ['design', '제작한 양식으로 보내기']]}
          onChange={(v) => b.act({ type: 'collect/set', patch: { starter: v === 'design' ? (c.starter?.length ? c.starter : DEFAULT_DESIGN) : undefined } })} />
        {designed && <CollectDesigner table={c.starter!} onChange={(t) => b.act({ type: 'collect/set', patch: { starter: t } })} />}
      </div>
      <div className="flex flex-col gap-1.5">
        <span className="text-xs font-semibold text-sub">취합할 때 모을 시트</span>
        <Seg label="모을 시트" value={c.scope} options={[['report', '보고서 시트만 (기본)'], ['all', '파일 안의 모든 시트']]} onChange={(v) => b.act({ type: 'collect/set', patch: { scope: v } })} />
      </div>
      <div className="rounded-btn bg-auto px-2.5 py-1.5 text-xs leading-relaxed text-auto-ink">
        모양을 자유롭게 고칠 수 있어서 칸 검사는 하지 않아요. 시트를 그대로 모아 드려요.<br />사진·도형은 아직 옮겨지지 않아요.
      </div>
    </div>
  );
}
