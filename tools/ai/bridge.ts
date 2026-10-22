/**
 * AI 연결 서버 (AI로 만들기). 브라우저는 명령어를 실행할 수 없어서, 개발 서버(vite)에 붙어
 * OpenAI Agents SDK(openaiAgent.ts)로 AI를 부르고, 결과를 한 줄씩(NDJSON) 화면으로 보낸다.
 *
 *   GET  /api/ai/health          OpenAI 키가 있는지 (+ 모델 목록)
 *   POST /api/ai/chat            { chatId?, model?, message, form?, files? } → NDJSON 이벤트
 *   GET  /api/ai/form?chatId=…   그 대화의 AI 작업 폴더에 있는 form.json (빌더에서 고친 것과 비교용)
 *
 * 대화 폴더(~/.hanan-moa/ai/<chatId>): form.json(만든 양식), openai-history.json(대화 기록), source/(올린 엑셀)
 * AI가 쓸 수 있는 것은 이 폴더 안 파일과 moa 도구뿐이다.
 */
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin } from 'vite';
import { OPENAI_MODELS, runOpenAiAgent } from './openaiAgent';
import { PROMPT_VERSIONS, type PromptVersion } from './prompts';

export type AiEvent =
  | { type: 'chat'; chatId: string }
  | { type: 'status'; text: string }
  | { type: 'text'; text: string }
  | { type: 'form'; schema: unknown }
  | { type: 'error'; text: string }
  | { type: 'done' };

export const HOME = process.env.MOA_AI_HOME ?? join(homedir(), '.hanan-moa', 'ai');
const OPENAI_PROMPT = (PROMPT_VERSIONS as readonly string[]).includes(process.env.MOA_OPENAI_PROMPT ?? '') ? process.env.MOA_OPENAI_PROMPT as PromptVersion : 'B';

/** moa 도구를 node 하나로 도는 파일로 묶는다 */
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

export function workspace(chatId: string): string {
  if (!/^[\w-]{8,64}$/.test(chatId)) throw new Error('잘못된 대화 번호');
  const ws = join(HOME, chatId);
  mkdirSync(ws, { recursive: true });
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

const mtime = (p: string) => (existsSync(p) ? statSync(p).mtimeMs : 0);

async function body(req: IncomingMessage): Promise<any> {
  let s = '';
  for await (const ch of req) s += ch;
  return JSON.parse(s || '{}');
}

export function aiBridge(root: string): Plugin {
  let moa: Promise<string> | null = null;
  const handle = async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    if (req.url === '/api/ai/health' && req.method === 'GET') {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ ok: true, openai: !!process.env.OPENAI_API_KEY, openaiModels: OPENAI_MODELS }));
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
    const send = (e: AiEvent) => { res.write(JSON.stringify(e) + '\n'); };
    try {
      const { chatId = randomUUID(), model, message, form, files = [] } = (await body(req)) as { chatId?: string; model?: string; message?: unknown; form?: unknown; files?: { name: string; base64: string }[] };
      if (!process.env.OPENAI_API_KEY) throw new Error('.env.local에 OPENAI_API_KEY가 없어요');
      if (model && !(OPENAI_MODELS as readonly string[]).includes(model)) throw new Error(`쓸 수 없는 모델이에요: ${model}`);
      if (typeof message !== 'string' || !message.trim()) throw new Error('보낼 말이 비어 있어요');
      moa ??= buildMoa(root);
      const ws = workspace(chatId);
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
    } catch (e) {
      send({ type: 'error', text: (e as Error).message });
      send({ type: 'done' });
      res.end();
    }
  };
  return {
    name: 'hanan-moa-ai-bridge',
    configureServer: (s) => {
      // 코드를 고치면 다음 대화에서 moa 도구를 다시 묶는다 (서버를 껐다 켤 필요 없게)
      s.watcher.on('change', (p) => { if (/[\\/](src|tools)[\\/].*\.tsx?$/.test(p)) moa = null; });
      s.middlewares.use((req, res, next) => void handle(req, res, next));
    },
    configurePreviewServer: (s) => { s.middlewares.use((req, res, next) => void handle(req, res, next)); },
  };
}
