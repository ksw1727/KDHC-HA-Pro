import type { IncomingMessage, ServerResponse } from 'node:http';
import { neon } from '@neondatabase/serverless';
import { SafeError } from './ai';
import { makeStore, type Query, type Store } from './store';

/**
 * 관리자 페이지 API (/api/admin)
 *   GET  → 승인 사용자 목록
 *   POST { action: 'add' | 'enable' | 'disable' | 'remove', email }
 *   POST { action: 'setLimit', email, limit: number | null }   사용자별 하루 AI 한도 (null = 기본값)
 *   POST { action: 'setSettings', globalDailyLimit, defaultUserDailyLimit }   (null = 무제한)
 * 관리자 = 승인 목록에서 is_admin=true인 계정. 매 요청마다 JWT + DB로 다시 확인한다.
 */
export type AdminRequest = IncomingMessage & { body?: unknown };
export interface AdminDeps { env?: NodeJS.ProcessEnv; store?: Store; sql?: Query }
export interface AdminUser { email: string; enabled: boolean; isAdmin: boolean; userId: string | null; emailVerified: boolean | null; createdAt: string | null; updatedAt: string; aiDailyLimit: number | null; usedToday: number }
export interface AiSettings { globalDailyLimit: number | null; defaultUserDailyLimit: number | null; usedTodayGlobal: number }
/** 한도 값: 빈 값(null)은 무제한/기본값, 0~100000 정수 */
export function parseLimit(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'string' ? Number(v.trim()) : v;
  if (typeof n !== 'number' || !Number.isInteger(n) || n < 0 || n > 100000) throw new SafeError(400, '한도는 0~100000 사이의 정수로 입력하거나 비워 두세요(무제한).');
  return n;
}

const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,63}$/;
export const normalizeEmail = (v: unknown): string => {
  if (typeof v !== 'string') throw new SafeError(400, '이메일을 입력해 주세요.');
  const e = v.trim().toLowerCase();
  if (e.length > 254 || !EMAIL.test(e)) throw new SafeError(400, '이메일 형식이 올바르지 않아요.');
  return e;
};

async function readBody(req: AdminRequest): Promise<unknown> {
  if (req.body !== undefined) return typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  const chunks: Buffer[] = []; let n = 0;
  for await (const c of req) { const b = Buffer.from(c); n += b.length; if (n > 4096) throw new SafeError(413, '요청이 너무 커요.'); chunks.push(b); }
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}

export async function isAdmin(sql: Query, userId: string): Promise<boolean> {
  const rows = await sql`select 1 from moa_private.moa_allowed_users where user_id=${userId}::uuid and enabled is true and is_admin is true limit 1`;
  return rows.length === 1;
}

export async function listUsers(sql: Query): Promise<AdminUser[]> {
  const rows = await sql`select a.email, a.enabled, a.is_admin, a.user_id::text as user_id, a.updated_at, a.ai_daily_limit, u."emailVerified" as verified, u."createdAt" as created,
      coalesce((select used from moa_private.moa_ai_usage g where g.day = (now() at time zone 'UTC')::date and g.scope = coalesce(a.user_id, u.id)::text), 0) as used_today
    from moa_private.moa_allowed_users a left join neon_auth."user" u on u.id = a.user_id or (a.user_id is null and lower(u.email) = a.email)
    order by a.is_admin desc, a.email asc limit 500`;
  const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : v == null ? null : String(v));
  return rows.map((r) => ({ email: String(r.email), enabled: r.enabled === true, isAdmin: r.is_admin === true, userId: r.user_id ? String(r.user_id) : null,
    emailVerified: typeof r.verified === 'boolean' ? r.verified : null, createdAt: iso(r.created), updatedAt: iso(r.updated_at) ?? '',
    aiDailyLimit: r.ai_daily_limit == null ? null : Number(r.ai_daily_limit), usedToday: Number(r.used_today ?? 0) }));
}

export async function readSettings(sql: Query): Promise<AiSettings> {
  const rows = await sql`select s.global_daily_limit, s.default_user_daily_limit,
      coalesce((select used from moa_private.moa_ai_usage g where g.day = (now() at time zone 'UTC')::date and g.scope = 'global'), 0) as used
    from moa_private.moa_ai_settings s where s.id`;
  const r = rows[0] ?? {};
  const num = (v: unknown) => (v == null ? null : Number(v));
  return { globalDailyLimit: num(r.global_daily_limit), defaultUserDailyLimit: num(r.default_user_daily_limit), usedTodayGlobal: Number(r.used ?? 0) };
}

export async function applyAction(sql: Query, actor: { id: string; email: string }, action: unknown, emailRaw: unknown, body: Record<string, unknown> = {}): Promise<void> {
  if (action === 'setSettings') {
    const g = parseLimit(body.globalDailyLimit), d = parseLimit(body.defaultUserDailyLimit);
    await sql`update moa_private.moa_ai_settings set global_daily_limit = ${g}::integer, default_user_daily_limit = ${d}::integer, updated_at = now() where id`;
    return;
  }
  const email = normalizeEmail(emailRaw);
  if (action === 'setLimit') {
    const limit = parseLimit(body.limit);
    const rows = await sql`update moa_private.moa_allowed_users set ai_daily_limit = ${limit}::integer, updated_at = now() where email = ${email} returning email`;
    if (rows.length !== 1) throw new SafeError(404, '승인 목록에 없는 이메일이에요.');
    return;
  }
  if (!['add', 'enable', 'disable', 'remove'].includes(String(action))) throw new SafeError(400, '지원하지 않는 작업이에요.');
  if (email === actor.email && action !== 'add' && action !== 'enable') throw new SafeError(400, '자기 자신의 관리자 계정은 중지하거나 삭제할 수 없어요.');
  if (action === 'add') {
    // 로그인 계정이 없으면 만든다(비밀번호 없음 → 이메일 코드로 로그인). 회원가입은 꺼져 있으므로 관리자만 계정을 만들 수 있다.
    const name = email.split('@')[0].slice(0, 60);
    await sql`insert into neon_auth."user"(name, email, "emailVerified") select ${name}, ${email}, false
      where not exists (select 1 from neon_auth."user" where lower(email) = ${email})`;
    await sql`insert into moa_private.moa_allowed_users(email, user_id, enabled, is_admin, updated_at)
      select ${email}, u.id, true, false, now() from neon_auth."user" u where lower(u.email) = ${email} limit 1
      on conflict (email) do update set enabled = true, user_id = coalesce(moa_private.moa_allowed_users.user_id, excluded.user_id), updated_at = now()`;
    return;
  }
  const target = await sql`select is_admin from moa_private.moa_allowed_users where email = ${email}`;
  if (target.length !== 1) throw new SafeError(404, '승인 목록에 없는 이메일이에요.');
  if (target[0].is_admin === true) throw new SafeError(400, '관리자 계정은 이 화면에서 중지하거나 삭제할 수 없어요.');
  if (action === 'remove') await sql`delete from moa_private.moa_allowed_users where email = ${email} and is_admin is false`;
  else await sql`update moa_private.moa_allowed_users set enabled = ${action === 'enable'}, updated_at = now() where email = ${email} and is_admin is false`;
}

export function adminHandler(deps: AdminDeps = {}) {
  return async (req: AdminRequest, res: ServerResponse) => {
    const env = deps.env ?? process.env;
    const json = (status: number, value: unknown) => { res.statusCode = status; res.setHeader('content-type', 'application/json; charset=utf-8'); res.end(JSON.stringify(value)); };
    res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Content-Type-Options', 'nosniff');
    try {
      const origin = req.headers.origin;
      const host = typeof req.headers['x-forwarded-host'] === 'string' ? req.headers['x-forwarded-host'] : req.headers.host;
      const proto = req.headers['x-forwarded-proto'] ?? 'https';
      if (origin && origin !== env.SERVER_APP_ORIGIN && origin !== `${proto}://${host}`) throw new SafeError(403, '허용되지 않은 접근이에요.');
      if (req.method === 'POST' && !origin) throw new SafeError(403, '허용되지 않은 접근이에요.');
      if (req.method !== 'GET' && req.method !== 'POST') { res.setHeader('Allow', 'GET, POST'); throw new SafeError(405, '지원하지 않는 요청이에요.'); }
      const auth = req.headers.authorization;
      if (!auth || !/^Bearer [^\s]+$/i.test(auth)) throw new SafeError(401, '로그인이 필요해요.');
      const store = deps.store ?? makeStore(env);
      if (!store.account) throw new SafeError(503, '계정 확인을 사용할 수 없어요.');
      const actor = await store.account(auth.slice(7));
      if (!env.DATABASE_URL && !deps.sql) throw new SafeError(503, '서버 연결 설정이 필요해요.');
      const sql = deps.sql ?? (neon(env.DATABASE_URL!) as unknown as Query);
      let admin = false;
      try { admin = await isAdmin(sql, actor.id); } catch { throw new SafeError(503, '관리자 권한을 확인하지 못했어요.'); }
      if (!admin) throw new SafeError(403, '관리자만 사용할 수 있어요.');
      if (req.method === 'POST') {
        let body: unknown; try { body = await readBody(req); } catch (e) { if (e instanceof SafeError) throw e; throw new SafeError(400, '요청 형식이 올바르지 않아요.'); }
        const b = (body ?? {}) as Record<string, unknown>;
        try { await applyAction(sql, actor, b.action, b.email, b); } catch (e) { if (e instanceof SafeError) throw e; throw new SafeError(503, '사용자 목록을 바꾸지 못했어요.'); }
      }
      let users: AdminUser[]; let settings: AiSettings;
      try { [users, settings] = await Promise.all([listUsers(sql), readSettings(sql)]); } catch { throw new SafeError(503, '사용자 목록을 불러오지 못했어요.'); }
      json(200, { users, settings });
    } catch (error) {
      const safe = error instanceof SafeError ? error : new SafeError(500, '요청을 처리하지 못했어요.');
      json(safe.status, { error: safe.message });
    }
  };
}
