import { activeUser, cloudClient, cloudEnabled, requireUser } from './runtime';

/**
 * AI 대화 보관함 (서버 표 moa_chat_threads, neon/migrations/202610260001_chat_threads.sql).
 * 화면 대화 하나 = 한 줄. form_ids로 그 양식을 만든 대화를 찾는다. 지금 대화(moa_chat_drafts)와 따로 둔다.
 */
export interface CloudThread { thread_id: string; title: string; form_ids: string[]; updated_at: string; payload?: unknown }
/** 서버 AI 대화 기록 (moa_ai_chats): 글만 최근 12번 남아 있다. 보관함이 생기기 전에 만든 양식을 되살릴 때 쓴다 */
export interface ServerChat { id: string; conversation: { role: string; content: string }[]; form: unknown; updated_at: string }

const TABLE = 'moa_chat_threads';
function same(user: string) { if (activeUser() !== user) throw new Error('사용자가 변경되었습니다.'); }

export async function upsertCloudThread(t: { threadId: string; title: string; formIds: string[]; payload: unknown; updatedAt: string }): Promise<void> {
  if (!cloudEnabled) return;
  const user = requireUser();
  const { error } = await cloudClient().from(TABLE)
    .upsert({ user_id: user, thread_id: t.threadId, title: t.title, form_ids: t.formIds, payload: t.payload, updated_at: t.updatedAt }, { onConflict: 'user_id,thread_id' });
  same(user);
  if (error) throw new Error(`대화 보관 실패: ${error.message}`);
}
export async function listCloudThreads(limit = 30): Promise<CloudThread[]> {
  if (!cloudEnabled) return [];
  const user = requireUser();
  const { data, error } = await cloudClient().from(TABLE).select('thread_id,title,form_ids,updated_at').eq('user_id', user).order('updated_at', { ascending: false }).limit(limit);
  same(user);
  if (error) throw new Error(`대화 목록 불러오기 실패: ${error.message}`);
  return (data ?? []) as CloudThread[];
}
export async function readCloudThread(threadId: string): Promise<CloudThread | null> {
  if (!cloudEnabled) return null;
  const user = requireUser();
  const { data, error } = await cloudClient().from(TABLE).select('thread_id,title,form_ids,updated_at,payload').eq('user_id', user).eq('thread_id', threadId).maybeSingle();
  same(user);
  if (error) throw new Error(`대화 불러오기 실패: ${error.message}`);
  return (data ?? null) as CloudThread | null;
}
export async function findCloudThreadByForm(formId: string): Promise<CloudThread | null> {
  if (!cloudEnabled) return null;
  const user = requireUser();
  const { data, error } = await cloudClient().from(TABLE).select('thread_id,title,form_ids,updated_at,payload').eq('user_id', user).contains('form_ids', [formId]).order('updated_at', { ascending: false }).limit(1);
  same(user);
  if (error) throw new Error(`대화 찾기 실패: ${error.message}`);
  return ((data ?? [])[0] ?? null) as CloudThread | null;
}
export async function findServerChatByForm(formId: string): Promise<ServerChat | null> {
  if (!cloudEnabled) return null;
  const user = requireUser();
  const { data, error } = await cloudClient().from('moa_ai_chats').select('id,conversation,form,updated_at').eq('user_id', user).eq('form->>formId', formId).order('updated_at', { ascending: false }).limit(1);
  same(user);
  if (error) throw new Error(`대화 기록 찾기 실패: ${error.message}`);
  return ((data ?? [])[0] ?? null) as ServerChat | null;
}
