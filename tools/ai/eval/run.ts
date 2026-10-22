/**
 * AI로 만들기 비교 시험: SDK 프롬프트 A·B·C를 같은 시나리오로 돌려 채점한다.
 *
 *   npx vite-node tools/ai/eval/run.ts -- [--reps 2] [--models gpt-6.1-sol,gpt-6-luna] [--arms A,B,C] [--only S1,S2] [--jobs 6]
 *
 * 결과: tools/ai/eval/out/results.json (한 줄 = 한 번 실행). 키는 .env.local의 OPENAI_API_KEY.
 */
import './env';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, basename } from 'node:path';
import { randomUUID } from 'node:crypto';
import { loadEnv } from 'vite';
import { validateSchema, type FormSchema } from '@contract/schema';
import { buildMoa, workspace, withFiles } from '../bridge';
import { runOpenAiAgent } from '../openaiAgent';
import type { PromptVersion } from '../prompts';
import { SCENARIOS, type Check } from './scenarios';

const ROOT = process.cwd();
const OUT = join(ROOT, 'tools/ai/eval/out');
const arg = (k: string, d: string) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const REPS = Number(arg('reps', '2'));
const MODELS = arg('models', 'gpt-6.1-sol,gpt-6-luna').split(',');
const ARMS = arg('arms', 'A,B,C').split(',');
const ONLY = arg('only', '').split(',').filter(Boolean);
const JOBS = Number(arg('jobs', '6'));

const env = loadEnv('development', ROOT, '');
process.env.OPENAI_API_KEY ||= env.OPENAI_API_KEY;
if (!process.env.OPENAI_API_KEY) throw new Error('.env.local에 OPENAI_API_KEY가 없어요');

interface TurnLog { ms: number; inputTokens: number; outputTokens: number; toolCalls: number; tools: string[]; answer: string; error?: string }
export interface RunResult {
  arm: string; model: string; scenario: string; rep: number;
  checks: Check[]; score: number; ms: number; inputTokens: number; outputTokens: number; toolCalls: number;
  turns: TurnLog[]; answer: string; error?: string;
}

const b64 = (p: string) => ({ name: basename(p), base64: readFileSync(join(ROOT, p)).toString('base64') });

async function sdkTurn(ws: string, moa: string, message: string, model: string, prompt: PromptVersion): Promise<TurnLog> {
  const t0 = Date.now();
  const tools: string[] = [];
  try {
    const r = await runOpenAiAgent({ ws, moa, root: ROOT, message, model, prompt, onEvent: (e) => { if (e.type === 'status' && e.tool) tools.push(e.tool.slice(0, 160)); } });
    return { ms: Date.now() - t0, inputTokens: r.inputTokens, outputTokens: r.outputTokens, toolCalls: r.toolCalls, tools, answer: r.text };
  } catch (e) {
    return { ms: Date.now() - t0, inputTokens: 0, outputTokens: 0, toolCalls: tools.length, tools, answer: '', error: (e as Error).message };
  }
}

const readForm = (ws: string): FormSchema | undefined => {
  const p = join(ws, 'form.json');
  if (!existsSync(p)) return undefined;
  try { const v = validateSchema(JSON.parse(readFileSync(p, 'utf8'))); return v.ok ? v.schema : (JSON.parse(readFileSync(p, 'utf8')) as FormSchema); } catch { return undefined; }
};

async function one(moa: string, arm: string, model: string, sid: string, rep: number): Promise<RunResult> {
  const sc = SCENARIOS.find((s) => s.id === sid)!;
  const chatId = `eval-${arm}-${model.replace(/\W/g, "_")}-${sid}-${rep}-${randomUUID().slice(0, 8)}`;
  const ws = workspace(chatId);
  const turns: TurnLog[] = [];
  let first: FormSchema | undefined;
  for (const [i, t] of sc.turns.entries()) {
    const msg = withFiles(ws, (t.files ?? []).map(b64), t.message);
    turns.push(await sdkTurn(ws, moa, msg, model, arm as PromptVersion));
    if (i === 0) first = readForm(ws);
    if (turns.at(-1)!.error) break;
  }
  const form = readForm(ws);
  const answer = turns.at(-1)?.answer ?? '';
  const checks: Check[] = sc.id === 'S6' ? [] : [c0('moa check 통과', !!form && spawnSync(process.execPath, [moa, 'check'], { cwd: ws }).status === 0)];
  checks.push(...sc.grade(form, answer, first));
  const sum = (k: 'ms' | 'inputTokens' | 'outputTokens' | 'toolCalls') => turns.reduce((n, t) => n + t[k], 0);
  return {
    arm, model, scenario: sid, rep, checks, score: checks.filter((x) => x.pass).length / checks.length,
    ms: sum('ms'), inputTokens: sum('inputTokens'), outputTokens: sum('outputTokens'), toolCalls: sum('toolCalls'),
    turns, answer, error: turns.find((t) => t.error)?.error,
  };
}
const c0 = (name: string, pass: boolean): Check => ({ name, pass });

async function main() {
  mkdirSync(OUT, { recursive: true });
  rmSync(process.env.MOA_AI_HOME!, { recursive: true, force: true });
  const moa = await buildMoa(ROOT);
  const jobs: [string, string, string, number][] = [];
  for (let rep = 1; rep <= REPS; rep++) for (const s of SCENARIOS) if (!ONLY.length || ONLY.includes(s.id)) for (const m of MODELS) for (const a of ARMS) jobs.push([a, m, s.id, rep]);
  const out: RunResult[] = [];
  const file = join(OUT, 'results.json');
  let next = 0;
  const t0 = Date.now();
  await Promise.all(Array.from({ length: JOBS }, async () => {
    while (next < jobs.length) {
      const j = jobs[next++];
      const r = await one(moa, ...j).catch((e): RunResult => ({ arm: j[0], model: j[1], scenario: j[2], rep: j[3], checks: [], score: 0, ms: 0, inputTokens: 0, outputTokens: 0, toolCalls: 0, turns: [], answer: '', error: `시험 장치 오류: ${(e as Error)?.message ?? JSON.stringify(e)}` }));
      out.push(r);
      writeFileSync(file, JSON.stringify(out, null, 1));
      console.log(`[${out.length}/${jobs.length}] ${j.join(' ')} → ${(r.score * 100).toFixed(0)}점 ${(r.ms / 1000).toFixed(0)}초 ${r.inputTokens + r.outputTokens}tok${r.error ? ` ✕ ${r.error.slice(0, 120)}` : ''}`);
    }
  }));
  console.log(`끝 ${((Date.now() - t0) / 60000).toFixed(1)}분 → ${file}`);
}

process.on('unhandledRejection', (e) => console.error('unhandledRejection', e instanceof Error ? e.stack : JSON.stringify(e)));
void main();
