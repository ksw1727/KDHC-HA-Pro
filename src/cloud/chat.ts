import { activeUser, cloudClient, cloudEnabled, requireUser } from './runtime';
let baseline: { user: string; version: string | null } | null = null;
let writing = false;
export async function readCloudChat(): Promise<unknown | null> {
  if (!cloudEnabled) return null;
  const user = requireUser();
  const { data, error } = await cloudClient().from('moa_chat_drafts').select('payload,updated_at').eq('user_id', user).maybeSingle();
  if (error) throw new Error(`AI 대화 불러오기 실패: ${error.message}`);
  if (activeUser() !== user) throw new Error('사용자가 변경되었습니다.');
  baseline = { user, version: data?.updated_at ?? null };
  return data?.payload ?? null;
}
export async function writeCloudChat(payload: unknown): Promise<void> {
  if (!cloudEnabled) return;
  const user = requireUser();
  if (writing) throw new Error('대화 저장 중입니다. 저장이 끝난 뒤 다시 시도하세요.');
  if (baseline?.user !== user) throw new Error('대화를 먼저 불러온 뒤 저장하세요.');
  const version = baseline.version;
  const updated_at = new Date(Math.max(Date.now(), Date.parse(version ?? '') + 1 || 0)).toISOString();
  writing = true;
  try {
    const row = { user_id: user, payload, updated_at };
    const { data, error } = version === null
      ? await cloudClient().from('moa_chat_drafts').insert(row).select('updated_at')
      : await cloudClient().from('moa_chat_drafts').update(row).eq('user_id', user).eq('updated_at', version).select('updated_at');
    if (error || !data?.length) throw new Error(error?.code === '23505' || !error ? '다른 기기에서 대화가 변경되었습니다. 서버 대화를 다시 불러오세요. 로컬 대화는 유지하세요.' : `대화 저장 실패: ${error.message}`);
    if (activeUser() !== user) throw new Error('사용자가 변경되었습니다.');
    baseline = { user, version: data[0].updated_at };
  } finally { writing = false; }
}
