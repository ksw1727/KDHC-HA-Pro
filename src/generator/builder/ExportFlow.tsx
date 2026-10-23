import { useMemo, useState } from 'react';
import type { FormSchema } from '@contract/schema';
import { LAYOUT_LABELS, blockFields, gridOwners, orgLabel } from '@contract/schema';
import { layoutSheet } from '@contract/layout';
import { diffSummary, nextVersion } from '../state/versioning';
import { canShare, exportForm, exportNames, type ExportResult } from '../export/exportZip';
import { downloadBlob, exportFormJson, safeFileName } from '../export/exportJson';
import { noticeText } from '../export/noticeText';
import { josa } from '@contract/josa';
import { Button, Chip, Dialog, TextArea, TextInput } from '../ui/ui';
import { daysFrom, isoDay, needsSchedule, quickDeadlines, shortDate } from '../state/schedule';

type Meta = Pick<FormSchema, 'deadline' | 'contact'>;

/**
 * 내보내기 ① 일정 정보 → ② 확인 창 → 진행 → ③ 완료 화면 (02-generator.md 2.6).
 * onMeta: ①에서 넣은 제출 기한·문의처를 양식에 저장. 기한이 비었거나 지났을 때만 ①을 보여 준다 (내 업무공간 취합 일정에 필요)
 */
export function ExportFlow({ schema, lastExported, onClose, onExported, onMeta }: {
  schema: FormSchema; lastExported?: FormSchema; onClose: () => void; onExported: (exported: FormSchema) => void; onMeta?: (patch: Meta) => void;
}) {
  const [today] = useState(() => new Date());
  const [step, setStep] = useState<'info' | 'confirm'>(() => (onMeta && needsSchedule(schema, today) ? 'info' : 'confirm'));
  const version = nextVersion(schema, lastExported);
  const target = useMemo<FormSchema>(() => ({ ...schema, formVersion: version }), [schema, version]);
  const changes = lastExported ? diffSummary(lastExported, schema) : [];
  const up = !!lastExported && version > lastExported.formVersion;
  const label = orgLabel(schema);
  const orgs = schema.org.orgs ?? [];
  const collect = schema.layout === 'collect';
  const [shared, setShared] = useState(false);
  const share = shared && canShare(schema);
  const names = exportNames(target, share);
  const count = names.preset ? orgs.length : 1;
  const contents = useMemo(() => fileContents(target, label, share), [target, label, share]);

  const [withJson, setWithJson] = useState(true);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [result, setResult] = useState<ExportResult | null>(null);
  const [error, setError] = useState('');

  const run = async () => {
    setError('');
    setProgress({ done: 0, total: count });
    try {
      const r = await exportForm(target, new Date(), (done, total) => setProgress({ done, total }), share);
      downloadBlob(r.download.blob, r.download.name);
      if (withJson) exportFormJson(target);
      setResult(r);
      onExported(target);
    } catch (e) {
      console.error(e);
      setError('엑셀 파일을 만들지 못했어요. 다시 시도해 주세요.');
    } finally {
      setProgress(null);
    }
  };

  if (result) return <ExportDone schema={target} result={result} withJson={withJson} shared={share} onClose={onClose} today={today} />;
  if (step === 'info') return <ScheduleInfo schema={schema} today={today} onClose={onClose} onNext={(patch) => { onMeta?.(patch); setStep('confirm'); }} />;

  const sample = names.preset ? orgs.slice(0, 2).map((o) => names.fileOf(o)) : [names.fileOf()];
  return (
    <Dialog title={<>엑셀로 내보내기 {onMeta && <Steps at={2} />}</>} onClose={progress ? () => {} : onClose}
      footer={<>
        <Button onClick={onClose} disabled={!!progress}>미리보기로 돌아가기</Button>
        <span className="flex-1" />
        {progress && <span className="text-xs text-sub" role="status">엑셀 만드는 중 {progress.done}/{progress.total}</span>}
        <Button variant="pri" onClick={run} disabled={!!progress}>{progress ? '만드는 중…' : `내보내기 (${count}개${names.preset ? ' · zip' : ''})`}</Button>
      </>}>
      <dl className="m-0 grid grid-cols-[110px_1fr] gap-x-3 gap-y-1.5 text-[13.5px]">
        <dt className="text-muted">양식</dt><dd className="m-0"><b>{schema.title}</b> · {LAYOUT_LABELS[schema.layout]}</dd>
        {schema.org.mode !== 'preset' && <><dt className="text-muted">만들 파일</dt><dd className="m-0"><b>엑셀 1개</b></dd></>}
        <dt className="text-muted">제출 기한</dt>
        <dd className="m-0">
          {schema.deadline ? <b>{shortDate(schema.deadline)}</b> : <><Chip tone="warn">기한 없음</Chip> <span className="text-xs text-muted">내 업무공간 취합 일정에는 "기한 없음"으로 보여요</span></>}
          {schema.contact && ` · 문의 ${schema.contact}`}
          {onMeta && !progress && <button type="button" className="ml-2 text-xs text-sub underline" onClick={() => setStep('info')}>바꾸기</button>}
        </dd>
      </dl>

      {schema.org.mode === 'preset' && (
        <div>
          <div className="mb-1 text-xs text-muted">받을 파일</div>
          <div className="grid gap-2" role="radiogroup" aria-label="받을 파일">
            <FileChoice on={!share} onPick={() => setShared(false)} title={<>{label}별 파일 {orgs.length}개 (압축 파일 1개)<span className="ml-1.5 rounded border border-pri-line bg-white px-1.5 text-[11px] font-semibold text-pri-ink">추천</span></>}
              text={`파일마다 ${label}명이 미리 들어가 있고 잠겨 있어요. 취합할 때 누가 냈는지 틀릴 일이 없어요.`} />
            <FileChoice on={share} disabled={!canShare(schema)} onPick={() => setShared(true)} title="공용 파일 1개"
              text={`모두에게 같은 파일을 보내요. 작성자가 ${label}명 칸에서 자기 ${josa(label, '을', '를')} 골라요.`} />
          </div>
          {collect && <div className="mt-2 rounded-card border border-line bg-panel px-3 py-2 text-[13px] text-sub">시트 모으기형은 파일 속성으로만 {josa(label, '을', '를')} 알아내서 <b>{label}별 파일로만</b> 만들 수 있어요.</div>}
          {share && schema.layout === 'fill-in' && gridOwners(schema).size > 0 && (
            <div className="mt-2 rounded-card border border-[#f3cfa5] bg-warn px-3 py-2 text-[13px] text-warn-ink" role="alert">
              ⚠ <b>빈칸채우기형은 공용 파일이면 다른 {label} 칸이 잠기지 않아요.</b> 다른 {label} 칸에 적은 값은 취합할 때 쓰지 않고 알림으로 알려 드려요. {label}별 파일을 권해요.
            </div>
          )}
        </div>
      )}

      {up ? (
        <div className="flex items-start gap-2.5 rounded-card border border-[#f3cfa5] bg-warn px-3 py-2.5 text-[13px] text-warn-ink">
          <b className="shrink-0 whitespace-nowrap"><span className="rounded border border-[#f3cfa5] bg-white px-1.5">v{lastExported!.formVersion}</span> → <span className="rounded border border-[#f3cfa5] bg-white px-1.5">v{version}</span></b>
          <span>지난번 내보낸 뒤 <b>칸 구조</b>가 바뀌어 버전 {version}로 내보내요.{changes.length > 0 && <> ({changes.slice(0, 4).join(', ')}{changes.length > 4 ? ` 외 ${changes.length - 4}개` : ''})</>} 이미 보낸 v{lastExported!.formVersion} 파일이 돌아오면 취합할 때 알려 드려요.</span>
        </div>
      ) : (
        <div className="text-xs text-muted">{lastExported ? `v${version} 그대로 내보내요. 칸 구조는 바뀌지 않았어요.` : `처음 내보내는 양식이에요. v${version}로 만들어요.`}</div>
      )}

      <div>
        <div className="mb-1 text-xs text-muted">파일 이름</div>
        <div className="rounded-box border border-line bg-panel px-2.5 py-2 font-mono text-xs leading-relaxed">
          {names.preset && <div className="font-bold text-pri-ink">{names.zipName}</div>}
          {sample.map((n) => <div key={n}>{names.preset ? '　├ ' : ''}{n}</div>)}
          {names.preset && orgs.length > 2 && <div className="text-muted">　└ … {orgs.length - 2}개 더</div>}
        </div>
      </div>

      <div>
        <div className="mb-1 text-xs text-muted">파일마다 들어가는 것</div>
        <ul className="m-0 grid grid-cols-2 gap-x-4 gap-y-0.5 pl-0 text-[13px]">
          {(collect
            ? ['자유롭게 고칠 수 있는 보고서 시트', `숨김 시트 (양식${schema.org.mode === 'none' ? '' : `·${label}`} 정보)`, '파일 속성 (양식 번호)', '잠금 없음 (셀 합치기·시트 추가 가능)']
            : contents
          ).map((x) => <li key={x} className="list-none"><span className="font-bold text-auto-ink">✓ </span>{x}</li>)}
        </ul>
      </div>

      <label className="flex items-center gap-2 text-[13.5px]">
        <input type="checkbox" className="h-4 w-4 accent-[var(--color-pri)]" checked={withJson} onChange={(e) => setWithJson(e.target.checked)} />
        양식 파일(.form.json)도 함께 저장하기
        <span className="text-xs text-muted">— 다음 차수에 다시 쓰거나, 숨김 정보가 사라진 파일을 살릴 때 필요해요</span>
      </label>
      {error && <div className="rounded-btn bg-err px-2.5 py-1.5 text-err-ink" role="alert">{error}</div>}
    </Dialog>
  );
}

/** ① 일정 정보: 제출 기한(빠른 버튼) · 문의처 · 제출처 수 확인 */
function ScheduleInfo({ schema, today, onClose, onNext }: { schema: FormSchema; today: Date; onClose: () => void; onNext: (patch: Meta) => void }) {
  const min = isoDay(today);
  const past = !!schema.deadline && schema.deadline < min;
  const [deadline, setDeadline] = useState(past ? '' : schema.deadline ?? '');
  const [contact, setContact] = useState(schema.contact ?? '');
  const ok = !!deadline && deadline >= min;
  const label = orgLabel(schema);
  const n = schema.org.orgs?.length ?? 0;
  return (
    <Dialog title={<>엑셀로 내보내기 <Steps at={1} /></>} onClose={onClose}
      footer={<>
        <button type="button" className="text-[13px] text-sub underline" onClick={() => onNext({ deadline: undefined, contact: contact.trim() || undefined })}>기한 없이 내보내기</button>
        <span className="flex-1" />
        <Button onClick={onClose}>취소</Button>
        <Button variant="pri" disabled={!ok} onClick={() => onNext({ deadline, contact: contact.trim() || undefined })}>다음 →</Button>
      </>}>
      <div className="flex items-start gap-2.5 rounded-card border border-pri-line bg-pri-bg px-3 py-2.5 text-[13px] text-pri-ink">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="mt-0.5 shrink-0" aria-hidden><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4" /></svg>
        <span><b>내 업무공간 취합 일정</b>에 올리려면 제출 기한이 필요해요. 엑셀 안내 줄과 {schema.org.mode === 'none' ? '' : `${label}에 `}보낼 안내문에도 들어가요.</span>
      </div>
      {past && <div className="rounded-card border border-[#f3cfa5] bg-warn px-3 py-2 text-[13px] text-warn-ink" role="alert">⚠ 들어 있던 기한 <b>{shortDate(schema.deadline!)}</b>은 이미 지났어요. 지난 차수 양식이면 새 기한을 골라 주세요.</div>}
      <div className="grid grid-cols-[96px_1fr] items-start gap-x-3 gap-y-3 text-[13.5px]">
        <label htmlFor="export-deadline" className="pt-1.5 text-muted">제출 기한</label>
        <div>
          <TextInput id="export-deadline" type="date" className="max-w-[200px]" min={min} value={deadline} onChange={(e) => setDeadline(e.target.value)} />
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {quickDeadlines(today).map(([t, v]) => (
              <button key={t} type="button" aria-pressed={deadline === v} onClick={() => setDeadline(v)}
                className={'rounded-full border px-2.5 py-0.5 text-[12.5px] ' + (deadline === v ? 'border-pri bg-pri-bg font-semibold text-pri-ink' : 'border-line-strong bg-white')}>
                {t} · {shortDate(v).replace(/\(.\)$/, '')}
              </button>
            ))}
          </div>
          <div className="mt-1 text-xs">{ok ? <span className="font-semibold text-auto-ink">✓ {shortDate(deadline)}까지 · 오늘부터 {daysFrom(deadline, today)}일</span> : <span className="text-muted">오늘({shortDate(min).replace(/\(.\)$/, '')}) 이후 날짜를 골라 주세요.</span>}</div>
        </div>
        <label htmlFor="export-contact" className="pt-1.5 text-muted">문의처 <Chip>선택</Chip></label>
        <TextInput id="export-contact" value={contact} placeholder="예: 인사부 02-000-0000" onChange={(e) => setContact(e.target.value)} />
        {schema.org.mode === 'preset' && <>
          <span className="text-muted">제출처</span>
          <div>{label} {n}곳 <span className="font-semibold text-auto-ink">✓</span> <span className="text-xs text-muted">— 다 내면 취합 일정에서 "{n}/{n} 제출"로 보여요</span></div>
        </>}
      </div>
    </Dialog>
  );
}

/** 창 제목 옆 ① 일정 정보 · ② 확인 · ③ 완료 */
function Steps({ at }: { at: 1 | 2 | 3 }) {
  return (
    <span className="ml-2 inline-flex gap-1 align-middle text-[11.5px] font-normal">
      {['일정 정보', '확인', '완료'].map((t, i) => (
        <span key={t} className={'rounded-full px-2 py-px ' + (i + 1 === at ? 'bg-pri font-bold text-white' : i + 1 < at ? 'bg-auto text-auto-ink' : 'bg-chip text-muted')}>{i + 1 < at ? '✓' : i + 1} {t}</span>
      ))}
    </span>
  );
}

function ExportDone({ schema, result, withJson, shared, onClose, today }: { schema: FormSchema; result: ExportResult; withJson: boolean; shared: boolean; onClose: () => void; today: Date }) {
  const [notice, setNotice] = useState(() => noticeText(schema, shared));
  const [copied, setCopied] = useState(false);
  const label = orgLabel(schema);
  const size = result.download.blob.size;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(notice);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };
  const goAggregate = () => {
    onClose();
    window.dispatchEvent(new CustomEvent('hanan-moa:tab', { detail: { tab: 'aggregator', formId: schema.formId } }));
  };
  return (
    <Dialog wide tone="ok" title={`엑셀 ${result.files.length}개를 만들었어요`} onClose={onClose}
      footer={<><span className="text-xs text-muted">다운로드 폴더에 저장됐어요.</span><span className="flex-1" /><Button onClick={onClose}>양식으로 돌아가기</Button><Button variant="pri" onClick={goAggregate}>취합하기로 이동 →</Button></>}>
      <div className="grid grid-cols-[1.1fr_1fr] gap-5">
        <div className="flex flex-col gap-2">
          <FileCard tag={result.download.name.endsWith('.zip') ? 'ZIP' : 'XLSX'} name={result.download.name}
            sub={`엑셀 ${result.files.length}개 · ${size < 1024 * 1024 ? `${Math.max(1, Math.round(size / 1024))}KB` : `${(size / 1024 / 1024).toFixed(1)}MB`}`}
            onAgain={() => downloadBlob(result.download.blob, result.download.name)} />
          {withJson && <FileCard tag="JSON" name={`${safeFileName(schema.title || '새 양식')}.form.json`} sub="양식 파일 · 다음 차수에 다시 쓸 때" onAgain={() => exportFormJson(schema)} gray />}
          <div className="flex items-center gap-2 rounded-card border border-pri-line bg-pri-bg px-3 py-2 text-[13px] text-pri-ink">
            <span className="min-w-0 flex-1"><b>내 업무공간 취합 일정</b>에 올라갔어요 · {schema.deadline ? `오늘 → ${shortDate(schema.deadline)}까지 (${daysFrom(schema.deadline, today)}일)` : '기한 없음'}</span>
            <Button size="sm" onClick={() => { onClose(); window.dispatchEvent(new CustomEvent('hanan-moa:tab', { detail: { tab: 'home' } })); }}>일정 보기</Button>
          </div>
          {result.files.length > 1 && (
            <div className="max-h-44 overflow-auto rounded-card border border-line">
              {result.files.map((f) => (
                <div key={f.name} className="flex items-center gap-2 border-b border-line px-3 py-1.5 text-[12.5px] last:border-b-0">
                  <span className="inline-flex h-[18px] w-4 items-center justify-center rounded-sm bg-[#1f7a4a] text-[9px] font-extrabold text-white">X</span>{f.name}
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="rounded-card border border-line bg-panel p-4">
          <h4 className="m-0 mb-2 text-[15px]">이제 이렇게 하세요</h4>
          <Step n={1} title={`${label}에 파일 보내기`} text={shared ? `모두에게 같은 파일을 보내 주세요. ${label}명은 작성자가 목록에서 골라요.` : schema.org.mode === 'preset' ? `압축을 풀어 ${label}마다 자기 이름의 파일을 보내 주세요. ${label}명이 미리 들어 있어요.` : '파일을 메신저·메일로 보내 주세요.'}>
            <TextArea className="block min-h-24 w-full text-[12.5px]" aria-label="안내문" value={notice} onChange={(e) => setNotice(e.target.value)} />
            <div className="mt-1 flex items-center justify-end gap-2">
              {copied && <span className="text-xs text-auto-ink" role="status">복사했어요</span>}
              <Button size="sm" onClick={copy}>안내문 복사</Button>
            </div>
          </Step>
          <Step n={2} title="돌아온 파일 모으기" text="파일 이름이 바뀌어도 괜찮아요. 한 폴더에 모아 두세요." />
          <Step n={3} title="취합하기" text="모은 파일을 한꺼번에 넣으면 검사하고 합쳐 드려요." last />
        </div>
      </div>
    </Dialog>
  );
}

function FileChoice({ on, disabled, onPick, title, text }: { on: boolean; disabled?: boolean; onPick: () => void; title: React.ReactNode; text: string }) {
  return (
    <button type="button" role="radio" aria-checked={on} disabled={disabled} onClick={onPick}
      className={'flex gap-2.5 rounded-card px-3 py-2.5 text-left ' + (on ? 'border-[1.5px] border-pri bg-pri-bg' : 'border border-line-strong bg-white') + (disabled ? ' cursor-not-allowed opacity-45' : '')}>
      <span className={'mt-[3px] h-4 w-4 shrink-0 rounded-full bg-white ' + (on ? 'border-[5px] border-pri' : 'border-[1.5px] border-line-strong')} />
      <span><b className="block">{title}</b><span className="block text-[12.5px] text-sub">{text}</span></span>
    </button>
  );
}

function FileCard({ tag, name, sub, onAgain, gray }: { tag: string; name: string; sub: string; onAgain: () => void; gray?: boolean }) {
  return (
    <div className="flex items-center gap-3 rounded-card border border-line bg-panel px-3.5 py-3">
      <span className={'flex h-11 w-10 items-end justify-center rounded-md pb-1.5 text-[10px] font-extrabold text-white ' + (gray ? 'bg-sub' : 'bg-pri')}>{tag}</span>
      <div className="min-w-0 flex-1"><b className="block truncate">{name}</b><div className="text-xs text-muted">{sub}</div></div>
      <Button size="sm" onClick={onAgain}>다시 받기</Button>
    </div>
  );
}

function Step({ n, title, text, children, last }: { n: number; title: string; text: string; children?: React.ReactNode; last?: boolean }) {
  return (
    <div className={'flex gap-3 py-2.5 ' + (last ? '' : 'border-b border-dashed border-line-strong')}>
      <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-[1.5px] border-pri bg-white text-xs font-bold text-pri">{n}</span>
      <div className="min-w-0 flex-1"><b className="block">{title}</b><p className="m-0 text-[13px] text-sub">{text}</p>{children && <div className="mt-1.5 flex flex-col">{children}</div>}</div>
    </div>
  );
}

/** 확인 창의 "파일마다 들어가는 것": 실제로 만들 시트 모양에서 뽑는다 (구조·제출처 방식에 따라 다름) */
function fileContents(s: FormSchema, label: string, shared: boolean): string[] {
  const m = layoutSheet(s, { mode: 'template', orgName: s.org.orgs?.[0], shared }, { today: new Date() });
  const out: string[] = [];
  if (m.validations.length) out.push('입력 규칙 (숫자·날짜·선택 목록)');
  out.push(shared ? `제목 줄 잠금 · ${label}명은 목록에서 고르기` : s.org.mode === 'preset' ? `제목 줄·${label}명 잠금` : s.org.mode === 'input' ? `제목 줄 잠금 · ${label}명은 작성자가 입력` : '제목 줄 잠금');
  if (s.blocks.some((b) => blockFields(b).some((f) => f.help?.trim()))) out.push('작성 안내 메시지');
  out.push('인쇄 영역');
  out.push(`숨김 시트 (양식${s.org.mode === 'none' ? '' : `·${label}`} 정보)`);
  if (m.freeze) out.push('틀 고정');
  // 빈칸채우기 작성처: 제출처별 파일은 다른 제출처 칸이 잠기고, 공용 파일은 모두 열린다
  if (s.layout === 'fill-in' && s.org.mode === 'preset' && gridOwners(s).size) out.push(shared ? `모든 ${label} 칸이 열려 있음` : `다른 ${label} 칸은 회색·잠금`);
  return out;
}
