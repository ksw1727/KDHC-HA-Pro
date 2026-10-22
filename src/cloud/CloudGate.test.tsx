import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react';
import { vi, beforeEach, afterEach, expect, test } from 'vitest';
const m = vi.hoisted(() => ({ enabled: true, config: null as string | null, user: null as string | null, session: null as unknown, verifyError: null as unknown, hydrate: vi.fn(), reset: vi.fn(), requestReset: vi.fn(), sendOtp: vi.fn(), verifyOtp: vi.fn(), signInOtp: vi.fn(), callback: null as ((event: string, session: unknown) => void) | null }));
vi.mock('./runtime', () => ({
  get cloudEnabled() { return m.enabled; }, get configurationError() { return m.config; },
  setActiveUser: (id: string | null) => { m.user = id; },
  verifyCloudAccount: async () => { if (m.verifyError) throw m.verifyError; return { id: 'user-a', email: 'test@example.com' }; },
  cloudClient: () => ({ auth: {
    onAuthStateChange: (callback: typeof m.callback) => { m.callback = callback; return { data: { subscription: { unsubscribe: vi.fn() } } }; },
    getSession: async () => ({ data: { session: m.session }, error: null }),
    getBetterAuthInstance: () => ({ resetPassword: m.reset, requestPasswordReset: m.requestReset, emailOtp: { sendVerificationOtp: m.sendOtp, verifyEmail: m.verifyOtp }, signIn: { emailOtp: m.signInOtp } }),

  } }),
}));
vi.mock('./forms', () => ({ hydrateForms: m.hydrate, stopFormSync: vi.fn(), subscribeSync: () => () => {}, syncStatus: () => state, flushForms: vi.fn(), discardLocalChanges: vi.fn() }));
const state = { pending: 0, message: '', conflict: false };
import { CloudGate } from './CloudGate';
beforeEach(() => { m.enabled = true; m.config = null; m.user = null; m.session = null; m.verifyError = null; m.hydrate.mockReset().mockResolvedValue(undefined); m.reset.mockReset().mockResolvedValue({ error: null }); m.requestReset.mockReset().mockResolvedValue({ error: null }); m.sendOtp.mockReset().mockResolvedValue({ error: null }); m.verifyOtp.mockReset().mockResolvedValue({ error: null }); m.signInOtp.mockReset().mockResolvedValue({ error: null }); window.history.replaceState(null, '', '/'); });
afterEach(cleanup);
test('local dev renders without authentication', () => { m.enabled = false; render(<CloudGate><div>workspace</div></CloudGate>); expect(screen.getByText('workspace')).toBeTruthy(); });
test('missing configuration never renders workspace', () => { m.config = '클라우드 설정이 없습니다'; render(<CloudGate><div>workspace</div></CloudGate>); expect(screen.queryByText('workspace')).toBeNull(); expect(screen.getByText(/설정이 없습니다/)).toBeTruthy(); });
test('anonymous session has login but no public signup or workspace', async () => { render(<CloudGate><div>workspace</div></CloudGate>); await waitFor(() => expect(screen.getByRole('button', { name: '로그인' })).toBeTruthy()); expect(screen.queryByText('workspace')).toBeNull(); expect(m.hydrate).not.toHaveBeenCalled(); });
test('workspace waits until verified user cache hydration is complete', async () => {
  m.session = { user: { id: 'user-a' }, access_token: 'test' };
  let complete!: () => void; m.hydrate.mockImplementation(() => new Promise<void>(resolve => { complete = resolve; }));
  render(<CloudGate><div>workspace</div></CloudGate>);
  await waitFor(() => expect(m.hydrate).toHaveBeenCalled()); expect(screen.queryByText('workspace')).toBeNull(); complete();
  await waitFor(() => expect(screen.getByText('workspace')).toBeTruthy()); expect(m.user).toBe('user-a');
});
test('failed session verification never hydrates or renders workspace', async () => {
  m.session = { user: { id: 'user-a' }, access_token: 'test' }; m.verifyError = new Error('invalid');
  render(<CloudGate><div>workspace</div></CloudGate>); await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy()); expect(screen.queryByText('workspace')).toBeNull(); expect(m.hydrate).not.toHaveBeenCalled();
});

test('recovery link uses native resetPassword and clears token from URL', async () => {
  window.history.replaceState(null, '', '/?token=unit-test-reset-token');
  render(<CloudGate><div>workspace</div></CloudGate>);
  await waitFor(() => expect(screen.getByRole('button', { name: '비밀번호 설정' })).toBeTruthy());
  fireEvent.change(screen.getByLabelText('새 비밀번호'), { target: { value: 'unit-test-password' } });
  fireEvent.click(screen.getByRole('button', { name: '비밀번호 설정' }));
  await waitFor(() => expect(m.reset).toHaveBeenCalledWith({ newPassword: 'unit-test-password', token: 'unit-test-reset-token' }));
  await waitFor(() => expect(window.location.search).toBe('')); expect(m.hydrate).not.toHaveBeenCalled();
});
test('reset email is requested through native BetterAuth', async () => {
  render(<CloudGate><div>workspace</div></CloudGate>);
  await waitFor(() => expect(screen.getByRole('button', { name: '로그인' })).toBeTruthy());
  fireEvent.change(screen.getByLabelText('이메일'), { target: { value: 'test@example.com' } });
  fireEvent.click(screen.getByRole('button', { name: '비밀번호 재설정 메일 받기' }));
  await waitFor(() => expect(m.requestReset).toHaveBeenCalledWith({ email: 'test@example.com', redirectTo: window.location.origin + '/' }));
  expect(screen.queryByText('workspace')).toBeNull();
});

test('email verification code can be requested before password login', async () => {
  render(<CloudGate><div>workspace</div></CloudGate>);
  await waitFor(() => expect(screen.getByRole('button', { name: '로그인' })).toBeTruthy());
  fireEvent.change(screen.getByLabelText('이메일'), { target: { value: 'test@example.com' } });
  fireEvent.click(screen.getByRole('button', { name: '이메일 인증 코드 받기' }));
  await waitFor(() => expect(m.sendOtp).toHaveBeenCalledWith({ email: 'test@example.com', type: 'email-verification' }));
  await waitFor(() => expect(screen.getByRole('status').textContent).toContain('인증 코드가 발송'));
  expect(m.hydrate).not.toHaveBeenCalled(); expect(screen.queryByText('workspace')).toBeNull();
});
test('unverified signed-in session prefills email and can request a code', async () => {
  m.session = { user: { id: 'user-a', email: 'test@example.com' } }; m.verifyError = new Error('이메일 인증이 필요합니다.');
  render(<CloudGate><div>workspace</div></CloudGate>);
  await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('이메일 인증'));
  expect((screen.getByLabelText('이메일') as HTMLInputElement).value).toBe('test@example.com');
  fireEvent.click(screen.getByRole('button', { name: '이메일 인증 코드 받기' }));
  await waitFor(() => expect(m.sendOtp).toHaveBeenCalled()); expect(m.hydrate).not.toHaveBeenCalled();
});
test('successful OTP verification clears code and rechecks gate before mounting', async () => {
  m.session = { user: { id: 'user-a', email: 'test@example.com' } }; m.verifyError = new Error('이메일 인증이 필요합니다.');
  m.verifyOtp.mockImplementation(async () => { m.verifyError = null; return { error: null }; });
  render(<CloudGate><div>workspace</div></CloudGate>);
  await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
  fireEvent.change(screen.getByLabelText('인증 코드'), { target: { value: '123456' } });
  fireEvent.click(screen.getByRole('button', { name: '이메일 인증 확인' }));
  await waitFor(() => expect(m.verifyOtp).toHaveBeenCalledWith({ email: 'test@example.com', otp: '123456' }));
  await waitFor(() => expect(screen.getByText('workspace')).toBeTruthy()); expect(m.hydrate).toHaveBeenCalledTimes(1);
});
test('email verification does not bypass the administrator allowlist', async () => {
  m.session = { user: { id: 'user-a', email: 'test@example.com' } }; m.verifyError = new Error('허용된 계정이 아닙니다.');
  render(<CloudGate><div>workspace</div></CloudGate>);
  await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
  fireEvent.change(screen.getByLabelText('인증 코드'), { target: { value: '123456' } });
  fireEvent.click(screen.getByRole('button', { name: '이메일 인증 확인' }));
  await waitFor(() => expect(m.verifyOtp).toHaveBeenCalled());
  await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('허용된 계정'));
  expect((screen.getByLabelText('인증 코드') as HTMLInputElement).value).toBe(''); expect(m.hydrate).not.toHaveBeenCalled(); expect(screen.queryByText('workspace')).toBeNull();
});
test('invalid code and delivery failures remain visible without opening workspace', async () => {
  m.sendOtp.mockResolvedValue({ error: new Error('인증 코드 전송 실패') }); m.verifyOtp.mockResolvedValue({ error: new Error('인증 코드가 만료되었습니다.') });
  render(<CloudGate><div>workspace</div></CloudGate>);
  await waitFor(() => expect(screen.getByRole('button', { name: '로그인' })).toBeTruthy());
  fireEvent.change(screen.getByLabelText('이메일'), { target: { value: 'test@example.com' } });
  fireEvent.click(screen.getByRole('button', { name: '이메일 인증 코드 받기' }));
  await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('전송 실패'));
  fireEvent.change(screen.getByLabelText('인증 코드'), { target: { value: '123456' } });
  fireEvent.click(screen.getByRole('button', { name: '이메일 인증 확인' }));
  await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('만료'));
  expect((screen.getByLabelText('인증 코드') as HTMLInputElement).value).toBe('123456'); expect(m.hydrate).not.toHaveBeenCalled();
});

test('login-code request uses sign-in purpose and does not verify email', async () => {
  render(<CloudGate><div>workspace</div></CloudGate>);
  await waitFor(() => expect(screen.getByRole('button', { name: '로그인' })).toBeTruthy());
  fireEvent.change(screen.getByLabelText('이메일'), { target: { value: 'test@example.com' } });
  fireEvent.click(screen.getByRole('button', { name: '로그인 코드 받기' }));
  await waitFor(() => expect(m.sendOtp).toHaveBeenCalledWith({ email: 'test@example.com', type: 'sign-in' }));
  await waitFor(() => expect(screen.getByRole('status').textContent).toContain('로그인 코드 발송'));
  expect(screen.getByText(/현재 입력: 로그인용 코드/)).toBeTruthy();
  expect(m.verifyOtp).not.toHaveBeenCalled(); expect(m.signInOtp).not.toHaveBeenCalled(); expect(m.hydrate).not.toHaveBeenCalled();
});
test('login OTP signs in natively then passes account gate before opening app', async () => {
  m.signInOtp.mockImplementation(async () => { m.session = { user: { id: 'user-a', email: 'test@example.com' } }; return { error: null }; });
  render(<CloudGate><div>workspace</div></CloudGate>);
  await waitFor(() => expect(screen.getByRole('button', { name: '로그인' })).toBeTruthy());
  fireEvent.change(screen.getByLabelText('이메일'), { target: { value: 'test@example.com' } });
  fireEvent.click(screen.getByRole('button', { name: '로그인 코드 받기' }));
  await waitFor(() => expect(screen.getByRole('status')).toBeTruthy());
  fireEvent.change(screen.getByLabelText('인증 코드'), { target: { value: '654321' } });
  fireEvent.click(screen.getByRole('button', { name: '코드로 로그인' }));
  await waitFor(() => expect(m.signInOtp).toHaveBeenCalledWith({ email: 'test@example.com', otp: '654321' }));
  await waitFor(() => expect(screen.getByText('workspace')).toBeTruthy());
  expect(m.verifyOtp).not.toHaveBeenCalled(); expect(m.hydrate).toHaveBeenCalledTimes(1);
});
test('changing OTP purposes clears old code and uses only the matching endpoint', async () => {
  render(<CloudGate><div>workspace</div></CloudGate>);
  await waitFor(() => expect(screen.getByRole('button', { name: '로그인' })).toBeTruthy());
  fireEvent.change(screen.getByLabelText('이메일'), { target: { value: 'test@example.com' } });
  fireEvent.change(screen.getByLabelText('인증 코드'), { target: { value: '123456' } });
  fireEvent.click(screen.getByRole('button', { name: '로그인 코드 받기' }));
  await waitFor(() => expect(screen.getByRole('status')).toBeTruthy());
  expect((screen.getByLabelText('인증 코드') as HTMLInputElement).value).toBe('');
  fireEvent.change(screen.getByLabelText('인증 코드'), { target: { value: '654321' } });
  fireEvent.click(screen.getByRole('button', { name: '이메일 인증 코드 받기' }));
  await waitFor(() => expect(screen.getByText(/현재 입력: 이메일 인증용 코드/)).toBeTruthy());
  await waitFor(() => expect(screen.getByRole('status')).toBeTruthy());
  expect((screen.getByLabelText('인증 코드') as HTMLInputElement).value).toBe('');
  fireEvent.change(screen.getByLabelText('인증 코드'), { target: { value: '123456' } });
  fireEvent.click(screen.getByRole('button', { name: '이메일 인증 확인' }));
  await waitFor(() => expect(m.verifyOtp).toHaveBeenCalledWith({ email: 'test@example.com', otp: '123456' }));
  expect(m.signInOtp).not.toHaveBeenCalled();
});
test('OTP login or implicit account creation cannot bypass administrator approval', async () => {
  m.verifyError = new Error('허용된 계정이 아닙니다.');
  m.signInOtp.mockImplementation(async () => { m.session = { user: { id: 'user-a', email: 'test@example.com' } }; return { error: null }; });
  render(<CloudGate><div>workspace</div></CloudGate>);
  await waitFor(() => expect(screen.getByRole('button', { name: '로그인' })).toBeTruthy());
  fireEvent.change(screen.getByLabelText('이메일'), { target: { value: 'test@example.com' } });
  fireEvent.click(screen.getByRole('button', { name: '로그인 코드 받기' }));
  await waitFor(() => expect(screen.getByRole('status')).toBeTruthy());
  fireEvent.change(screen.getByLabelText('인증 코드'), { target: { value: '654321' } });
  fireEvent.click(screen.getByRole('button', { name: '코드로 로그인' }));
  await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('허용된 계정'));
  expect((screen.getByLabelText('인증 코드') as HTMLInputElement).value).toBe('');
  expect(m.hydrate).not.toHaveBeenCalled(); expect(screen.queryByText('workspace')).toBeNull();
});
test('expired login OTP does not fall back to email verification', async () => {
  m.signInOtp.mockResolvedValue({ error: new Error('로그인 코드가 만료되었습니다.') });
  render(<CloudGate><div>workspace</div></CloudGate>);
  await waitFor(() => expect(screen.getByRole('button', { name: '로그인' })).toBeTruthy());
  fireEvent.change(screen.getByLabelText('이메일'), { target: { value: 'test@example.com' } });
  fireEvent.click(screen.getByRole('button', { name: '로그인 코드 받기' }));
  await waitFor(() => expect(screen.getByRole('status')).toBeTruthy());
  fireEvent.change(screen.getByLabelText('인증 코드'), { target: { value: '654321' } });
  fireEvent.click(screen.getByRole('button', { name: '코드로 로그인' }));
  await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('만료'));
  expect(m.verifyOtp).not.toHaveBeenCalled(); expect(m.hydrate).not.toHaveBeenCalled(); expect(screen.queryByText('workspace')).toBeNull();
});
