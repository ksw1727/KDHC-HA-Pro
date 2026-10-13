import { useRef, useState } from 'react';
import type { FormSchema } from '@contract/schema';
import { orgLabel } from '@contract/schema';
import type { Builder } from '../state/useBuilder';
import { Button, Seg, TextArea, TextInput } from '../ui/ui';
import { OrgTree } from '../org/OrgTree';
import { recommendLabel } from '../org/kdhcOrg';

/** 제출처 고르는 방식: 한난(조직 트리, 부르는 말 지사·부서) · 기관(직접 입력) · 직접(부르는 말도 직접). 계약을 바꾸지 않으려고 부르는 말로 판단한다 */
type Source = 'kdhc' | 'inst' | 'custom';
export const orgSource = (label: string): Source => (label === '지사' || label === '부서' ? 'kdhc' : label === '기관' ? 'inst' : 'custom');

/** 줄바꿈·탭으로 나뉜 목록 → 이름 배열 (중복·빈 줄 제거) */
export function parseOrgList(text: string): string[] {
  return [...new Set(text.split(/[\n\t]/).map((x) => x.trim()).filter(Boolean))];
}

async function readFirstColumn(file: File): Promise<string[]> {
  if (/\.csv$/i.test(file.name)) {
    const text = await file.text();
    return parseOrgList(text.split(/\r?\n/).map((l) => l.split(',')[0]).join('\n'));
  }
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await file.arrayBuffer());
  const ws = wb.worksheets[0];
  const out: string[] = [];
  ws?.getColumn(1).eachCell({ includeEmpty: false }, (c) => out.push(String(c.text ?? '').trim()));
  return parseOrgList(out.join('\n'));
}

/** ⑤ 제출처: 부르는 말, 식별 방식, 목록 */
export function OrgPanel({ b }: { b: Builder }) {
  const s = b.schema;
  const label = orgLabel(s);
  const source = orgSource(s.org.label ?? '지사');
  const orgs = s.org.orgs ?? [];
  const fileRef = useRef<HTMLInputElement>(null);
  const [err, setErr] = useState('');
  const set = (patch: Partial<FormSchema['org']>) => b.act({ type: 'org/set', patch });
  const modes = [['preset', '목록 있음'], ...(s.layout === 'collect' ? [] : [['input', `${label}명 입력`]]), ['none', '식별 안 함']] as [FormSchema['org']['mode'], string][];
  const showList = s.org.mode !== 'none';

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold text-sub">제출처를 부르는 말</span>
        <Seg size="sm" label="제출처를 부르는 말" value={source} options={[['kdhc', '한난'], ['inst', '기관'], ['custom', '직접']]}
          onChange={(v) => v !== source && set({ label: v === 'kdhc' ? recommendLabel(orgs) : v === 'inst' ? '기관' : '팀' })} />
        {source === 'kdhc' && <Seg size="sm" label="한난 부르는 말" value={label} options={[['지사', '지사'], ['부서', '부서']]} onChange={(v) => set({ label: v })} />}
        {source === 'custom' && <TextInput className="w-20" aria-label="부르는 말 직접 입력" value={label} onChange={(e) => set({ label: e.target.value })} />}
      </div>
      <Seg label="식별 방식" value={s.org.mode} options={modes} onChange={(mode) => set({ mode })} />
      {s.org.mode === 'none' && <p className="m-0 text-xs text-muted">파일 하나를 응답 하나로 취합합니다. 필요하면 "{label}" 같은 칸을 직접 추가하세요.</p>}
      {s.org.mode === 'input' && <p className="m-0 text-xs text-muted">작성자가 {label}명을 직접 적어요. 아래에 참고 목록을 넣으면 {label}명 칸이 드롭다운이 돼요.</p>}
      {showList && source === 'kdhc' && (
        <>
          <OrgTree value={orgs}
            onChange={(ids) => set({ orgs: ids, ...(label === recommendLabel(orgs) ? { label: recommendLabel(ids) } : {}) })} />
          <b>{orgs.length}곳</b>
        </>
      )}
      {showList && source !== 'kdhc' && (
        <>
          <TextArea className="min-h-28" key={s.org.orgs?.join('|')} defaultValue={(s.org.orgs ?? []).join('\n')}
            placeholder={`${label} 이름을 줄마다 하나씩, 또는 엑셀 열을 복사해 붙여넣으세요`}
            onBlur={(e) => set({ orgs: parseOrgList(e.target.value) })} />
          <div className="flex items-center gap-2">
            <b>{(s.org.orgs ?? []).length}곳</b>
            <span className="flex-1" />
            <Button size="sm" onClick={() => fileRef.current?.click()}>엑셀·CSV 첫 열 불러오기</Button>
            <input ref={fileRef} type="file" accept=".xlsx,.csv" className="hidden"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                if (!file) return;
                try {
                  setErr('');
                  set({ orgs: await readFirstColumn(file) });
                } catch {
                  setErr('파일을 읽지 못했어요. .xlsx 또는 .csv 파일인지 확인해 주세요.');
                }
              }} />
          </div>
          {err && <div className="text-xs text-err-ink">{err}</div>}
        </>
      )}
      {b.problems.filter((p) => p.where === 'org').map((p, i) => <div key={i} className="text-xs text-err-ink">● {p.message}</div>)}
    </>
  );
}
