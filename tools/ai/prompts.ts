/**
 * OpenAI SDK 엔진의 시스템 프롬프트 버전 (비교 시험: tools/ai/eval)
 *
 *   A  설명서(AGENTS.md)만 — codex exec·claude -p와 같은 내용
 *   B  A + 엑셀 양식 스킬(skills/excel-form.md, Anthropic xlsx 스킬을 한난MOA에 맞게 고친 것)
 *   C  B + 잘 만든 예시와 끝내기 전 점검표(skills/examples.md)
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export const PROMPT_VERSIONS = ['A', 'B', 'C'] as const;
export type PromptVersion = (typeof PROMPT_VERSIONS)[number];

/** 설명서는 `./moa`·파일 편집을 셸로 쓴다고 적혀 있어서, 이 엔진의 도구 이름으로 바꿔 읽게 한다 */
const TOOLS_NOTE = `## 이 환경에서 쓰는 도구
셸은 없다. 설명서의 명령은 아래 도구로 한다.
- \`./moa <명령> <인자…>\` → \`moa\` 도구 (command, args). 예: \`./moa new list\` → command="new", args=["list"]
- form.json 읽기 → \`read_file\` / 고치기 → \`write_file\` (form.json 전체를 다시 쓴다)
- 도구 결과를 보고 다음 할 일을 정한다. 사용자에게 묻지 않고 끝까지 해낼 수 있으면 끝까지 한다.`;

export function buildPrompt(root: string, v: PromptVersion): string {
  const read = (p: string) => readFileSync(join(root, 'tools/ai', p), 'utf8');
  const parts = [read('AGENTS.md'), TOOLS_NOTE];
  if (v === 'B' || v === 'C') parts.push(read('skills/excel-form.md'));
  if (v === 'C') parts.push(read('skills/examples.md'));
  return parts.join('\n\n');
}
