import type { IncomingMessage, ServerResponse } from 'node:http';
import { neon } from '@neondatabase/serverless';
import { SafeError } from './ai';
import { makeStore, type Query, type Store } from './store';
import { normalizeEmail } from './admin';

/**
 * 내 계정 (/api/me)
 *   GET  → { email, name, emailVerified, hasPassword, isAdmin }
 *   POST { action: 'changeEmail', newEmail } → 로그인 이메일(아이디) 변경
 * 비밀번호·이름 변경은 Neon 인증(/api/auth)이 직접 처리한다.
 * Neon의 자체 이메일 변경은 꺼져 있어서, 로그인 계정과 승인 목록의 이메일을 함께 바꾸고
 * 새 이메일은 '인증 전'으로 둔다. 다음 로그인 때 새 주소로 받은 코드로 인증해야 쓸 수 있다.
 */
export interface MeDeps { env?: NodeJS.ProcessEnv; store?: Store; sql?: Query }
export interface Me { email: string; name: string; emailVerified: boolean; hasPassword: boolean; isAdmin: boolean }

/** 로그인 이메일 변경 (본인 또는 관리자). 다른 계정·승인 목록에 이미 있는 이메일이면 거절 */
export async function changeEmail(sql: Query, userId: string, newEmailRaw: unknown): Promise<string> {
  const email = normalizeEmail(newEmailRaw);
  const rows = await sql`with me as (select id, lower(email) as old from neon_auth."user" where id = ${userId}::uuid),
    clash as (select 1 from neon_auth."user" x, me where lower(x.email) = ${email} and x.id <> me.id
              union all select 1 from moa_private.moa_allowed_users a, me where a.email = ${email} and a.user_id is distinct from me.id),
    u as (update neon_auth."user" t set email = ${email}, "emailVerified" = false, "updatedAt" = now()
          from me where t.id = me.id and me.old <> ${email} and not exists (select 1 from clash) returning t.id),
    a as (update moa_private.moa_allowed_users al set email = ${email}, user_id = me.id, updated_at = now()
          from me where exists (select 1 from u) and (al.user_id = me.id or (al.user_id is null and al.email = me.old)) returning al.email)
    select (select old from me) as old, (select count(*) from clash) as clash, (select count(*) from u) as changed, (select count(*) from a) as allowed`;
  const r = rows[0];
  if (!r || r.old == null) throw new SafeError(404, '계정을 찾을 수 없어요.');
  if (r.old === email) throw new SafeError(400, '지금 이메일과 같아요.');
  if (Number(r.clash) > 0) throw new SafeError(409, '이미 다른 계정에서 쓰는 이메일이에요.');
  if (Number(r.changed) !== 1) throw new SafeError(503, '이메일을 바꾸지 못했어요.');
  return email;
}

export async function readMe(sql: Query, userId: string): Promise<Me> {
  const rows = await sql`select u.email, u.name, u."emailVerified" as verified,
      exists (select 1 from neon_auth.account c where c."userId" = u.id and c."providerId" = 'credential' and c.password is not null) as has_password,
      coalesce((select a.is_admin from moa_private.moa_allowed_users a where a.user_id = u.id limit 1), false) as is_admin
    from neon_auth."user" u where u.id = ${userId}::uuid limit 1`;
  const r = rows[0];
  if (!r) throw new SafeError(404, '계정을 찾을 수 없어요.');
  return { email: String(r.email), name: String(r.name ?? ''), emailVerified: r.verified === true, hasPassword: r.has_password === true, isAdmin: r.is_admin === true };
}

export function meHandler(deps: MeDeps = {}) {
  return async (req: IncomingMessage, res: ServerResponse) => {
    const env = deps.env ?? process.env;
    const json = (status: number, value: unknown) => { res.statusCode = status; res.setHeader('content-type', 'application/json; charset=utf-8'); res.end(JSON.stringify(value)); };
    res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Content-Type-Options', 'nosniff');
    try {
      if (req.method !== 'GET' && req.method !== 'POST') { res.setHeader('Allow', 'GET, POST'); throw new SafeError(405, '지원하지 않는 요청이에요.'); }
      const origin = req.headers.origin;
      const host = typeof req.headers['x-forwarded-host'] === 'string' ? req.headers['x-forwarded-host'] : req.headers.host;
      const proto = req.headers['x-forwarded-proto'] ?? 'https';
      if (origin && origin !== env.SERVER_APP_ORIGIN && origin !== `${proto}://${host}`) throw new SafeError(403, '허용되지 않은 접근이에요.');
      if (req.method === 'POST' && !origin) throw new SafeError(403, '허용되지 않은 접근이에요.');
      const auth = req.headers.authorization;
      if (!auth || !/^Bearer [^\s]+$/i.test(auth)) throw new SafeError(401, '로그인이 필요해요.');
      const store = deps.store ?? makeStore(env);
      if (!store.account) throw new SafeError(503, '계정 확인을 사용할 수 없어요.');
      const me = await store.account(auth.slice(7));
      if (!env.DATABASE_URL && !deps.sql) throw new SafeError(503, '서버 연결 설정이 필요해요.');
      const sql = deps.sql ?? (neon(env.DATABASE_URL!) as unknown as Query);
      if (req.method === 'POST') {
        let body: Record<string, unknown> = {};
        try { const chunks: Buffer[] = []; let n = 0; for await (const c of req) { const b = Buffer.from(c); n += b.length; if (n > 2048) throw new SafeError(413, '요청이 너무 커요.'); chunks.push(b); } body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); }
        catch (e) { if (e instanceof SafeError) throw e; throw new SafeError(400, '요청 형식이 올바르지 않아요.'); }
        if (body.action !== 'changeEmail') throw new SafeError(400, '지원하지 않는 작업이에요.');
        try { const email = await changeEmail(sql, me.id, body.newEmail); json(200, { email, emailVerified: false }); return; }
        catch (e) { if (e instanceof SafeError) throw e; throw new SafeError(503, '이메일을 바꾸지 못했어요.'); }
      }
      let out: Me; try { out = await readMe(sql, me.id); } catch (e) { if (e instanceof SafeError) throw e; throw new SafeError(503, '계정 정보를 불러오지 못했어요.'); }
      json(200, out);
    } catch (error) {
      const safe = error instanceof SafeError ? error : new SafeError(500, '요청을 처리하지 못했어요.');
      json(safe.status, { error: safe.message });
    }
  };
}
