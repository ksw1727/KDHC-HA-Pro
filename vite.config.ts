import { defineConfig } from 'vitest/config';
import { loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { fileURLToPath } from 'node:url';
import { aiBridge } from './tools/ai/bridge';

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));
// AI로 만들기(OpenAI SDK)는 .env.local의 OPENAI_API_KEY를 쓴다 (git에 올리지 않는 파일)
const key = loadEnv('development', r('.'), '').OPENAI_API_KEY;
if (key && !process.env.OPENAI_API_KEY) process.env.OPENAI_API_KEY = key;

export default defineConfig({
  plugins: [react(), tailwindcss(), viteSingleFile(), aiBridge(r('.'))],
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
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['src/test-setup.ts'],
  },
});
