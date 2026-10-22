// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import type { ServerResponse } from 'node:http';
import { meHandler } from './me';
import { SafeError } from './ai';
import type { Query, Store } from './store';

const ME = { id: '08065277-5ca0-43d2-9df4-d31fb93b1249', email: 'ksw1727@gmail.com', emailVerified: true as const };
const store = (fail = false): Store => ({ user: vi.fn(), chat: vi.fn(), reserve: vi.fn(), finish: vi.fn(), account: vi.fn(async () => { if (fail) throw new SafeError(403, '승인된 계정만'); return ME; }) });
async function run(opts: { method?: string; auth?: boolean; sql: Query; st?: Store; body?: unknown; origin?: string | null }) {
  const headers: Record<string, string> = opts.auth === false ? {} : { authorization: 'Bearer t' };
  if (opts.origin !== null && opts.method === 'POST') headers.origin = opts.origin ?? 'https://moa.example.test';
  const chunks = opts.body === undefined ? [] : [Buffer.from(JSON.stringify(opts.body))];
  const req = Object.assign(new EventEmitter(), { method: opts.method ?? 'GET', headers, async *[Symbol.asyncIterator]() { yield* chunks; } });
  const res = Object.assign(new EventEmitter(), { statusCode: 200, out: '', setHeader() {}, end(s?: string) { this.out = s ?? ''; } });
  await meHandler({ env: { DATABASE_URL: 'x', SERVER_APP_ORIGIN: 'https://moa.example.test' }, store: opts.st ?? store(), sql: opts.sql })(req as never, res as unknown as ServerResponse);
  return { status: res.statusCode, body: JSON.parse(res.out || '{}') };
}
describe('내 계정 정보 API', () => {
  const sql = vi.fn(async () => [{ email: 'ksw1727@gmail.com', name: '김승원', verified: true, has_password: false, is_admin: true }]) as unknown as Query;
  it('로그인한 본인 정보와 비밀번호 유무를 준다', async () => {
    const r = await run({ sql });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ email: 'ksw1727@gmail.com', name: '김승원', emailVerified: true, hasPassword: false, isAdmin: true });
    expect(vi.mocked(sql).mock.calls[0].slice(1)).toEqual([ME.id]);
  });
  it('로그인 없이·미승인·다른 방식 요청은 거절한다', async () => {
    expect((await run({ sql, auth: false })).status).toBe(401);
    expect((await run({ sql, st: store(true) })).status).toBe(403);
    expect((await run({ sql, method: 'PUT' })).status).toBe(405);
  });
  it('DB 오류 내용은 감춘다', async () => {
    const bad = vi.fn(async () => { throw new Error('secret db'); }) as unknown as Query;
    const r = await run({ sql: bad }); expect(r.status).toBe(503); expect(JSON.stringify(r.body)).not.toContain('secret');
  });
});

describe('로그인 이메일 변경', () => {
  const ok = vi.fn(async () => [{ old: 'ksw1727@gmail.com', clash: 0, changed: 1, allowed: 1 }]) as unknown as Query;
  it('본인 이메일을 바꾸고 새 이메일은 인증 전으로 둔다', async () => {
    const r = await run({ method: 'POST', sql: ok, body: { action: 'changeEmail', newEmail: ' New@KDHC.co.kr ' } });
    expect(r.status).toBe(200); expect(r.body).toEqual({ email: 'new@kdhc.co.kr', emailVerified: false });
    expect(vi.mocked(ok).mock.calls[0].slice(1)).toContain(ME.id);
  });
  it('이미 쓰는 이메일·같은 이메일·잘못된 이메일은 거절한다', async () => {
    const clash = vi.fn(async () => [{ old: 'ksw1727@gmail.com', clash: 1, changed: 0, allowed: 0 }]) as unknown as Query;
    expect((await run({ method: 'POST', sql: clash, body: { action: 'changeEmail', newEmail: 'other@x.co' } })).status).toBe(409);
    const same = vi.fn(async () => [{ old: 'ksw1727@gmail.com', clash: 0, changed: 0, allowed: 0 }]) as unknown as Query;
    expect((await run({ method: 'POST', sql: same, body: { action: 'changeEmail', newEmail: 'ksw1727@gmail.com' } })).status).toBe(400);
    expect((await run({ method: 'POST', sql: ok, body: { action: 'changeEmail', newEmail: 'not-email' } })).status).toBe(400);
  });
  it('다른 사이트·출처 없는 요청, 모르는 작업은 막는다', async () => {
    const sql = vi.fn(async () => []) as unknown as Query;
    expect((await run({ method: 'POST', sql, origin: 'https://evil.example', body: { action: 'changeEmail', newEmail: 'a@b.co' } })).status).toBe(403);
    expect((await run({ method: 'POST', sql, origin: null, body: { action: 'changeEmail', newEmail: 'a@b.co' } })).status).toBe(403);
    expect((await run({ method: 'POST', sql, body: { action: 'drop' } })).status).toBe(400);
    expect(vi.mocked(sql)).not.toHaveBeenCalled();
  });
});
