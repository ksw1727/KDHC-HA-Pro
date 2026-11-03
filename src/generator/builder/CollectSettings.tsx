import { useRef, useState } from 'react';
import { sheetSize, type CollectSheet } from '@contract/collectSheet';
import type { Builder } from '../state/useBuilder';
import { sheetCopyFromBytes, visibleSheetNames } from '../state/sheetCopy';
import { Button, Seg, cx } from '../ui/ui';
import { parsePastedTable } from './parsePastedTable';
import { openWorkbook } from '../../../tools/excelOpen';

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

/** 쓰던 엑셀 시트 그대로: 파일을 고르면 그 시트를 값·서식·합친 칸·열 너비 그대로 빈 양식으로 쓴다 */
function SheetFromExcel({ sheet, onChange }: { sheet?: CollectSheet; onChange: (s: CollectSheet | undefined) => void }) {
  const pick = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<{ name: string; bytes: Uint8Array; sheets: string[] } | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const load = async (f: File) => {
    setErr(''); setBusy(true);
    try {
      const o = await openWorkbook(new Uint8Array(await f.arrayBuffer()), f.name);
      const sheets = await visibleSheetNames(o.bytes);
      if (!sheets.length) throw new Error('보이는 시트가 없어요');
      setFile({ name: f.name, bytes: o.bytes, sheets });
      onChange((await sheetCopyFromBytes(o.bytes, f.name, sheets[0])) ?? undefined);
    } catch (e) { setErr(`엑셀을 읽지 못했어요: ${(e as Error).message}`); } finally { setBusy(false); }
  };
  const size = sheet ? sheetSize(sheet) : null;
  return (
    <div className="flex flex-col gap-1.5 rounded-btn border border-line bg-white p-2.5 text-xs">
      <input ref={pick} type="file" hidden accept=".xlsx,.xlsm,.xls" onChange={(e) => { const f = e.target.files?.[0]; if (f) void load(f); e.target.value = ''; }} />
      {sheet && size ? (
        <>
          <div><b>{sheet.source ?? '엑셀'}</b> · "{sheet.name}" 시트</div>
          <div className="text-sub">{size.rows}행 × {size.cols}열 · 합친 칸 {size.merges}개 · 서식·열 너비까지 그대로 보내요</div>
        </>
      ) : <div className="text-sub">쓰던 엑셀을 고르면 그 시트를 모양 그대로(합친 칸·서식·열 너비) 빈 양식으로 보내요.</div>}
      {file && file.sheets.length > 1 && (
        <label className="flex items-center gap-1.5">시트
          <select aria-label="쓸 시트" value={sheet?.name ?? ''} onChange={async (e) => onChange((await sheetCopyFromBytes(file.bytes, file.name, e.target.value)) ?? undefined)}>
            {file.sheets.map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
      )}
      <div className="flex gap-1.5">
        <Button size="sm" disabled={busy} onClick={() => pick.current?.click()}>{busy ? '읽는 중…' : sheet ? '다른 엑셀로 바꾸기' : '엑셀 고르기'}</Button>
      </div>
      {err && <div className="text-err-ink">{err}</div>}
    </div>
  );
}

/** 시트 모으기형 설정 (02-generator.md 2.5) */
export function CollectSettings({ b }: { b: Builder }) {
  const c = b.schema.collect ?? { scope: 'report' as const };
  const mode = c.sheet ? 'sheet' : c.starter ? 'design' : 'blank';
  const [want, setWant] = useState<'sheet' | null>(null);   // [쓰던 엑셀 시트 그대로]를 골랐지만 아직 파일을 안 고름
  const shown = want ?? mode;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <span className="text-xs font-semibold text-sub">시트 시작 모양</span>
        <Seg label="시트 시작 모양" value={shown} options={[['blank', '빈 시트'], ['design', '직접 그리기'], ['sheet', '쓰던 엑셀 시트']]}
          onChange={(v) => {
            if (v === 'sheet') { setWant('sheet'); return; }
            setWant(null);
            b.act({ type: 'collect/set', patch: { sheet: undefined, starter: v === 'design' ? (c.starter?.length ? c.starter : DEFAULT_DESIGN) : undefined } });
          }} />
        {shown === 'design' && c.starter && <CollectDesigner table={c.starter} onChange={(t) => b.act({ type: 'collect/set', patch: { starter: t } })} />}
        {shown === 'sheet' && <SheetFromExcel sheet={c.sheet} onChange={(sh) => { setWant(null); b.act({ type: 'collect/set', patch: { sheet: sh, starter: undefined } }); }} />}
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
