// @vitest-environment node
import { afterEach, expect, test, vi } from 'vitest';
import { createClient, SupabaseAuthAdapter } from '@neondatabase/neon-js';

afterEach(() => vi.unstubAllGlobals());

/** Real installed SDK, mocked transport only. No live auth, credentials or network. */
test('SDK session cache shadows token(): force-fetch must reach the token endpoint', async () => {
  const sessionResponse = {
    user: { id: 'test-user', email: 'test@example.com', emailVerified: true, name: 'Test', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
    session: { id: 'test-session', userId: 'test-user', token: 'unit-test-session-only', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 3_600_000).toISOString() },
  };
  const transport = vi.fn(async (input: string | URL | Request, _init?: RequestInit) => {
    const pathname = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url).pathname;
    if (pathname.endsWith('/get-session')) return Response.json(sessionResponse);
    if (pathname.endsWith('/token')) return Response.json({ token: 'unit-test-jwt-only' });
    throw new Error('Unexpected mocked SDK route');
  });
  vi.stubGlobal('fetch', transport);
  const client = createClient({
    auth: { url: 'https://app.example.test/api/auth', adapter: SupabaseAuthAdapter({ fetchOptions: { credentials: 'include' } }) },
    dataApi: { url: 'https://data.example.test/rest/v1' },
  });
  const native = client.auth.getBetterAuthInstance();
  const session = await native.getSession({ fetchOptions: { headers: { 'X-Force-Fetch': 'true' }, cache: 'no-store' } });
  expect(session.data?.user.id).toBe('test-user');
  transport.mockClear();

  // Reproduces neon-js 0.9.0-beta: /token is classified as getSession,
  // so its beforeFetch returns cached {user,session} without a top-level token.
  const unforced = await native.token();
  expect(unforced.error).toBeNull();
  expect(unforced.data?.token).toBeUndefined();
  expect(unforced.data).toHaveProperty('session');
  expect(transport).not.toHaveBeenCalled();

  const forced = await native.token({ fetchOptions: { headers: { 'X-Force-Fetch': 'true' }, cache: 'no-store' } });
  expect(forced.error).toBeNull();
  expect(forced.data?.token).toBe('unit-test-jwt-only');
  expect(transport).toHaveBeenCalledTimes(1);
  const [url, init] = transport.mock.calls[0];
  expect(String(url)).toBe('https://app.example.test/api/auth/token');
  expect(init?.credentials).toBe('include');
  expect(init?.cache).toBe('no-store');
  // SDK consumes its force header locally; it must not be sent upstream.
  expect(new Headers(init?.headers).has('X-Force-Fetch')).toBe(false);
});
