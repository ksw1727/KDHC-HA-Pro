/**
 * OpenAI Agents SDK 엔진 (AI로 만들기). `codex exec` 대신 API로 직접 돌린다.
 * 셸 대신 함수 도구 3개만 준다 — moa(./moa 명령), read_file, write_file(대화 폴더 안, form.json만 쓰기).
 * 대화 기록은 대화 폴더 openai-history.json에 두고 이어서 말할 때 붙여 보낸다.
 *
 * 시스템 프롬프트는 버전(A·B·C)으로 고른다 (tools/ai/prompts.ts, 비교 시험은 tools/ai/eval).
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { Agent, run, tool, setTracingDisabled, type AgentInputItem } from '@openai/agents';
import { z } from 'zod';
import { buildPrompt, type PromptVersion } from './prompts';

export const OPENAI_MODELS = ['gpt-6.1-sol', 'gpt-6-luna'] as const;
export type OpenAiModel = (typeof OPENAI_MODELS)[number];

export type AgentEvent =
  | { type: 'status'; text: string; tool?: string }
  | { type: 'text'; text: string };

export interface AgentRun {
  ws: string;            // 대화 폴더
  moa: string;           // 묶은 moa.mjs
  root: string;          // 프로그램 폴더 (설명서 읽기)
  message: string;
  model?: string;
  prompt?: PromptVersion;
  effort?: 'low' | 'medium' | 'high';
  signal?: AbortSignal;
  onEvent: (e: AgentEvent) => void;
}

export interface AgentResult { text: string; toolCalls: number; inputTokens: number; outputTokens: number; requests: number }

setTracingDisabled(true);

const HISTORY = 'openai-history.json';

/** 대화 폴더 밖 경로는 막는다 */
function inside(ws: string, p: string): string {
  const full = resolve(ws, p);
  if (relative(ws, full).startsWith('..') || resolve(full) === resolve(ws)) throw new Error(`이 폴더 안 파일만 쓸 수 있어요: ${p}`);
  return full;
}

function tools(ws: string, moa: string) {
  const moaTool = tool({
    name: 'moa',
    description: '한난MOA 도구. 설명서의 `./moa <명령> <인자…>`와 같다. 예: command="check", command="new" args=["list"], command="orgs" args=["수원"], command="read-excel" args=["source/파일.xlsx"]',
    parameters: z.object({
      command: z.enum(['new', 'check', 'preview', 'orgs', 'read-excel']),
      args: z.array(z.string()).describe('명령 뒤에 붙는 인자. 없으면 []'),
    }),
    execute: async ({ command, args }) => {
      const r = spawnSync(process.execPath, [moa, command, ...args], { cwd: ws, encoding: 'utf8', timeout: 60_000 });
      const out = `${r.stdout ?? ''}${r.stderr ?? ''}`.trim();
      return `${out || '(출력 없음)'}${r.status ? `\n(종료 코드 ${r.status})` : ''}`;
    },
  });
  const readTool = tool({
    name: 'read_file',
    description: '이 폴더 안의 글 파일을 읽는다 (보통 form.json).',
    parameters: z.object({ path: z.string() }),
    execute: async ({ path }) => {
      const p = inside(ws, path);
      return existsSync(p) ? readFileSync(p, 'utf8') : `없는 파일: ${path}`;
    },
  });
  const writeTool = tool({
    name: 'write_file',
    description: 'form.json 전체 내용을 새로 쓴다. 다른 파일은 쓸 수 없다. 쓴 뒤 moa check로 검사한다.',
    parameters: z.object({ path: z.literal('form.json'), content: z.string().describe('form.json 전체 JSON') }),
    execute: async ({ content }) => {
      try { JSON.parse(content); } catch (e) { return `JSON이 아니에요: ${(e as Error).message}. 고쳐서 다시 쓰세요.`; }
      writeFileSync(join(ws, 'form.json'), content);
      return 'form.json을 썼어요.';
    },
  });
  return [moaTool, readTool, writeTool];
}

function statusOf(name: string, args: string): string {
  if (name === 'write_file') return '양식 고치는 중';
  if (name === 'read_file') return '양식 읽는 중';
  let a: { command?: string } = {};
  try { a = JSON.parse(args); } catch { /* 그대로 */ }
  return ({ check: '양식 검사 중', preview: '엑셀 모양 확인 중', new: '시작 양식 만드는 중', orgs: '조직 이름 찾는 중', 'read-excel': '올린 엑셀 읽는 중' } as Record<string, string>)[a.command ?? ''] ?? '작업 중';
}

export async function runOpenAiAgent(o: AgentRun): Promise<AgentResult> {
  if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY가 없어요. 프로그램 폴더의 .env.local에 넣어 주세요.');
  const agent = new Agent({
    name: '한난MOA 양식 도우미',
    instructions: buildPrompt(o.root, o.prompt ?? 'C'),
    model: o.model ?? OPENAI_MODELS[0],
    modelSettings: { reasoning: { effort: o.effort ?? 'low' } },
    tools: tools(o.ws, o.moa),
  });
  const histPath = join(o.ws, HISTORY);
  let history: AgentInputItem[] = [];
  try { history = JSON.parse(readFileSync(histPath, 'utf8')); } catch { /* 새 대화 */ }

  const stream = await run(agent, [...history, { role: 'user', content: o.message }], { stream: true, maxTurns: 30, signal: o.signal });
  stream.completed.catch(() => { /* 아래 await에서 받는다 */ });
  let toolCalls = 0;
  for await (const ev of stream) {
    if (ev.type !== 'run_item_stream_event') continue;
    const raw = ev.item.rawItem as { type?: string; name?: string; arguments?: string };
    if (ev.name === 'tool_called' && raw.type === 'function_call') {
      toolCalls++;
      o.onEvent({ type: 'status', text: statusOf(raw.name ?? '', raw.arguments ?? ''), tool: `${raw.name} ${raw.arguments ?? ''}` });
    }
  }
  await stream.completed;
  const text = String(stream.finalOutput ?? '').trim();
  if (text) o.onEvent({ type: 'text', text });
  writeFileSync(histPath, JSON.stringify(stream.history));
  const sum = (f: (u: { inputTokens: number; outputTokens: number }) => number) => stream.rawResponses.reduce((n, r) => n + f(r.usage), 0);
  return { text, toolCalls, inputTokens: sum((u) => u.inputTokens), outputTokens: sum((u) => u.outputTokens), requests: stream.rawResponses.length };
}
