/**
 * AI 연결 서버 (AI로 만들기). 브라우저는 명령어를 실행할 수 없어서, 개발 서버(vite)에 붙어
 * `claude -p` / `codex exec`를 대화 폴더에서 돌리거나 OpenAI Agents SDK(openaiAgent.ts)로 직접 부르고,
 * 결과를 한 줄씩(NDJSON) 화면으로 보낸다.
 *
 *   GET  /api/ai/health          쓸 수 있는 엔진 (+ OpenAI 모델 목록)
 *   POST /api/ai/chat            { chatId?, engine: 'claude'|'codex'|'openai', model?, message, form? } → NDJSON 이벤트
 *   GET  /api/ai/form?chatId=…   그 대화의 AI 작업 폴더에 있는 form.json (빌더에서 고친 것과 비교용)
 *
 * 대화 폴더(~/.hanan-moa/ai/<chatId>): CLAUDE.md·AGENTS.md(설명서), moa(도구), form.json(만든 양식), state.json
 * AI가 쓸 수 있는 것은 이 폴더 안 파일과 ./moa 명령뿐이다.
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync, chmodSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin } from 'vite';
import { OPENAI_MODELS, runOpenAiAgent } from './openaiAgent';
import { PROMPT_VERSIONS, type PromptVersion } from './prompts';

type Engine = 'claude' | 'codex' | 'openai';
export type AiEvent =
  | { type: 'chat'; chatId: string }
  | { type: 'status'; text: string }
  | { type: 'text'; text: string }
  | { type: 'form'; schema: unknown }
  | { type: 'error'; text: string }
  | { type: 'done' };

export const HOME = process.env.MOA_AI_HOME ?? join(homedir(), '.hanan-moa', 'ai');
const CODEX_MODEL = process.env.MOA_CODEX_MODEL ?? 'gpt-6-astra';
const OPENAI_PROMPT = (PROMPT_VERSIONS as readonly string[]).includes(process.env.MOA_OPENAI_PROMPT ?? '') ? process.env.MOA_OPENAI_PROMPT as PromptVersion : 'C';

const has = (cmd: string) => spawnSync(cmd, ['--version'], { encoding: 'utf8' }).status === 0;

/** moa 도구를 node 하나로 도는 파일로 묶는다 (Codex는 대화 폴더 밖에 쓸 수 없어 vite 캐시를 못 쓴다) */
export async function buildMoa(root: string): Promise<string> {
  const { build } = await import('esbuild');
  const out = join(HOME, 'moa.mjs');
  mkdirSync(HOME, { recursive: true });
  await build({
    entryPoints: [join(root, 'tools/moa.ts')], outfile: out, bundle: true, platform: 'node', format: 'esm', logLevel: 'silent',
    alias: { '@contract': join(root, 'src/contract'), '@gen': join(root, 'src/generator'), '@agg': join(root, 'src/aggregator') },
    banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
  });
  return out;
}

export function workspace(root: string, chatId: string, moa: string): string {
  if (!/^[\w-]{8,64}$/.test(chatId)) throw new Error('잘못된 대화 번호');
  const ws = join(HOME, chatId);
  mkdirSync(ws, { recursive: true });
  const guide = readFileSync(join(root, 'tools/ai/AGENTS.md'), 'utf8');
  writeFileSync(join(ws, 'AGENTS.md'), guide);
  writeFileSync(join(ws, 'CLAUDE.md'), guide);
  writeFileSync(join(ws, 'moa'), `#!/bin/sh\nexec "${process.execPath}" "${moa}" "$@"\n`);
  chmodSync(join(ws, 'moa'), 0o755);
  return ws;
}

/** 쓰던 엑셀 올리기: 작업 폴더 source/에 두고 AI에게 어디 있는지 알린다 */
export function withFiles(ws: string, files: { name: string; base64: string }[], message: string): string {
  const saved: string[] = [];
  for (const f of files.slice(0, 5)) {
    const name = String(f.name).replace(/[\\/:*?"<>|]/g, '_').slice(-120);
    if (!/\.(xlsx|xlsm|xls)$/i.test(name)) continue;
    mkdirSync(join(ws, 'source'), { recursive: true });
    writeFileSync(join(ws, 'source', name), Buffer.from(f.base64, 'base64'));
    saved.push(`source/${name}`);
  }
  return saved.length
    ? `(사용자가 쓰던 엑셀 양식을 올렸어요: ${saved.map((s) => `"${s}"`).join(', ')}. 설명서의 "쓰던 엑셀 올리기" 순서대로 ./moa read-excel 로 읽고 판단하세요.)\n${message}`
    : message;
}

export const readState = (ws: string): Partial<Record<Engine, string>> => { try { return JSON.parse(readFileSync(join(ws, 'state.json'), 'utf8')); } catch { return {}; } };
const mtime = (p: string) => (existsSync(p) ? statSync(p).mtimeMs : 0);

/** 엔진별 명령 줄. 이어서 말하면 그 엔진의 대화(session)를 이어 간다 */
export function command(engine: Exclude<Engine, 'openai'>, message: string, session?: string, model = CODEX_MODEL): [string, string[]] {
  if (engine === 'claude') {
    return ['claude', ['-p', message, '--output-format', 'stream-json', '--verbose',
      '--tools', 'Bash,Read,Write,Edit', '--allowedTools', 'Bash(./moa:*)', 'Read', 'Write', 'Edit',
      '--permission-mode', 'acceptEdits', '--strict-mcp-config', '--disable-slash-commands',
      ...(session ? ['--resume', session] : [])]];
  }
  const common = ['--json', '--skip-git-repo-check', '--ignore-user-config', '-m', model, '-c', 'model_reasoning_effort="low"'];
  return session
    ? ['codex', ['exec', 'resume', session, ...common, '-c', 'sandbox_mode="workspace-write"', message]]
    : ['codex', ['exec', ...common, '-s', 'workspace-write', message]];
}

/** 엔진 출력 한 줄 → 화면 이벤트 (+ 대화 번호) */
export function parse(engine: Exclude<Engine, 'openai'>, line: string): { events: AiEvent[]; session?: string } {
  let j: Record<string, any>;
  try { j = JSON.parse(line); } catch { return { events: [] }; }
  const events: AiEvent[] = [];
  if (engine === 'claude') {
    const session = typeof j.session_id === 'string' && j.type === 'system' && j.subtype === 'init' ? j.session_id : undefined;
    if (j.type === 'assistant') {
      for (const c of j.message?.content ?? []) {
        if (c.type === 'text' && c.text?.trim()) events.push({ type: 'text', text: c.text });
        if (c.type === 'tool_use') events.push({ type: 'status', text: toolStatus(c.name === 'Bash' ? String(c.input?.command ?? '') : c.name) });
      }
    }
    if (j.type === 'result' && j.is_error) events.push({ type: 'error', text: String(j.result ?? '오류') });
    return { events, session };
  }
  if (j.type === 'thread.started') return { events, session: j.thread_id };
  if (j.type === 'item.started' && j.item?.type === 'command_execution') events.push({ type: 'status', text: toolStatus(String(j.item.command)) });
  if (j.type === 'item.completed' && j.item?.type === 'agent_message' && j.item.text?.trim()) events.push({ type: 'text', text: j.item.text });
  if (j.type === 'item.completed' && j.item?.type === 'file_change') events.push({ type: 'status', text: '양식 고치는 중' });
  if (j.type === 'turn.failed' || (j.type === 'error' && !/metadata|Skill descriptions/.test(String(j.message)))) events.push({ type: 'error', text: String(j.error?.message ?? j.message ?? '오류') });
  return { events };
}

function toolStatus(cmd: string): string {
  if (/moa check/.test(cmd)) return '양식 검사 중';
  if (/moa preview/.test(cmd)) return '엑셀 모양 확인 중';
  if (/moa new/.test(cmd)) return '시작 양식 만드는 중';
  if (/moa orgs/.test(cmd)) return '조직 이름 찾는 중';
  if (/moa read-excel/.test(cmd)) return '올린 엑셀 읽는 중';
  if (/Write|Edit/.test(cmd)) return '양식 고치는 중';
  if (/Read|cat /.test(cmd)) return '양식 읽는 중';
  return '작업 중';
}

async function body(req: IncomingMessage): Promise<any> {
  let s = '';
  for await (const ch of req) s += ch;
  return JSON.parse(s || '{}');
}

export function aiBridge(root: string): Plugin {
  let moa: Promise<string> | null = null;
  const engines = () => ({ claude: has('claude'), codex: has('codex'), openai: !!process.env.OPENAI_API_KEY });
  const handle = async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    if (req.url === '/api/ai/health' && req.method === 'GET') {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ ok: true, engines: engines(), openaiModels: OPENAI_MODELS }));
      return;
    }
    if (req.url?.startsWith('/api/ai/form?') && req.method === 'GET') {
      const chatId = new URL(req.url, 'http://x').searchParams.get('chatId') ?? '';
      const p = /^[\w-]{8,64}$/.test(chatId) ? join(HOME, chatId, 'form.json') : '';
      res.setHeader('content-type', 'application/json');
      if (!p || !existsSync(p)) { res.statusCode = 404; res.end('null'); return; }
      res.end(readFileSync(p, 'utf8'));
      return;
    }
    if (req.url !== '/api/ai/chat' || req.method !== 'POST') return next();
    res.setHeader('content-type', 'application/x-ndjson; charset=utf-8');
    let last = Date.now();
    const started = Date.now();
    const send = (e: AiEvent) => { last = Date.now(); res.write(JSON.stringify(e) + '\n'); };
    try {
      const { chatId = randomUUID(), engine = 'claude', model, message, form, files = [] } = (await body(req)) as { chatId?: string; engine?: Engine; model?: string; message?: unknown; form?: unknown; files?: { name: string; base64: string }[] };
      if (engine !== 'claude' && engine !== 'codex' && engine !== 'openai') throw new Error('엔진은 claude·codex·openai 중 하나예요');
      if (engine === 'openai' && model && !(OPENAI_MODELS as readonly string[]).includes(model)) throw new Error(`쓸 수 없는 모델이에요: ${model}`);
      if (typeof message !== 'string' || !message.trim()) throw new Error('보낼 말이 비어 있어요');
      moa ??= buildMoa(root);
      const ws = workspace(root, chatId, await moa);
      send({ type: 'chat', chatId });
      // 화면(빌더)에서 고친 양식을 함께 보내면 그 양식을 이어서 고친다
      if (form) writeFileSync(join(ws, 'form.json'), JSON.stringify(form, null, 2));
      const prompt = withFiles(ws, files, message);
      const formPath = join(ws, 'form.json');
      const before = mtime(formPath);
      const sendForm = () => {
        if (mtime(formPath) > before || form) {
          try { send({ type: 'form', schema: JSON.parse(readFileSync(formPath, 'utf8')) }); } catch { send({ type: 'error', text: 'AI가 만든 양식 파일을 읽지 못했어요' }); }
        }
      };
      if (engine === 'openai') {
        send({ type: 'status', text: `${model ?? OPENAI_MODELS[0]}가 생각하는 중` });
        const stop = new AbortController();
        res.on('close', () => stop.abort());
        try {
          await runOpenAiAgent({ ws, moa: await moa, root, message: prompt, model, prompt: OPENAI_PROMPT, signal: stop.signal, onEvent: (e) => send(e.type === 'status' ? { type: 'status', text: e.text } : e) });
        } catch (e) {
          if (!stop.signal.aborted) send({ type: 'error', text: `OpenAI가 멈췄어요: ${(e as Error).message}` });
        }
        sendForm();
        send({ type: 'done' });
        res.end();
        return;
      }
      const state = readState(ws);
      const [bin, args] = command(engine, prompt, state[engine]);
      send({ type: 'status', text: engine === 'claude' ? 'Claude가 생각하는 중' : 'Codex가 생각하는 중' });
      // stdin을 닫아 둔다: codex exec는 stdin이 열려 있으면 입력을 더 기다리며 멈춘다
      const child = spawn(bin, args, { cwd: ws, env: { ...process.env, MOA_AI: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
      // 화면이 연결을 끊으면([멈추기], 창 닫기) AI도 멈춘다
      res.on('close', () => { if (child.exitCode === null) child.kill(); });
      // 오래 걸려도 연결이 끊기지 않게 20초마다 진행 상태를 보낸다
      const keep = setInterval(() => { if (Date.now() - last >= 20000) send({ type: 'status', text: `아직 작업 중 (${Math.round((Date.now() - started) / 1000)}초)` }); }, 5000);
      child.on('close', () => clearInterval(keep));
      let buf = '';
      let err = '';
      child.stdout.on('data', (d: Buffer) => {
        buf += d.toString();
        let i;
        while ((i = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, i); buf = buf.slice(i + 1);
          const r = parse(engine, line);
          if (r.session) writeFileSync(join(ws, 'state.json'), JSON.stringify({ ...readState(ws), [engine]: r.session }));
          r.events.forEach(send);
        }
      });
      child.stderr.on('data', (d: Buffer) => { err += d.toString(); });
      child.on('close', (code) => {
        sendForm();
        if (code !== 0) send({ type: 'error', text: `${engine}가 멈췄어요 (${code}) ${err.trim().split('\n').slice(-2).join(' ')}`.trim() });
        send({ type: 'done' });
        res.end();
      });
      child.on('error', (e) => { send({ type: 'error', text: `${bin} 명령을 실행하지 못했어요: ${e.message}` }); send({ type: 'done' }); res.end(); });
    } catch (e) {
      send({ type: 'error', text: (e as Error).message });
      send({ type: 'done' });
      res.end();
    }
  };
  return {
    name: 'hanan-moa-ai-bridge',
    configureServer: (s) => { s.middlewares.use((req, res, next) => void handle(req, res, next)); },
    configurePreviewServer: (s) => { s.middlewares.use((req, res, next) => void handle(req, res, next)); },
  };
}
