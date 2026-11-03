// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';

/** 로컬 실행(npm run dev)의 AI로 만들기: 키가 없어도 올라마 모델을 고를 수 있다 (tools/ai/openaiAgent.ts) */
describe('올라마 모델 목록', () => {
  it('도구를 쓸 수 있는 모델만, 꺼져 있으면 빈 목록', async () => {
    const { ollamaModels, ollamaBase, isOpenAiModel } = await import('../../tools/ai/openaiAgent');
    const tags = { models: [{ name: 'gemma4:26b', capabilities: ['completion', 'tools'] }, { name: 'embed:1b', capabilities: ['embedding'] }, { name: 'old:7b' }] };
    const ok = vi.fn(async () => new Response(JSON.stringify(tags))) as unknown as typeof fetch;
    expect(await ollamaModels(ok)).toEqual(['gemma4:26b', 'old:7b']);
    expect(String(vi.mocked(ok).mock.calls[0][0])).toBe(`${ollamaBase()}/api/tags`);
    const down = vi.fn(async () => { throw new Error('ECONNREFUSED'); }) as unknown as typeof fetch;
    expect(await ollamaModels(down)).toEqual([]);
    expect([isOpenAiModel(undefined), isOpenAiModel('gpt-6-luna'), isOpenAiModel('gemma4:26b')]).toEqual([true, true, false]);
  });
});
