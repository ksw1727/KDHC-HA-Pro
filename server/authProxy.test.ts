// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import type { ServerResponse } from 'node:http';
import { authProxy, authTarget, proxyCookie, type AuthRequest } from './authProxy';
const env = { NEON_AUTH_BASE_URL: 'https://auth.example.test/neondb/auth', SERVER_APP_ORIGIN: 'https://moa.example.test' };
function req(method = 'GET', url = '/api/auth/get-session', headers: Record<string,string> = {}) {
  return Object.assign(new EventEmitter(), { method, url, headers, body: {} }) as AuthRequest;
}
function response() {
  return Object.assign(new EventEmitter(), { statusCode: 200, headers: {} as Record<string,unknown>, result: '', destroyed: false,
    setHeader(name:string,value:unknown) { this.headers[name] = value; }, end(data?: string | Buffer) { this.result = String(data ?? ''); },
  });
}
describe('같은 출처 인증 프록시', () => {
  it('허용한 경로와 원래 검색 조건만 전달한다', () => {
    expect(authTarget('/api/auth/get-session?disableCookieCache=true', env.NEON_AUTH_BASE_URL).href).toBe('https://auth.example.test/neondb/auth/get-session?disableCookieCache=true');
    expect(authTarget('/api/auth?moa_auth_path=token', env.NEON_AUTH_BASE_URL).href).toBe('https://auth.example.test/neondb/auth/token');
  });
  it.each(['/api/auth/sign-up/email','/api/auth/admin/list-users','/api/auth/https://evil.test','/api/auth/../token'])('미지원 경로는 거절한다: %s', path => {
    expect(() => authTarget(path, env.NEON_AUTH_BASE_URL)).toThrow();
  });
  it('비밀 연결 문자열이나 비보안 주소는 인증 주소로 허용하지 않는다', () => {
    expect(() => authTarget('/api/auth/token','http://auth.example.test/auth')).toThrow();
    expect(() => authTarget('/api/auth/token','https://user:secret@auth.example.test/auth')).toThrow();
  });
  it('쿠키의 기존 도메인·경로를 좁히되 보안 속성과 삭제 만료일은 유지한다', () => {
    expect(proxyCookie('session=hidden; Domain=auth.example.test; Path=/neondb/auth; Secure; HttpOnly; SameSite=None; Partitioned; Max-Age=0')).toBe('session=hidden; HttpOnly; Max-Age=0; Secure; SameSite=Lax; Path=/api/auth');
    expect(proxyCookie('__Host-session=hidden; Path=/; Secure; HttpOnly')).toContain('Path=/');
    expect(proxyCookie('__Host-session=hidden; Path=/; Secure; HttpOnly')).not.toContain('Path=/api/auth');
  });
  it('다른 사이트나 출처 없는 상태 변경은 upstream 호출 전에 막는다', async () => {
    const fetcher = vi.fn<typeof fetch>();
    for (const origin of ['https://evil.example', undefined]) {
      const r = response(); await authProxy(env,fetcher)(req('POST','/api/auth/sign-in/email',origin ? {origin,'content-type':'application/json'} : {'content-type':'application/json'}),r as unknown as ServerResponse);
      expect(r.statusCode).toBe(403);
    }
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('인증 서버에 필요한 제한된 Bearer·Neon 쿠키·프록시 헤더와 JWT 응답을 전달한다', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => new Response('{"user":null}', { headers: { 'set-cookie':'session=hidden; Domain=auth.example.test; Path=/; Secure; HttpOnly', 'set-auth-jwt':'hidden-jwt' } }));
    const r=response(); await authProxy(env,fetcher)(req('GET','/api/auth/get-session',{cookie:'__Secure-neon-auth.session_token=hidden; other-app=private',authorization:'Bearer own-auth-token'}),r as unknown as ServerResponse);
    const h = new Headers(fetcher.mock.calls[0][1]?.headers);
    expect(h.get('authorization')).toBe('Bearer own-auth-token'); expect(h.get('cookie')).toBe('__Secure-neon-auth.session_token=hidden');
    expect(h.get('x-neon-auth-middleware')).toBe('true');
    expect(r.headers['set-auth-jwt']).toBe('hidden-jwt'); expect(r.headers['Set-Cookie']).toEqual(['session=hidden; HttpOnly; Secure; SameSite=Lax; Path=/api/auth']);
    expect(r.headers['Cache-Control']).toBe('no-store');
  });
  it('거대한 요청이나 잘못된 내용 형식은 전달하지 않는다', async () => {
    const fetcher=vi.fn<typeof fetch>(); const r=response(); const request=req('POST','/api/auth/sign-in/email',{origin:env.SERVER_APP_ORIGIN,'content-type':'application/json'}); request.body={x:'x'.repeat(40_000)};
    await authProxy(env,fetcher)(request,r as unknown as ServerResponse); expect(fetcher).not.toHaveBeenCalled(); expect(r.statusCode).toBe(502);
  });
  it('로그인 서버 리다이렉트와 내부 오류는 감춘다', async () => {
    const fetcher=vi.fn<typeof fetch>(async()=>new Response(null,{status:302,headers:{location:'https://evil.example/?secret=hidden'}}));
    const r=response(); await authProxy(env,fetcher)(req(),r as unknown as ServerResponse); expect(r.statusCode).toBe(502); expect(r.result).not.toContain('hidden');
    const fail=vi.fn<typeof fetch>(async()=>{throw new Error('secret connection');});const r2=response(); await authProxy(env,fail)(req(),r2 as unknown as ServerResponse); expect(r2.result).not.toContain('secret connection');
  });
});
