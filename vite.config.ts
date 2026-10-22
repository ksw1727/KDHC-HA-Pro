import { defineConfig } from 'vitest/config';
import { loadEnv, type Plugin, type ViteDevServer, type PreviewServer } from 'vite';
import { authProxy } from './server/authProxy';
import { handler } from './server/http';
import { adminHandler } from './server/admin';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { fileURLToPath } from 'node:url';
import { aiBridge } from './tools/ai/bridge';

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));
// AI로 만들기(OpenAI SDK)는 .env.local의 OPENAI_API_KEY를 쓴다 (git에 올리지 않는 파일)
const key = loadEnv('development', r('.'), '').OPENAI_API_KEY;
if (key && !process.env.OPENAI_API_KEY) process.env.OPENAI_API_KEY = key;

function cloudApi(env: NodeJS.ProcessEnv): Plugin {
  const auth = authProxy(env);
  const routes = new Map([
    ['/api/account', handler('account', { env })],
    ['/api/admin', adminHandler({ env })],
    ['/api/ai/health', handler('health', { env })],
    ['/api/ai/chat', handler('chat', { env })],
    ['/api/ai/form', handler('form', { env })],
  ]);
  const setup = (server: ViteDevServer | PreviewServer) => {
    server.middlewares.use((req, res, next) => {
      const pathname = new URL(req.url ?? '/', 'http://localhost').pathname;
      if (pathname.startsWith('/api/auth/')) { void auth(req, res); return; }
      const route = routes.get(pathname);
      if (route) { void route(req, res); return; }
      next();
    });
  };
  return { name: 'moa-cloud-api', configureServer: setup, configurePreviewServer: setup };
}

export default defineConfig(({ mode }) => {
  const env = { ...loadEnv(mode, r('.'), ''), ...process.env };
  const cloud = env.VITE_CLOUD_MODE === 'true';
  if (env.VERCEL && (!cloud || !env.VITE_NEON_DATA_API_URL)) throw new Error('온라인 배포에는 VITE_CLOUD_MODE=true와 VITE_NEON_DATA_API_URL 설정이 필요합니다.');
  return {
  plugins: [react(), tailwindcss(), ...(cloud ? [cloudApi(env)] : [viteSingleFile(), aiBridge(r('.'))])],
  resolve: {
    alias: {
      '@contract': r('./src/contract'),
      '@gen': r('./src/generator'),
      '@agg': r('./src/aggregator'),
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}', 'server/**/*.test.ts'],
    setupFiles: ['src/test-setup.ts'],
  },
  };
});
