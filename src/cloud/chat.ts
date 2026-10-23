import { activeUser, cloudClient, cloudEnabled, requireUser } from './runtime';
import { canonicalJSON } from '../contract/checksum';
/** content: 이 창이 마지막으로 읽거나 쓴 대화 내용 (savedAt 빼고, 키 순서 무관). 시간표만 어긋난 것과 진짜 충돌을 가른다 */
let baseline: { user: string; version: string | null; content: string } | null = null;
let writing = false;
const contentOf = (payload: unknown) => {
  if (!payload || typeof payload !== 'object') return canonicalJSON(payload ?? null);
  const { savedAt: _, ...rest } = payload as Record<string, unknown>;
  return canonicalJSON(rest);
};
export async function readCloudChat(): Promise<unknown | null> {
  if (!cloudEnabled) return null;
  const user = requireUser();
  const { data, error } = await cloudClient().from('moa_chat_drafts').select('payload,updated_at').eq('user_id', user).maybeSingle();
  if (error) throw new Error(`AI 대화 불러오기 실패: ${error.message}`);
  if (activeUser() !== user) throw new Error('사용자가 변경되었습니다.');
  baseline = { user, version: data?.updated_at ?? null, content: contentOf(data?.payload) };
  return data?.payload ?? null;
}
export async function writeCloudChat(payload: unknown): Promise<void> {
  if (!cloudEnabled) return;
  const user = requireUser();
  if (writing) throw new Error('대화 저장 중입니다. 저장이 끝난 뒤 다시 시도하세요.');
  if (baseline?.user !== user) throw new Error('대화를 먼저 불러온 뒤 저장하세요.');
  writing = true;
  try {
    const content = contentOf(payload);
    // 같은 창 안에서 읽기·쓰기가 엇갈려 시간표만 어긋난 경우(서버 내용은 이 창이 아는 것 그대로)는 한 번 다시 맞춰 저장한다
    for (let attempt = 0; ; attempt++) {
      const version = baseline.version;
      const updated_at = new Date(Math.max(Date.now(), Date.parse(version ?? '') + 1 || 0)).toISOString();
      const row = { user_id: user, payload, updated_at };
      const { data, error } = version === null
        ? await cloudClient().from('moa_chat_drafts').insert(row).select('updated_at')
        : await cloudClient().from('moa_chat_drafts').update(row).eq('user_id', user).eq('updated_at', version).select('updated_at');
      if (activeUser() !== user) throw new Error('사용자가 변경되었습니다.');
      if (!error && data?.length) { baseline = { user, version: data[0].updated_at, content }; return; }
      if (error && error.code !== '23505') throw new Error(`대화 저장 실패: ${error.message}`);
      const server = await cloudClient().from('moa_chat_drafts').select('payload,updated_at').eq('user_id', user).maybeSingle();
      if (server.error) throw new Error(`대화 저장 실패: ${server.error.message}`);
      const now = contentOf(server.data?.payload);
      if (now === content) { baseline = { user, version: server.data?.updated_at ?? null, content }; return; }
      if (attempt > 0 || now !== baseline.content) throw new Error('다른 기기나 다른 창에서 대화가 변경되었습니다. 서버 대화를 다시 불러오세요. 로컬 대화는 유지하세요.');
      baseline = { user, version: server.data?.updated_at ?? null, content: now };
    }
  } finally { writing = false; }
}
