import type { Builder } from '../state/useBuilder';
import { Seg, TextArea } from '../ui/ui';
import { parsePastedTable } from './parsePastedTable';

/** 시트 모으기형 설정 (02-generator.md 2.5) */
export function CollectSettings({ b }: { b: Builder }) {
  const c = b.schema.collect ?? { scope: 'report' as const };
  const hasStarter = !!c.starter;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <span className="text-xs font-semibold text-sub">시트 시작 모양</span>
        <Seg label="시트 시작 모양" value={hasStarter ? 'starter' : 'blank'} options={[['blank', '빈 시트로 보내기'], ['starter', '기본 틀 넣어서 보내기']]}
          onChange={(v) => b.act({ type: 'collect/set', patch: { starter: v === 'starter' ? c.starter ?? [] : undefined } })} />
        {hasStarter && (
          <TextArea className="min-h-24 font-mono text-xs" placeholder={'엑셀에서 표를 복사해 여기에 붙여넣으세요\n점검 항목\t결과\t조치 내용'}
            defaultValue={(c.starter ?? []).map((r) => r.map((x) => x ?? '').join('\t')).join('\n')}
            onBlur={(e) => b.act({ type: 'collect/set', patch: { starter: parsePastedTable(e.target.value) } })} />
        )}
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
