import { readNdjson, requireOk } from '../http';
describe('AI response transport', () => {
  it.each([[401, '로그인'], [403, '권한'], [413, '너무 커'], [500, 'server failed']])('rejects HTTP %s before reading stream', async (status, text) => {
    await expect(requireOk(new Response(JSON.stringify({ error: 'server failed' }), { status: status as number }))).rejects.toThrow(text as string);
  });
  it('parses trailing NDJSON, unicode split chunks, and error events', async () => {
    const bytes = new TextEncoder().encode('{"type":"text","text":"한글"}\n{"type":"error","text":"모델 오류"}');
    const stream = new ReadableStream({ start(c) { c.enqueue(bytes.slice(0, 25)); c.enqueue(bytes.slice(25)); c.close(); } });
    const events: unknown[] = []; await readNdjson(new Response(stream), (e) => events.push(e));
    expect(events).toEqual([{ type: 'text', text: '한글' }, { type: 'error', text: '모델 오류' }]);
  });
  it('reports malformed NDJSON rather than ignoring it', async () => {
    await expect(readNdjson(new Response('not json'), () => {})).rejects.toThrow('응답 형식');
  });
});

describe('서버 안내 문구', () => {
  it('한도 초과 같은 서버 안내는 앞말 없이 그대로 전달한다', async () => {
    const { requireOk, ServerMessageError } = await import('../http');
    const res = new Response(JSON.stringify({ error: '오늘 AI 사용 한도에 도달했어요.' }), { status: 429 });
    await expect(requireOk(res)).rejects.toBeInstanceOf(ServerMessageError);
    await expect(requireOk(new Response(JSON.stringify({ error: '오늘 AI 사용 한도에 도달했어요.' }), { status: 429 }))).rejects.toThrow(/^오늘 AI 사용 한도에 도달했어요\.$/);
  });
});
