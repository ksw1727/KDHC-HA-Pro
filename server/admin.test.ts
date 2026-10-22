// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import type { ServerResponse } from 'node:http';
import { adminHandler, normalizeEmail, parseLimit, type AdminRequest } from './admin';
import { SafeError } from './ai';
import type { Query, Store } from './store';

const ADMIN = { id: '08065277-5ca0-43d2-9df4-d31fb93b1249', email: 'ksw1727@gmail.com', emailVerified: true as const };
const ORIGIN = 'https://moa.example.test';
const env = { SERVER_APP_ORIGIN: ORIGIN, DATABASE_URL: 'postgres://unused' };

/** 실행된 SQL을 기록하는 가짜 DB. 관리자 확인 결과와 목록 결과를 바꿔 끼울 수 있다 */
function fakeSql(isAdmin = true, target: { is_admin: boolean } | null = { is_admin: false }) {
  const calls: string[] = [];
  const sql = vi.fn(async (strings: TemplateStringsArray) => {
    const q = strings.join('?').replace(/\s+/g, ' ');
    calls.push(q);
    if (q.includes('is_admin is true limit 1')) return isAdmin ? [{ '?column?': 1 }] : [];
    if (q.startsWith('select is_admin from')) return target ? [target] : [];
    if (q.includes('moa_ai_settings s where s.id')) return [{ global_daily_limit: null, default_user_daily_limit: 20, used: 7 }];
    if (q.startsWith('update moa_private.moa_allowed_users set ai_daily_limit')) return target ? [{ email: 'x' }] : [];
    if (q.includes('left join neon_auth')) return [{ email: 'ksw1727@gmail.com', enabled: true, is_admin: true, user_id: ADMIN.id, updated_at: new Date(), verified: true, created: new Date(), ai_daily_limit: null, used_today: 3 }];
    return [];
  }) as unknown as Query;
  return { sql, calls };
}
const store = (fail = false): Store => ({
  user: vi.fn(), chat: vi.fn(), reserve: vi.fn(), finish: vi.fn(),
  account: vi.fn(async () => { if (fail) throw new SafeError(403, '승인된 계정만'); return ADMIN; }),
});
async function run(opts: { method?: string; body?: unknown; auth?: boolean; origin?: string | null; sql: Query; st?: Store }) {
  const headers: Record<string, string> = {};
  if (opts.auth !== false) headers.authorization = 'Bearer test-jwt';
  if (opts.origin !== null) headers.origin = opts.origin ?? ORIGIN;
  const req = Object.assign(new EventEmitter(), { method: opts.method ?? 'GET', headers, body: opts.body, url: '/api/admin' }) as AdminRequest;
  const res = Object.assign(new EventEmitter(), { statusCode: 200, out: '', headers: {} as Record<string, unknown>, setHeader(k: string, v: unknown) { this.headers[k] = v; }, end(s?: string) { this.out = s ?? ''; } });
  await adminHandler({ env, store: opts.st ?? store(), sql: opts.sql })(req, res as unknown as ServerResponse);
  return { status: res.statusCode, body: JSON.parse(res.out || '{}') };
}

describe('관리자 API', () => {
  it('로그인 없이는 거절하고 DB를 건드리지 않는다', async () => {
    const { sql, calls } = fakeSql();
    expect((await run({ auth: false, sql })).status).toBe(401);
    expect(calls).toEqual([]);
  });
  it('승인되지 않은 계정은 거절한다', async () => {
    const { sql } = fakeSql();
    expect((await run({ sql, st: store(true) })).status).toBe(403);
  });
  it('승인됐지만 관리자가 아니면 목록도 볼 수 없다', async () => {
    const { sql, calls } = fakeSql(false);
    const r = await run({ sql });
    expect(r.status).toBe(403);
    expect(calls.some((q) => q.includes('left join neon_auth'))).toBe(false);
  });
  it('관리자는 목록을 본다', async () => {
    const { sql } = fakeSql();
    const r = await run({ sql });
    expect(r.status).toBe(200);
    expect(r.body.users[0]).toMatchObject({ email: 'ksw1727@gmail.com', isAdmin: true, enabled: true });
  });
  it('추가: 로그인 계정 생성(비밀번호 없음, 미인증)과 승인 목록 등록', async () => {
    const { sql, calls } = fakeSql();
    const r = await run({ method: 'POST', body: { action: 'add', email: '  New.User@KDHC.co.kr ' }, sql });
    expect(r.status).toBe(200);
    expect(calls.some((q) => q.startsWith('insert into neon_auth."user"'))).toBe(true);
    expect(calls.some((q) => q.startsWith('insert into moa_private.moa_allowed_users'))).toBe(true);
    const params = vi.mocked(sql).mock.calls.flatMap((c) => c.slice(1));
    expect(params).toContain('new.user@kdhc.co.kr');
  });
  it('다른 사이트에서 온 변경 요청과 출처 없는 변경 요청은 막는다', async () => {
    const { sql, calls } = fakeSql();
    expect((await run({ method: 'POST', body: { action: 'add', email: 'a@b.co' }, origin: 'https://evil.example', sql })).status).toBe(403);
    expect((await run({ method: 'POST', body: { action: 'add', email: 'a@b.co' }, origin: null, sql })).status).toBe(403);
    expect(calls).toEqual([]);
  });
  it('관리자 자신·관리자 계정은 중지/삭제할 수 없다', async () => {
    const self = fakeSql();
    expect((await run({ method: 'POST', body: { action: 'disable', email: ADMIN.email }, sql: self.sql })).status).toBe(400);
    const other = fakeSql(true, { is_admin: true });
    expect((await run({ method: 'POST', body: { action: 'remove', email: 'other-admin@x.co' }, sql: other.sql })).status).toBe(400);
    expect(other.calls.some((q) => q.startsWith('delete'))).toBe(false);
  });
  it('일반 사용자 중지·다시 허용·삭제', async () => {
    for (const action of ['disable', 'enable', 'remove']) {
      const { sql, calls } = fakeSql();
      expect((await run({ method: 'POST', body: { action, email: 'user@kdhc.co.kr' }, sql })).status).toBe(200);
      expect(calls.some((q) => (action === 'remove' ? q.startsWith('delete') : q.startsWith('update')) && q.includes('is_admin is false'))).toBe(true);
    }
  });
  it('없는 사용자·잘못된 작업·잘못된 이메일은 거절한다', async () => {
    expect((await run({ method: 'POST', body: { action: 'disable', email: 'none@x.co' }, sql: fakeSql(true, null).sql })).status).toBe(404);
    expect((await run({ method: 'POST', body: { action: 'drop', email: 'a@b.co' }, sql: fakeSql().sql })).status).toBe(400);
    expect(() => normalizeEmail('not-an-email')).toThrow();
    expect(() => normalizeEmail(`${'a'.repeat(250)}@x.co`)).toThrow();
  });
  it('목록에 오늘 사용량·한도와 전체 설정을 함께 준다', async () => {
    const r = await run({ sql: fakeSql().sql });
    expect(r.body.users[0]).toMatchObject({ aiDailyLimit: null, usedToday: 3 });
    expect(r.body.settings).toEqual({ globalDailyLimit: null, defaultUserDailyLimit: 20, usedTodayGlobal: 7 });
  });
  it('사용자별 한도와 전체·기본 한도를 바꾼다 (빈 값 = 무제한/기본값)', async () => {
    const a = fakeSql();
    expect((await run({ method: 'POST', body: { action: 'setLimit', email: 'user@kdhc.co.kr', limit: 5 }, sql: a.sql })).status).toBe(200);
    expect(vi.mocked(a.sql).mock.calls.some((c) => c[0].join('?').startsWith('update moa_private.moa_allowed_users set ai_daily_limit') && c.slice(1).includes(5))).toBe(true);
    const b = fakeSql();
    expect((await run({ method: 'POST', body: { action: 'setLimit', email: ADMIN.email, limit: '' }, sql: b.sql })).status).toBe(200);
    const c = fakeSql();
    expect((await run({ method: 'POST', body: { action: 'setSettings', globalDailyLimit: 100, defaultUserDailyLimit: null }, sql: c.sql })).status).toBe(200);
    const params = vi.mocked(c.sql).mock.calls.find((x) => x[0].join('?').startsWith('update moa_private.moa_ai_settings'))!.slice(1);
    expect(params).toEqual([100, null]);
  });
  it('잘못된 한도 값과 없는 사용자는 거절한다', async () => {
    expect(parseLimit(null)).toBeNull(); expect(parseLimit('')).toBeNull(); expect(parseLimit('12')).toBe(12); expect(parseLimit(0)).toBe(0);
    for (const v of [-1, 1.5, 'abc', 100001]) expect(() => parseLimit(v)).toThrow();
    expect((await run({ method: 'POST', body: { action: 'setLimit', email: 'user@kdhc.co.kr', limit: -3 }, sql: fakeSql().sql })).status).toBe(400);
    expect((await run({ method: 'POST', body: { action: 'setLimit', email: 'none@x.co', limit: 3 }, sql: fakeSql(true, null).sql })).status).toBe(404);
  });
  it('관리자가 아니면 한도를 바꿀 수 없다', async () => {
    const { sql, calls } = fakeSql(false);
    expect((await run({ method: 'POST', body: { action: 'setSettings', globalDailyLimit: 1 }, sql })).status).toBe(403);
    expect(calls.some((q) => q.startsWith('update'))).toBe(false);
  });
  it('DB 오류 내용은 밖으로 내보내지 않는다', async () => {
    const sql = vi.fn(async () => { throw new Error('secret connection detail'); }) as unknown as Query;
    const r = await run({ sql });
    expect(r.status).toBe(503);
    expect(JSON.stringify(r.body)).not.toContain('secret');
  });
});
