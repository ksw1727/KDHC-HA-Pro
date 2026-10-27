import { SAMPLE } from '@contract/__tests__/fixtures';
import { vi, beforeEach, afterEach, test, expect } from 'vitest';

const mock = vi.hoisted(() => ({ client: { from: vi.fn(), auth: { getSession: vi.fn(), getBetterAuthInstance: vi.fn() } }, create: vi.fn() }));
vi.mock('@neondatabase/neon-js', () => ({ createClient: mock.create, SupabaseAuthAdapter: vi.fn(options => options) }));
const native = { getSession: vi.fn(), token: vi.fn() };

beforeEach(() => {
  vi.resetModules(); vi.useFakeTimers(); vi.clearAllMocks(); localStorage.clear();
  vi.stubEnv('VITE_CLOUD_MODE', 'true'); vi.stubEnv('VITE_NEON_DATA_API_URL', 'https://example.apirest.neon.tech/neondb/rest/v1');
  mock.create.mockReturnValue(mock.client);
  mock.client.auth.getBetterAuthInstance.mockReturnValue(native);
  native.token.mockResolvedValue({ data: { token: 'test-jwt' }, error: null });
  native.getSession.mockResolvedValue({ data: { user: { id: 'user-a', email: 'test@example.com', emailVerified: true } }, error: null });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
async function setup() {
  const runtime = await import('./runtime'); runtime.setActiveUser('user-a');
  const forms = await import('./forms'); const local = await import('../generator/storage/localForms');
  return { ...runtime, ...forms, ...local };
}
function query(result: unknown) {
  const q = { select: vi.fn(), eq: vi.fn(), insert: vi.fn(), update: vi.fn(), maybeSingle: vi.fn(), order: vi.fn(), range: vi.fn(), then: (resolve: (value: unknown) => void) => Promise.resolve(result).then(resolve) };
  for (const f of [q.select, q.eq, q.insert, q.update, q.maybeSingle, q.order, q.range]) f.mockReturnValue(q);
  return q;
}
test('local mode retains old keys, fetch passthrough and chat no-op', async () => {
  vi.stubEnv('VITE_CLOUD_MODE', 'false');
  const r = await import('./runtime'); const chat = await import('./chat');
  const fetcher = vi.fn().mockResolvedValue(new Response('ok')); vi.stubGlobal('fetch', fetcher);
  expect(r.scopedStorageKey('original')).toBe('original');
  await r.cloudFetch('/api/test', { method: 'POST' }); expect(fetcher).toHaveBeenCalledWith('/api/test', { method: 'POST' });
  expect(await chat.readCloudChat()).toBeNull(); await chat.writeCloudChat({ any: 'json' }); expect(mock.create).not.toHaveBeenCalled();
});
test('cloud keys require authentication and never read anonymous or other-user forms', async () => {
  const r = await setup();
  localStorage.setItem('hanan-moa:forms:' + SAMPLE.list.formId, JSON.stringify({ schema: SAMPLE.list, savedAt: '2026-01-01' }));
  expect(r.listForms()).toEqual([]);
  expect(r.saveForm({ schema: SAMPLE.list }, new Date())).toBe(true);
  expect(r.loadCurrent()?.schema.formId).toBe(SAMPLE.list.formId);
  r.setActiveUser('user-b'); expect(r.listForms()).toEqual([]); expect(r.loadCurrent()).toBeNull();
  r.setActiveUser(null); expect(() => r.scopedStorageKey('x')).toThrow(/로그인/); expect(r.saveForm({ schema: SAMPLE.list }, new Date())).toBe(false);
});
test('missing config is fail-closed and SDK is not instantiated', async () => {
  vi.stubEnv('VITE_NEON_DATA_API_URL', ''); const r = await import('./runtime');
  expect(r.configurationError).toMatch(/클라우드 설정/); expect(() => r.cloudClient()).toThrow(/설정/); expect(mock.create).not.toHaveBeenCalled();
});
test('hydrate includes tombstones, then save uses timestamp CAS', async () => {
  const r = await setup(); const stamp = '2026-01-01T00:00:00.000Z';
  const row = { form_id: SAMPLE.list.formId, payload: { schema: SAMPLE.list, savedAt: stamp }, updated_at: stamp, deleted_at: null };
  mock.client.from.mockReturnValueOnce(query({ data: [row], error: null }));
  await r.hydrateForms(); await r.flushForms(); expect(r.listForms()).toHaveLength(1);
  r.saveForm({ schema: { ...SAMPLE.list, title: 'modified' } }, new Date());
  const update = query({ data: [{ updated_at: '2026-02-01T00:00:00.000Z' }], error: null }); mock.client.from.mockReturnValueOnce(update);
  await r.flushForms(); expect(update.eq).toHaveBeenCalledWith('updated_at', stamp); expect(r.syncStatus().pending).toBe(0);
  mock.client.from.mockReturnValueOnce(query({ data: [{ ...row, deleted_at: stamp }], error: null })); await r.hydrateForms(); expect(r.listForms()).toHaveLength(0);
});
test('conflict preserves local data and blocks silent overwrite', async () => {
  const r = await setup(); r.saveForm({ schema: SAMPLE.list }, new Date());
  const insert = query({ data: null, error: { code: '23505', message: 'duplicate' } }); mock.client.from.mockReturnValue(insert);
  await r.flushForms(); expect(r.syncStatus().conflict).toBe(true); expect(r.syncStatus().pending).toBe(1); expect(r.syncStatus().conflicted).toEqual([SAMPLE.list.title]); expect(r.loadForm(SAMPLE.list.formId)).not.toBeNull();
  // One insert plus one lookup of the server row; the conflicted entry is not retried.
  await r.flushForms(); expect(mock.client.from).toHaveBeenCalledTimes(2);
});
test('충돌처럼 보여도 서버에 이미 같은 내용이 있으면(다른 탭이 먼저 저장) 충돌로 남기지 않는다', async () => {
  const r = await setup(); r.saveForm({ schema: SAMPLE.list }, new Date());
  const payload = JSON.parse(localStorage.getItem(r.scopedStorageKey('hanan-moa:forms:' + SAMPLE.list.formId))!);
  // jsonb reorders keys, so the server copy comes back with a different key order.
  const reordered = Object.fromEntries(Object.entries(payload).reverse());
  mock.client.from.mockReturnValueOnce(query({ data: null, error: { code: '23505', message: 'duplicate' } }))
    .mockReturnValueOnce(query({ data: { form_id: SAMPLE.list.formId, payload: reordered, updated_at: '2026-02-01', deleted_at: null }, error: null }));
  await r.flushForms();
  expect(r.syncStatus()).toMatchObject({ pending: 0, conflict: false, message: '' });
});
test('다시 불러올 때 남아 있던 충돌이 서버와 같은 내용이면 저절로 지운다', async () => {
  const r = await setup(); r.saveForm({ schema: SAMPLE.list }, new Date());
  const payload = JSON.parse(localStorage.getItem(r.scopedStorageKey('hanan-moa:forms:' + SAMPLE.list.formId))!);
  mock.client.from.mockReturnValueOnce(query({ data: null, error: { code: '23505', message: 'duplicate' } }))
    .mockReturnValueOnce(query({ data: null, error: { message: 'offline' } }));
  await r.flushForms(); expect(r.syncStatus().conflict).toBe(true);
  r.stopFormSync();
  mock.client.from.mockReturnValueOnce(query({ data: [{ form_id: SAMPLE.list.formId, payload, updated_at: '2026-02-01', deleted_at: null }], error: null }));
  await r.hydrateForms(); await r.flushForms();
  expect(r.syncStatus()).toMatchObject({ pending: 0, conflict: false });
});
test('여러 탭이 동시에 저장하지 않도록 브라우저 잠금 안에서 서버와 주고받는다', async () => {
  const request = vi.fn((_name: string, fn: () => Promise<void>) => fn());
  vi.stubGlobal('navigator', { ...navigator, locks: { request } });
  const r = await setup(); r.saveForm({ schema: SAMPLE.list }, new Date());
  mock.client.from.mockReturnValueOnce(query({ data: [{ updated_at: '2026-02-01' }], error: null }));
  await r.flushForms();
  expect(request).toHaveBeenCalledWith('hanan-moa:form-sync:user-a', expect.any(Function)); expect(r.syncStatus().pending).toBe(0);
});
test('offline save persists pending queue, reload hydrates same-user pending and retries', async () => {
  const r = await setup(); r.saveForm({ schema: SAMPLE.list }, new Date());
  mock.client.from.mockReturnValueOnce(query({ data: null, error: { message: 'offline' } })); await r.flushForms(); expect(r.syncStatus().message).toMatch(/이 기기에만/);
  r.stopFormSync(); mock.client.from.mockReturnValueOnce(query({ data: [], error: null })).mockReturnValueOnce(query({ data: [{ updated_at: '2026-02-01' }], error: null }));
  await r.hydrateForms(); await r.flushForms(); expect(r.syncStatus().pending).toBe(0); expect(r.listForms()).toHaveLength(1);
});
test('remove queues a tombstone with full StoredForm, not a hard delete', async () => {
  const r = await setup(); r.saveForm({ schema: SAMPLE.list }, new Date()); r.removeForm(SAMPLE.list.formId);
  const insert = query({ data: [{ updated_at: '2026-02-01' }], error: null }); mock.client.from.mockReturnValue(insert);
  await r.flushForms(); expect(r.listForms()).toHaveLength(0);
  const row = insert.insert.mock.calls[0][0]; expect(row.deleted_at).toBeTruthy(); expect(row.payload.schema).toEqual(SAMPLE.list);
});
test('cloudFetch includes Bearer and rejects other origins and auth failures', async () => {
  const r = await setup(); mock.client.auth.getSession.mockResolvedValue({ data: { session: { user: { id: 'user-a' }, access_token: 'test-token' } }, error: null });
  const fetcher = vi.fn().mockResolvedValue(new Response('ok')); vi.stubGlobal('fetch', fetcher);
  await r.cloudFetch('/api/test'); expect(fetcher.mock.calls[0][1].headers.get('Authorization')).toBe('Bearer test-jwt');
  expect(native.token).toHaveBeenCalledWith({ fetchOptions: { headers: { 'X-Force-Fetch': 'true' }, cache: 'no-store' } });
  await expect(r.cloudFetch('https://untrusted.example/api')).rejects.toThrow(/같은 사이트/);
  fetcher.mockResolvedValue(new Response('', { status: 401 })); await expect(r.cloudFetch('/api/test')).rejects.toThrow(/인증/);
});
test('chat requires read first and refuses timestamp conflicts', async () => {
  await setup(); const chat = await import('./chat');
  await expect(chat.writeCloudChat({ msgs: [] })).rejects.toThrow(/먼저/);
  mock.client.from.mockReturnValueOnce(query({ data: { payload: { msgs: ['old'] }, updated_at: '2026-01-01' }, error: null })); expect(await chat.readCloudChat()).toEqual({ msgs: ['old'] });
  const update = query({ data: [], error: null }); mock.client.from.mockReturnValueOnce(update)
    .mockReturnValueOnce(query({ data: { payload: { msgs: ['other device'] }, updated_at: '2026-01-02' }, error: null }));
  await expect(chat.writeCloudChat({ msgs: ['new'] })).rejects.toThrow(/다른 기기/); expect(update.eq).toHaveBeenCalledWith('updated_at', '2026-01-01');
});

test('chat: 같은 창에서 시간표만 어긋났으면(서버 내용은 그대로) 다시 맞춰 저장한다', async () => {
  await setup(); const chat = await import('./chat');
  mock.client.from.mockReturnValueOnce(query({ data: { payload: { msgs: ['old'], chatId: 'c' }, updated_at: '2026-01-01' }, error: null })); await chat.readCloudChat();
  const retry = query({ data: [{ updated_at: '2026-01-03' }], error: null });
  mock.client.from.mockReturnValueOnce(query({ data: [], error: null }))
    .mockReturnValueOnce(query({ data: { payload: { chatId: 'c', msgs: ['old'], savedAt: 'x' }, updated_at: '2026-01-02' }, error: null }))
    .mockReturnValueOnce(retry);
  await chat.writeCloudChat({ msgs: ['new'] });
  expect(retry.eq).toHaveBeenCalledWith('updated_at', '2026-01-02');
});

test('Neon client uses first-party cookie auth and distinct Data API', async () => {
  const r = await setup(); r.cloudClient();
  const config = mock.create.mock.calls[0][0];
  expect(config.auth.url).toBe(window.location.origin + '/api/auth');
  expect(config.auth.adapter.fetchOptions.credentials).toBe('include');
  expect(config.dataApi.url).toContain('apirest.neon.tech');
});
test('verified session and approved flat account response are both required', async () => {
  const r = await setup();
  const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: 'user-a', email: 'test@example.com', emailVerified: true, approved: true }))); vi.stubGlobal('fetch', fetcher);
  expect(await r.verifyCloudAccount('user-a')).toEqual({ id: 'user-a', email: 'test@example.com' });
  expect(native.token).toHaveBeenCalledWith({ fetchOptions: { headers: { 'X-Force-Fetch': 'true' }, cache: 'no-store' } });
  expect(fetcher.mock.calls[0][0]).toBe('/api/account'); expect(fetcher.mock.calls[0][1].headers.Authorization).toBe('Bearer test-jwt');
  expect(fetcher.mock.calls[0][1].credentials).toBe('include');
});
test('unverified email is blocked before account or data access', async () => {
  const r = await setup(); native.getSession.mockResolvedValue({ data: { user: { id: 'user-a', email: 'test@example.com', emailVerified: false } }, error: null });
  const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
  await expect(r.verifyCloudAccount('user-a')).rejects.toThrow(/이메일 인증/); expect(fetcher).not.toHaveBeenCalled(); expect(mock.client.from).not.toHaveBeenCalled();
});
test('unapproved, mismatched account and missing account endpoint fail closed', async () => {
  const r = await setup(); const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
  fetcher.mockResolvedValueOnce(new Response('', { status: 403 })); await expect(r.verifyCloudAccount('user-a')).rejects.toThrow(/허용된 계정/);
  fetcher.mockResolvedValueOnce(new Response(JSON.stringify({ id: 'user-b', email: 'test@example.com', emailVerified: true, approved: true }))); await expect(r.verifyCloudAccount('user-a')).rejects.toThrow(/허용목록/);
  fetcher.mockResolvedValueOnce(new Response('', { status: 404 })); await expect(r.verifyCloudAccount('user-a')).rejects.toThrow(/권한 확인/);
});
test('missing JWT never sends an opaque session token to the server', async () => {
  const r = await setup(); mock.client.auth.getSession.mockResolvedValue({ data: { session: { user: { id: 'user-a' }, access_token: 'opaque-not-jwt' } }, error: null });
  native.token.mockResolvedValue({ data: null, error: { message: 'not available' } });
  const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher); await expect(r.cloudFetch('/api/test')).rejects.toThrow(/인증 토큰/); expect(fetcher).not.toHaveBeenCalled();
});
test('취합 기록 삭제: 서버 행(본인 것)을 먼저 지우고, 실패하면 이 기기 기록도 남긴다', async () => {
  const r = await setup(); const h = await import('../workspace/history');
  localStorage.setItem(r.scopedStorageKey('hanan-moa:aggregations'), JSON.stringify([
    { id: 'a1', doneAt: '2026-10-23T01:00:00Z', synced: true, formId: 'f', formVersion: 1, title: 'x', layout: 'list', unit: '지사', total: 1, got: 1, missing: [], rows: 1, checked: 0, verifyOk: true },
  ]));
  const fail = { ...query({ error: { message: 'denied' } }), delete: vi.fn() }; fail.delete.mockReturnValue(fail);
  mock.client.from.mockReturnValueOnce(fail);
  const bad = await h.removeAggregation('a1');
  expect(bad.error).toMatch(/지우지 못했어요/); expect(bad.list).toHaveLength(1);
  const ok = { ...query({ error: null }), delete: vi.fn() }; ok.delete.mockReturnValue(ok);
  mock.client.from.mockReturnValueOnce(ok);
  const good = await h.removeAggregation('a1');
  expect(mock.client.from).toHaveBeenLastCalledWith('moa_aggregations');
  expect(ok.eq.mock.calls).toEqual([['id', 'a1'], ['user_id', 'user-a']]);
  expect(good.error).toBeUndefined(); expect(good.list).toEqual([]);
});

test('충돌로 묶인 양식도 [삭제]하면 충돌을 풀고 서버 버전과 상관없이 지운다 (지운 양식이 다시 살아나지 않게)', async () => {
  const r = await setup(); const stamp = '2026-01-01T00:00:00.000Z';
  const row = { form_id: SAMPLE.list.formId, payload: { schema: SAMPLE.list, savedAt: stamp }, updated_at: stamp, deleted_at: null };
  mock.client.from.mockReturnValueOnce(query({ data: [row], error: null }));
  await r.hydrateForms(); await r.flushForms();
  // 다른 기기가 먼저 고쳐서 이 기기 수정은 충돌로 남는다
  r.saveForm({ schema: { ...SAMPLE.list, title: '이 기기 수정' } }, new Date());
  mock.client.from.mockReturnValueOnce(query({ data: [], error: null }))
    .mockReturnValueOnce(query({ data: { ...row, updated_at: '2026-03-01T00:00:00.000Z' }, error: null }));
  await r.flushForms(); expect(r.syncStatus().conflict).toBe(true);
  r.removeForm(SAMPLE.list.formId);
  expect(r.syncStatus().conflict).toBe(false);
  const del = query({ data: [{ updated_at: '2026-03-02T00:00:00.000Z' }], error: null }); mock.client.from.mockReturnValueOnce(del);
  await r.flushForms();
  const sent = del.update.mock.calls[0][0];
  expect(sent.deleted_at).toBeTruthy(); expect(sent.payload).toBeUndefined();
  expect(del.eq).not.toHaveBeenCalledWith('updated_at', expect.anything());
  expect(r.syncStatus()).toMatchObject({ pending: 0, conflict: false });
  expect(r.listForms()).toHaveLength(0);
});
test('지운 뒤 다시 불러올 때 서버 버전이 달라도 충돌로 묶지 않고 지우기를 보낸다', async () => {
  const r = await setup(); const stamp = '2026-01-01T00:00:00.000Z';
  const row = { form_id: SAMPLE.list.formId, payload: { schema: SAMPLE.list, savedAt: stamp }, updated_at: stamp, deleted_at: null };
  mock.client.from.mockReturnValueOnce(query({ data: [row], error: null }));
  await r.hydrateForms(); await r.flushForms();
  mock.client.from.mockReturnValueOnce(query({ data: null, error: { message: 'offline' } }));
  r.removeForm(SAMPLE.list.formId); await r.flushForms();
  r.stopFormSync();
  const del = query({ data: [{ updated_at: '2026-03-02T00:00:00.000Z' }], error: null });
  mock.client.from.mockReturnValueOnce(query({ data: [{ ...row, updated_at: '2026-03-01T00:00:00.000Z' }], error: null })).mockReturnValueOnce(del);
  await r.hydrateForms(); await r.flushForms();
  expect(r.listForms()).toHaveLength(0);
  expect(r.syncStatus()).toMatchObject({ pending: 0, conflict: false });
  expect(del.update.mock.calls[0][0].deleted_at).toBeTruthy();
});
test('이 기기에서 처음 올리는 양식을 지웠는데 서버에 이미 있으면 그 행을 지운다', async () => {
  const r = await setup(); r.saveForm({ schema: SAMPLE.list }, new Date()); r.removeForm(SAMPLE.list.formId);
  const tomb = query({ data: [{ updated_at: '2026-03-02T00:00:00.000Z' }], error: null });
  mock.client.from.mockReturnValueOnce(query({ data: null, error: { code: '23505', message: 'duplicate' } })).mockReturnValueOnce(tomb);
  await r.flushForms();
  expect(tomb.update.mock.calls[0][0].deleted_at).toBeTruthy();
  expect(r.syncStatus()).toMatchObject({ pending: 0, conflict: false });
});

function query2(result: unknown) {
  const q = { ...query(result), contains: vi.fn(), limit: vi.fn(), upsert: vi.fn() } as ReturnType<typeof query> & { contains: ReturnType<typeof vi.fn>; limit: ReturnType<typeof vi.fn>; upsert: ReturnType<typeof vi.fn> };
  for (const f of [q.select, q.eq, q.order, q.maybeSingle, q.contains, q.limit, q.upsert]) f.mockReturnValue(q);
  return q;
}
test('대화 보관함(온라인): 서버에 본인 행으로 남기고, 양식 번호로 그 대화를 찾는다', async () => {
  await setup(); const th = await import('../ai/threads');
  const up = query2({ data: null, error: null }); mock.client.from.mockReturnValueOnce(up);
  expect(await th.saveThread({ threadId: 't1', chatId: 'c1', aiVersion: null, msgs: [{ role: 'ai', text: '', form: SAMPLE.list }] })).toBeNull();
  expect(mock.client.from).toHaveBeenLastCalledWith('moa_chat_threads');
  const row = up.upsert.mock.calls[0][0];
  expect(row).toMatchObject({ user_id: 'user-a', thread_id: 't1', form_ids: [SAMPLE.list.formId] });
  expect(up.upsert.mock.calls[0][1]).toEqual({ onConflict: 'user_id,thread_id' });
  // 다른 기기에서 더 나중에 이어 간 대화가 서버에 있으면 그것을 쓴다
  const later = new Date(Date.now() + 60_000).toISOString();
  const find = query2({ data: [{ thread_id: 't1', title: 'x', form_ids: [SAMPLE.list.formId], updated_at: later, payload: { chatId: 'c1', msgs: [{ role: 'user', text: '다른 기기에서 이어 간 말' }], aiVersion: null } }], error: null });
  mock.client.from.mockReturnValueOnce(find);
  const t = await th.findThreadForForm(SAMPLE.list.formId);
  expect(find.contains).toHaveBeenCalledWith('form_ids', [SAMPLE.list.formId]);
  expect(t?.msgs).toEqual([{ role: 'user', text: '다른 기기에서 이어 간 말', status: undefined }]);
});
test('보관함이 없던 예전 양식은 서버 AI 대화 기록에서 글만 되살리고 같은 대화 번호로 잇는다', async () => {
  await setup(); const th = await import('../ai/threads');
  const q = query2({ data: [{ id: 'chat-1', updated_at: '2026-10-23', form: SAMPLE.list, conversation: [{ role: 'user', content: '(사용자가 빌더에서 form.json을 직접 고쳤어요. 지금 form.json에서 이어서 해 주세요.)\n교육비 빼 주세요' }, { role: 'assistant', content: '뺐어요' }] }], error: null });
  mock.client.from.mockReturnValueOnce(q);
  const r = await th.recoverFromServerChat(SAMPLE.list.formId);
  expect(q.eq).toHaveBeenCalledWith('form->>formId', SAMPLE.list.formId);
  expect(r).toMatchObject({ chatId: 'chat-1', msgs: [{ role: 'user', text: '교육비 빼 주세요' }, { role: 'ai', text: '뺐어요' }] });
  expect(r?.form?.formId).toBe(SAMPLE.list.formId);
});
