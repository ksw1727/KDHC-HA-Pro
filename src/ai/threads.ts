import { canonicalJSON } from '@contract/checksum';
import { validateSchema, type FormSchema } from '@contract/schema';
import { cloudEnabled, findCloudThreadByForm, findServerChatByForm, listCloudThreads, readCloudThread, scopedStorageKey, upsertCloudThread, type CloudThread } from '../cloud';
import { parseDraft } from './useCloudDraft';

/**
 * AI로 만들기 대화 보관함. 지금 화면 대화(초안)와 별도로, 대화마다 말풍선·양식 카드를 통째로 남긴다.
 * - 내 업무공간 일정·양식에서 양식을 열면 그 양식을 만든 대화를 찾아 다시 보여 준다 (formIds)
 * - [대화 목록]에서 예전 대화로 돌아간다
 * 이 기기 보관(localStorage)은 늘 쓰고, 온라인이면 서버 표 moa_chat_threads에도 남긴다.
 */
export interface Thread { threadId: string; chatId: string | null; msgs: unknown[]; aiVersion: string | null; title: string; formIds: string[]; updatedAt: string }
export type ThreadSummary = Pick<Thread, 'threadId' | 'title' | 'formIds' | 'updatedAt'>;
interface MsgLike { role?: string; text?: string; form?: { formId?: string; title?: string }; status?: string }

const KEY = 'hanan-moa:ai-threads';
const MAX_LOCAL = 20;

export const newThreadId = (): string => crypto.randomUUID();

/** 목록에 보일 이름: 대화의 마지막 양식 제목, 없으면 첫 말 */
export function threadTitle(msgs: unknown[]): string {
  const xs = msgs as MsgLike[];
  const form = [...xs].reverse().find((m) => m.form?.title?.trim())?.form?.title?.trim();
  const first = xs.find((m) => m.role === 'user' && m.text?.trim())?.text?.trim().replace(/\s+/g, ' ');
  const t = form || first || '새 대화';
  return t.length > 60 ? `${t.slice(0, 60)}…` : t;
}
export function threadFormIds(msgs: unknown[]): string[] {
  return [...new Set((msgs as MsgLike[]).map((m) => m.form?.formId).filter((x): x is string => !!x))];
}

function readLocal(): Record<string, Thread> {
  try {
    const v = JSON.parse(localStorage.getItem(scopedStorageKey(KEY)) ?? '{}');
    return v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, Thread> : {};
  } catch { return {}; }
}
function writeLocal(map: Record<string, Thread>) {
  const sorted = Object.values(map).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  for (const n of [MAX_LOCAL, 5, 1]) {
    try { localStorage.setItem(scopedStorageKey(KEY), JSON.stringify(Object.fromEntries(sorted.slice(0, n).map((t) => [t.threadId, t])))); return; } catch { /* 공간이 모자라면 오래된 대화부터 줄인다 */ }
  }
}
const content = (t: Pick<Thread, 'chatId' | 'msgs' | 'aiVersion'>) => canonicalJSON({ chatId: t.chatId, msgs: t.msgs, aiVersion: t.aiVersion });

function fromCloud(row: CloudThread): Thread | null {
  const d = parseDraft(row.payload);
  if (!d) return null;
  return { threadId: row.thread_id, chatId: d.chatId, msgs: d.msgs, aiVersion: d.aiVersion, title: row.title, formIds: row.form_ids ?? [], updatedAt: row.updated_at };
}
const newer = (a: Thread | null, b: Thread | null) => (!a ? b : !b ? a : Date.parse(b.updatedAt) > Date.parse(a.updatedAt) ? b : a);

/** 지금 대화를 보관함에 남긴다. 내용이 그대로면 다시 쓰지 않는다. 서버에 못 남기면 그 이유를 돌려준다 (이 기기에는 남음) */
export async function saveThread(t: Pick<Thread, 'chatId' | 'msgs' | 'aiVersion'> & { threadId: string | null }): Promise<string | null> {
  if (!t.threadId || !t.msgs.length) return null;
  const msgs = (t.msgs as MsgLike[]).map((m) => ({ ...m, status: undefined }));
  const map = readLocal();
  const prev = map[t.threadId];
  const next: Thread = { threadId: t.threadId as string, chatId: t.chatId, msgs, aiVersion: t.aiVersion, title: threadTitle(msgs), formIds: threadFormIds(msgs), updatedAt: new Date().toISOString() };
  if (prev && content(prev) === content(JSON.parse(JSON.stringify(next)))) return null;
  map[t.threadId] = next;
  writeLocal(map);
  if (!cloudEnabled) return null;
  try {
    await upsertCloudThread({ threadId: next.threadId, title: next.title, formIds: next.formIds, payload: { threadId: next.threadId, chatId: next.chatId, msgs, aiVersion: next.aiVersion }, updatedAt: next.updatedAt });
    return null;
  } catch (e) {
    return (e as Error).message;
  }
}

/** 대화 목록 (최근 순). 서버 목록을 못 읽으면 이 기기 목록만 */
export async function listThreads(): Promise<{ list: ThreadSummary[]; error?: string }> {
  const byId = new Map<string, ThreadSummary>();
  for (const t of Object.values(readLocal())) byId.set(t.threadId, { threadId: t.threadId, title: t.title, formIds: t.formIds, updatedAt: t.updatedAt });
  let error: string | undefined;
  if (cloudEnabled) {
    try {
      for (const r of await listCloudThreads()) {
        const had = byId.get(r.thread_id);
        if (!had || Date.parse(r.updated_at) > Date.parse(had.updatedAt)) byId.set(r.thread_id, { threadId: r.thread_id, title: r.title, formIds: r.form_ids ?? [], updatedAt: r.updated_at });
      }
    } catch (e) { error = (e as Error).message; }
  }
  return { list: [...byId.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)), error };
}

export async function loadThread(threadId: string): Promise<Thread | null> {
  const local = readLocal()[threadId] ?? null;
  if (!cloudEnabled) return local;
  try {
    const row = await readCloudThread(threadId);
    return newer(local, row ? fromCloud(row) : null);
  } catch { return local; }
}

/** 이 양식을 만든(또는 마지막으로 다룬) 대화 */
export async function findThreadForForm(formId: string): Promise<Thread | null> {
  const local = Object.values(readLocal()).filter((t) => t.formIds.includes(formId)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0] ?? null;
  if (!cloudEnabled) return local;
  try {
    const row = await findCloudThreadByForm(formId);
    return newer(local, row ? fromCloud(row) : null);
  } catch { return local; }
}

/**
 * 보관함이 생기기 전에 만든 양식: 서버 AI 대화 기록(최근 글 12번)에서 글만 되살린다.
 * chatId를 그대로 이어 써서, 다음 말은 그 대화에 이어서 간다.
 */
export async function recoverFromServerChat(formId: string): Promise<{ chatId: string; msgs: { role: 'user' | 'ai'; text: string }[]; form: FormSchema | null } | null> {
  if (!cloudEnabled) return null;
  const chat = await findServerChatByForm(formId);
  if (!chat) return null;
  const msgs = (Array.isArray(chat.conversation) ? chat.conversation : [])
    .filter((t) => t && typeof t.content === 'string' && (t.role === 'user' || t.role === 'assistant'))
    // 빌더에서 고친 양식을 넘길 때 붙인 안내 "(사용자가 …)" 줄은 화면에 보이지 않던 것이라 뺀다
    .map((t) => ({ role: t.role === 'user' ? 'user' as const : 'ai' as const, text: t.role === 'user' ? t.content.replace(/^\([^\n]*\)\n/, '') : t.content }));
  const v = chat.form ? validateSchema(chat.form) : null;
  return { chatId: chat.id, msgs, form: v && v.ok ? v.schema : null };
}
