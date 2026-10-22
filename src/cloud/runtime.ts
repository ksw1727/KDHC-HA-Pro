/// <reference types="vite/client" />
import { createClient, SupabaseAuthAdapter } from '@neondatabase/neon-js';

export const cloudEnabled = import.meta.env.VITE_CLOUD_MODE === 'true';
const dataApiUrl = import.meta.env.VITE_NEON_DATA_API_URL as string | undefined;
function validUrl(value: string | undefined): boolean {
  try {
    const parsed = new URL(value ?? '');
    return !parsed.username && !parsed.password && !parsed.hash && !parsed.search &&
      (parsed.protocol === 'https:' || (parsed.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(parsed.hostname)));
  } catch { return false; }
}
export const configurationError = cloudEnabled && !validUrl(dataApiUrl)
  ? '클라우드 설정이 없거나 올바르지 않습니다. VITE_NEON_DATA_API_URL과 같은 사이트 /api/auth 프록시 설정을 관리자에게 확인하세요.' : null;
function makeClient() {
  return createClient({
    auth: {
      // First-party cookies avoid third-party-cookie blocking by browsers.
      url: window.location.origin + '/api/auth',
      adapter: SupabaseAuthAdapter({ fetchOptions: { credentials: 'include' } }),
    },
    dataApi: { url: dataApiUrl! },
  });
}
type CloudClient = ReturnType<typeof makeClient>;
export type CloudSession = { user: { id: string } };
let client: CloudClient | undefined;
export function cloudClient(): CloudClient {
  if (!cloudEnabled || configurationError) throw new Error(configurationError ?? '클라우드 모드가 아닙니다.');
  return client ??= makeClient();
}
let userId: string | null = null;
export function activeUser(): string | null { return userId; }
export function setActiveUser(id: string | null): void { userId = id; }
export function requireUser(): string {
  if (!userId) throw new Error('로그인이 필요합니다. 다시 로그인하세요.');
  return userId;
}
export function scopedStorageKey(key: string): string {
  return cloudEnabled ? `hanan-moa:cloud:${encodeURIComponent(requireUser())}:${key}` : key;
}
async function jwtToken(): Promise<string> {
  // Do not assume an adapter session token is a JWT; request the JWT endpoint explicitly.
  // SDK 0.9는 /token도 getSession 캐시 경로로 분류한다. 캐시된 세션 JSON을 JWT 응답으로 오인하지 않도록 실제 토큰 요청을 강제한다.
  const { data, error } = await cloudClient().auth.getBetterAuthInstance().token({ fetchOptions: { headers: { 'X-Force-Fetch': 'true' }, cache: 'no-store' } });
  if (error || !data?.token) throw new Error('인증 토큰을 가져오지 못했습니다. 다시 로그인하세요.');
  return data.token;
}
/** Server account endpoint must verify JWT + verified email + enabled allowlist. */
export async function verifyCloudAccount(expectedId: string): Promise<{ id: string; email: string }> {
  const { data, error } = await cloudClient().auth.getBetterAuthInstance().getSession({ query: { disableCookieCache: true }, fetchOptions: { headers: { 'X-Force-Fetch': 'true' }, cache: 'no-store' } });
  if (error || !data?.user || data.user.id !== expectedId) throw new Error('세션 검증에 실패했습니다. 다시 로그인하세요.');
  if (!data.user.emailVerified) throw new Error('이메일 인증이 필요합니다. 인증 메일을 확인한 뒤 다시 로그인하세요.');
  const token = await jwtToken();
  const response = await fetch('/api/account', { credentials: 'include', headers: { Authorization: `Bearer ${token}` }, cache: 'no-store', redirect: 'error' });
  if (!response.ok) throw new Error(response.status === 403 ? '허용된 계정이 아닙니다. 관리자에게 사용 승인을 요청하세요.' : '계정 권한 확인에 실패했습니다. 관리자에게 /api/account 설정을 확인하세요.');
  const account: unknown = await response.json();
  if (!account || typeof account !== 'object') throw new Error('계정 권한 응답이 올바르지 않습니다.');
  const value = account as { approved?: unknown; id?: unknown; email?: unknown; emailVerified?: unknown };
  if (value.approved !== true || value.id !== data.user.id || value.email !== data.user.email || value.emailVerified !== true) throw new Error('허용목록 또는 이메일 인증 확인에 실패했습니다. 관리자에게 문의하세요.');
  return { id: data.user.id, email: data.user.email };
}
export async function cloudFetch(url: string, init?: RequestInit): Promise<Response> {
  if (!cloudEnabled) return fetch(url, init);
  const owner = requireUser();
  const target = new URL(url, window.location.href);
  if (target.origin !== window.location.origin || target.username || target.password) throw new Error('인증 토큰은 같은 사이트 API에만 전송할 수 있습니다.');
  const { data, error } = await cloudClient().auth.getSession({ forceFetch: true });
  if (error || !data.session || data.session.user.id !== owner || activeUser() !== owner) throw new Error('인증이 만료되었습니다. 다시 로그인하세요.');
  const token = await jwtToken();
  if (activeUser() !== owner) throw new Error('사용자가 변경되었습니다.');
  const headers = new Headers(init?.headers);
  headers.set('Authorization', `Bearer ${token}`);
  const response = await fetch(url, { ...init, headers, credentials: 'include', redirect: 'error' });
  if (response.status === 401 || response.status === 403) throw new Error('인증 또는 접근 권한이 없습니다. 다시 로그인하거나 관리자에게 문의하세요.');
  return response;
}

/** Neon 인증 원래 클라이언트 (비밀번호·이름 변경 등 내 계정 기능용) */
export function nativeAuth() { return cloudClient().auth.getBetterAuthInstance(); }
