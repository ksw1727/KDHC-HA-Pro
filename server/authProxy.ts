import type { IncomingMessage, ServerResponse } from 'node:http';

/** 인증 쿠키를 한난MOA 사이트에만 두는 동일 출처 프록시. 임의 호스트·리다이렉트를 따라가지 않는다. */
export type AuthRequest = IncomingMessage & { body?: unknown; query?: Record<string, string | string[]> };
const MAX_BODY = 32_768;
const METHODS = new Set(['GET', 'POST']);
const ROUTES = new Set([
  'get-session', 'token', 'sign-in/email', 'sign-in/email-otp', 'sign-out', 'request-password-reset', 'reset-password',
  'verify-email', 'send-verification-email', 'email-otp/send-verification-otp', 'email-otp/verify-email',
  // 내 계정: 비밀번호 변경·이메일 코드로 비밀번호 설정, 이름 변경, 이메일 변경
  'change-password', 'email-otp/reset-password', 'update-user', 'change-email',
  // 로그인 화면 [비밀번호를 잊었어요]: 인증코드가 맞는지 먼저 확인 (코드를 쓰지는 않음)
  'email-otp/check-verification-otp',
]);
export function proxyCookie(cookie: string): string {
  // Upstream 전용 Domain/Path는 제거하고 이 사이트의 /api/auth에서만 전달한다.
  const path = cookie.startsWith('__Host-') ? '/' : '/api/auth';
  return cookie.replace(/;\s*Domain=[^;]*/gi, '').replace(/;\s*Path=[^;]*/gi, '')
    .replace(/;\s*Partitioned\b/gi, '').replace(/;\s*SameSite=[^;]*/gi, '').replace(/;\s*Secure\b/gi, '')
    + `; Secure; SameSite=Lax; Path=${path}`;
}
export function authTarget(raw: string, base: string): URL {
  const upstream = new URL(base);
  if (upstream.protocol !== 'https:' || upstream.username || upstream.password || upstream.search || upstream.hash) throw new Error('configuration');
  const local = new URL(raw, 'https://moa.invalid');
  const path = local.pathname.replace(/^\/api\/auth\/?/, '') || local.searchParams.get('moa_auth_path') || '';
  local.searchParams.delete('moa_auth_path');
  if (!ROUTES.has(path)) throw new Error('route');
  return new URL(upstream.href.replace(/\/$/, '') + '/' + path + local.search);
}
async function readBody(req: AuthRequest): Promise<string | undefined> {
  if (req.method !== 'POST') return undefined;
  const type = req.headers['content-type'] ?? '';
  if (!type.startsWith('application/json')) throw new Error('type');
  if (req.body !== undefined) {
    const text = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
    if (Buffer.byteLength(text) > MAX_BODY) throw new Error('size');
    JSON.parse(text);
    return text;
  }
  const chunks: Buffer[] = []; let size = 0;
  for await (const chunk of req) { const bytes = Buffer.from(chunk); size += bytes.length; if (size > MAX_BODY) throw new Error('size'); chunks.push(bytes); }
  const text = Buffer.concat(chunks).toString('utf8'); JSON.parse(text); return text;
}
export function authProxy(env: NodeJS.ProcessEnv = process.env, fetcher: typeof fetch = fetch) {
  return async (req: AuthRequest, res: ServerResponse) => {
    res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Content-Type-Options', 'nosniff');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);
    const abort = () => controller.abort(); req.on('aborted', abort);
    try {
      if (!METHODS.has(req.method ?? '')) { res.setHeader('Allow', 'GET, POST'); res.statusCode = 405; res.end(); return; }
      if (!env.NEON_AUTH_BASE_URL || !env.SERVER_APP_ORIGIN) { res.statusCode = 503; res.end(JSON.stringify({ message: '로그인 서버 설정이 필요해요.' })); return; }
      const origin = new URL(env.SERVER_APP_ORIGIN).origin;
      const requestOrigin = req.headers.origin;
      if (requestOrigin && requestOrigin !== origin) { res.statusCode = 403; res.end(); return; }
      // 쿠키를 사용하는 상태 변경은 출처를 반드시 확인한다. GET token/session은 동일출처 쿠키+SOP로 보호.
      if (req.method === 'POST' && requestOrigin !== origin) { res.statusCode = 403; res.end(); return; }
      let target: URL;
      try { target = authTarget(req.url ?? '', env.NEON_AUTH_BASE_URL); } catch { res.statusCode = 404; res.end(); return; }
      const body = await readBody(req);
      const headers = new Headers({ accept: 'application/json', origin, 'content-type': 'application/json', 'x-neon-auth-middleware': 'true' });
      // Neon 공식 서버 프록시와 같은 쿠키 범위. 다른 앱의 쿠키는 외부 인증 서버에 보내지 않는다.
      const cookiesToSend = (req.headers.cookie ?? '').split(';').map(c => c.trim()).filter(c => c.startsWith('__Secure-neon-auth.') || c.startsWith('__Host-neon-auth.'));
      if (cookiesToSend.length) headers.set('cookie', cookiesToSend.join('; '));
      const auth = req.headers.authorization;
      if (typeof auth === 'string' && auth.length <= 16_384 && /^Bearer [^\s]+$/i.test(auth)) headers.set('authorization', auth);
      for (const name of ['x-force-fetch', 'x-better-auth-cookie', 'x-neon-client-info', 'user-agent']) {
        const value = req.headers[name]; if (typeof value === 'string') headers.set(name, value);
      }
      const upstream = await fetcher(target, { method: req.method, headers, body, redirect: 'manual', signal: controller.signal });
      if (upstream.status >= 300 && upstream.status < 400) { res.statusCode = 502; res.end(JSON.stringify({ message: '이 로그인 방식은 지원하지 않아요.' })); return; }
      const cookies = upstream.headers.getSetCookie();
      if (cookies.length) res.setHeader('Set-Cookie', cookies.map(proxyCookie));
      for (const name of ['set-auth-jwt', 'set-auth-token']) { const value = upstream.headers.get(name); if (value) res.setHeader(name, value); }
      res.setHeader('content-type', 'application/json; charset=utf-8');
      const reader = upstream.body?.getReader(); const chunks: Buffer[] = []; let size = 0;
      if (reader) { try { for (;;) { const { value, done } = await reader.read(); if (done) break; size += value.byteLength; if (size > 65_536) { await reader.cancel(); throw new Error('size'); } chunks.push(Buffer.from(value)); } } finally { reader.releaseLock(); } }
      res.statusCode = upstream.status; res.end(Buffer.concat(chunks));
    } catch {
      if (!res.destroyed) { res.statusCode = 502; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ message: '로그인 연결을 확인하지 못했어요. 다시 시도해 주세요.' })); }
    } finally { clearTimeout(timer); req.off('aborted', abort); }
  };
}
