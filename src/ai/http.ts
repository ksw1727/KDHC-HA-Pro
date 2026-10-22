/** 서버가 보낸 안내 문구(한도 초과 등). 화면에 앞말 없이 그대로 보여 준다 */
export class ServerMessageError extends Error {}

export async function requireOk(response: Response): Promise<Response> {
  if (response.ok) return response;
  const raw = await response.text();
  let detail = raw;
  try { const value = JSON.parse(raw); detail = value.error?.message ?? value.error ?? value.message ?? raw; } catch { /* plain error */ }
  if (response.status === 401) throw new Error('로그인이 만료되었어요. 다시 로그인해 주세요.');
  if (response.status === 403) throw new Error('AI 사용 권한이 없어요. 관리자에게 문의해 주세요.');
  if (response.status === 413) throw new Error('전송 내용이 너무 커요. 양식이나 첨부를 줄여 주세요.');
  if (typeof detail === 'string' && detail.trim() && detail.length <= 300) throw new ServerMessageError(detail.trim());
  throw new Error(`요청 실패 (${response.status}): ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`);
}

export async function readNdjson(response: Response, onEvent: (event: unknown) => void): Promise<void> {
  await requireOk(response);
  if (!response.body) throw new Error('연결 서버가 답하지 않아요');
  const reader = response.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  const parse = (line: string) => {
    if (!line.trim()) return;
    try { onEvent(JSON.parse(line)); } catch (error) { throw new Error(`AI 응답 형식 오류: ${(error as Error).message}`); }
  };
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let index: number;
      while ((index = buf.indexOf('\n')) >= 0) { parse(buf.slice(0, index)); buf = buf.slice(index + 1); }
    }
    buf += dec.decode();
    parse(buf);
  } finally { reader.releaseLock(); }
}
