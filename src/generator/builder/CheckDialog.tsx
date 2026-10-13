import type { ExportProblem } from '../state/validateForExport';
import { WHERE_LABEL } from '../state/validateForExport';
import { Button, Dialog } from '../ui/ui';

/** 내보내기 전 검사 창 (02-generator.md 2.6 ①) */
export function CheckDialog({ problems, onFix, onClose }: { problems: ExportProblem[]; onFix: (p: ExportProblem) => void; onClose: () => void }) {
  return (
    <Dialog tone="err" title={`내보내기 전에 ${problems.length}가지를 고쳐 주세요`} onClose={onClose}
      footer={<><span className="text-xs text-muted">고친 뒤 다시 [엑셀 내보내기]를 눌러 주세요.</span><span className="flex-1" /><Button variant="pri" onClick={() => onFix(problems[0])}>첫 번째부터 고치기</Button></>}>
      <div className="overflow-hidden rounded-card border border-[#f5c2bd]">
        {problems.map((p, i) => (
          <div key={i} className="flex items-center gap-2.5 border-b border-[#f5c2bd] bg-white px-3 py-2 last:border-b-0">
            <span className="w-24 shrink-0 text-xs text-muted">{WHERE_LABEL[p.where]}</span>
            <span className="flex-1">{p.message}</span>
            <Button size="sm" onClick={() => onFix(p)}>고치러 가기</Button>
          </div>
        ))}
      </div>
    </Dialog>
  );
}
