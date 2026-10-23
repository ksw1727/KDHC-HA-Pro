import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react';
import { vi, beforeEach, afterEach, expect, test } from 'vitest';
const m = vi.hoisted(() => ({ enabled: true, config: null as string | null, user: null as string | null, session: null as unknown, verifyError: null as unknown, hydrate: vi.fn(), reset: vi.fn(), requestReset: vi.fn(), sendOtp: vi.fn(), verifyOtp: vi.fn(), signInOtp: vi.fn(), signInPw: vi.fn(), checkOtp: vi.fn(), resetOtp: vi.fn(), callback: null as ((event: string, session: unknown) => void) | null }));
vi.mock('./runtime', () => ({
  get cloudEnabled() { return m.enabled; }, get configurationError() { return m.config; },
  setActiveUser: (id: string | null) => { m.user = id; },
  verifyCloudAccount: async () => { if (m.verifyError) throw m.verifyError; return { id: 'user-a', email: 'test@example.com' }; },
  cloudClient: () => ({ auth: {
    onAuthStateChange: (callback: typeof m.callback) => { m.callback = callback; return { data: { subscription: { unsubscribe: vi.fn() } } }; },
    getSession: async () => ({ data: { session: m.session }, error: null }),
    getBetterAuthInstance: () => ({ resetPassword: m.reset, requestPasswordReset: m.requestReset, emailOtp: { sendVerificationOtp: m.sendOtp, verifyEmail: m.verifyOtp, checkVerificationOtp: m.checkOtp, resetPassword: m.resetOtp }, signIn: { emailOtp: m.signInOtp } }),
    signInWithPassword: m.signInPw,
    signOut: async () => ({ error: null }),

  } }),
}));
vi.mock('./forms', () => ({ hydrateForms: m.hydrate, stopFormSync: vi.fn(), subscribeSync: () => () => {}, syncStatus: () => state, flushForms: vi.fn(), discardLocalChanges: vi.fn() }));
const state = { pending: 0, message: '', conflict: false, conflicted: [] as string[] };
import { CloudGate } from './CloudGate';
beforeEach(() => { m.enabled = true; m.config = null; m.user = null; m.session = null; m.verifyError = null; m.hydrate.mockReset().mockResolvedValue(undefined); m.reset.mockReset().mockResolvedValue({ error: null }); m.requestReset.mockReset().mockResolvedValue({ error: null }); m.sendOtp.mockReset().mockResolvedValue({ error: null }); m.verifyOtp.mockReset().mockResolvedValue({ error: null }); m.signInOtp.mockReset().mockResolvedValue({ error: null }); m.signInPw.mockReset().mockResolvedValue({ error: null }); m.checkOtp.mockReset().mockResolvedValue({ error: null }); m.resetOtp.mockReset().mockResolvedValue({ error: null }); window.history.replaceState(null, '', '/'); });
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

const ready = async () => { render(<CloudGate><div>workspace</div></CloudGate>); await waitFor(() => expect(screen.getByRole('button', { name: '로그인' })).toBeTruthy()); };
const typeCode = (v: string) => fireEvent.change(screen.getByLabelText('1번째 숫자'), { target: { value: v } });   // 붙여넣기처럼 첫 칸에 6자리

test('password login is the default and opens the app only after the account gate', async () => {
  m.signInPw.mockImplementation(async () => { m.session = { user: { id: 'user-a', email: 'test@example.com' } }; return { error: null }; });
  await ready();
  fireEvent.change(screen.getByLabelText('아이디 (회사 이메일)'), { target: { value: 'test@example.com' } });
  fireEvent.change(screen.getByLabelText('비밀번호'), { target: { value: 'kdhc1234!' } });
  fireEvent.click(screen.getByRole('button', { name: '로그인' }));
  await waitFor(() => expect(m.signInPw).toHaveBeenCalledWith({ email: 'test@example.com', password: 'kdhc1234!' }));
  await waitFor(() => expect(screen.getByText('workspace')).toBeTruthy()); expect(m.hydrate).toHaveBeenCalledTimes(1);
});
test('wrong password says so in plain words and offers the code login', async () => {
  m.signInPw.mockResolvedValue({ error: { code: 'INVALID_EMAIL_OR_PASSWORD', message: 'Invalid email or password', status: 401 } });
  await ready();
  fireEvent.change(screen.getByLabelText('아이디 (회사 이메일)'), { target: { value: 'test@example.com' } });
  fireEvent.change(screen.getByLabelText('비밀번호'), { target: { value: 'nope' } });
  fireEvent.click(screen.getByRole('button', { name: '로그인' }));
  await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('아이디 또는 비밀번호가 맞지 않아요'));
  expect(screen.getByRole('button', { name: '인증코드로 로그인' })).toBeTruthy(); expect(screen.queryByText('workspace')).toBeNull();
});
test('forgot password: code → new password → signs in with the new password', async () => {
  m.signInPw.mockImplementation(async () => { m.session = { user: { id: 'user-a', email: 'test@example.com' } }; return { error: null }; });
  await ready();
  fireEvent.change(screen.getByLabelText('아이디 (회사 이메일)'), { target: { value: 'test@example.com' } });
  fireEvent.click(screen.getByRole('button', { name: '비밀번호를 잊었어요' }));
  fireEvent.click(screen.getByRole('button', { name: '인증코드 받기' }));
  await waitFor(() => expect(m.sendOtp).toHaveBeenCalledWith({ email: 'test@example.com', type: 'forget-password' }));
  await waitFor(() => expect(screen.getByRole('button', { name: '다음' })).toBeTruthy());
  typeCode('482915');
  fireEvent.click(screen.getByRole('button', { name: '다음' }));
  await waitFor(() => expect(m.checkOtp).toHaveBeenCalledWith({ email: 'test@example.com', type: 'forget-password', otp: '482915' }));
  fireEvent.change(await screen.findByLabelText('새 비밀번호'), { target: { value: 'new-password-1' } });
  fireEvent.change(screen.getByLabelText('새 비밀번호 확인'), { target: { value: 'new-password-1' } });
  fireEvent.click(screen.getByRole('button', { name: '저장하고 로그인' }));
  await waitFor(() => expect(m.resetOtp).toHaveBeenCalledWith({ email: 'test@example.com', otp: '482915', password: 'new-password-1' }));
  await waitFor(() => expect(m.signInPw).toHaveBeenCalledWith({ email: 'test@example.com', password: 'new-password-1' }));
  await waitFor(() => expect(screen.getByText('workspace')).toBeTruthy());
  expect(m.signInOtp).not.toHaveBeenCalled();
});
test('a wrong code stays on the code step and never resets the password', async () => {
  m.checkOtp.mockResolvedValue({ error: { code: 'INVALID_OTP', message: 'Invalid OTP' } });
  await ready();
  fireEvent.change(screen.getByLabelText('아이디 (회사 이메일)'), { target: { value: 'test@example.com' } });
  fireEvent.click(screen.getByRole('button', { name: '비밀번호를 잊었어요' }));
  fireEvent.click(screen.getByRole('button', { name: '인증코드 받기' }));
  await waitFor(() => expect(screen.getByRole('button', { name: '다음' })).toBeTruthy());
  typeCode('111111');
  fireEvent.click(screen.getByRole('button', { name: '다음' }));
  await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('인증코드가 맞지 않아요'));
  expect(screen.queryByLabelText('새 비밀번호')).toBeNull(); expect(m.resetOtp).not.toHaveBeenCalled();
});
test('new passwords must match before anything is sent', async () => {
  await ready();
  fireEvent.change(screen.getByLabelText('아이디 (회사 이메일)'), { target: { value: 'test@example.com' } });
  fireEvent.click(screen.getByRole('button', { name: '비밀번호를 잊었어요' }));
  fireEvent.click(screen.getByRole('button', { name: '인증코드 받기' }));
  await waitFor(() => expect(screen.getByRole('button', { name: '다음' })).toBeTruthy());
  typeCode('482915'); fireEvent.click(screen.getByRole('button', { name: '다음' }));
  fireEvent.change(await screen.findByLabelText('새 비밀번호'), { target: { value: 'new-password-1' } });
  fireEvent.change(screen.getByLabelText('새 비밀번호 확인'), { target: { value: 'new-password-2' } });
  fireEvent.click(screen.getByRole('button', { name: '저장하고 로그인' }));
  await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('서로 달라요')); expect(m.resetOtp).not.toHaveBeenCalled();
});
test('unverified signed-in account gets the email-verification screen, then the gate rechecks', async () => {
  m.session = { user: { id: 'user-a', email: 'test@example.com' } }; m.verifyError = new Error('이메일 인증이 필요합니다. 인증 메일을 확인한 뒤 다시 로그인하세요.');
  m.verifyOtp.mockImplementation(async () => { m.verifyError = null; return { error: null }; });
  render(<CloudGate><div>workspace</div></CloudGate>);
  await waitFor(() => expect(screen.getByText('이메일 인증이 필요해요')).toBeTruthy());
  fireEvent.click(screen.getByRole('button', { name: '인증코드 받기' }));
  await waitFor(() => expect(m.sendOtp).toHaveBeenCalledWith({ email: 'test@example.com', type: 'email-verification' }));
  typeCode('123456'); fireEvent.click(screen.getByRole('button', { name: '인증하고 시작하기' }));
  await waitFor(() => expect(m.verifyOtp).toHaveBeenCalledWith({ email: 'test@example.com', otp: '123456' }));
  await waitFor(() => expect(screen.getByText('workspace')).toBeTruthy()); expect(m.hydrate).toHaveBeenCalledTimes(1);
});
test('a signed-in account outside the allowlist sees the approval screen and no workspace', async () => {
  m.session = { user: { id: 'user-a', email: 'test@example.com' } }; m.verifyError = new Error('허용된 계정이 아닙니다. 관리자에게 사용 승인을 요청하세요.');
  render(<CloudGate><div>workspace</div></CloudGate>);
  await waitFor(() => expect(screen.getByText('아직 사용 승인 전이에요')).toBeTruthy());
  expect(screen.getByText('test@example.com')).toBeTruthy(); expect(m.hydrate).not.toHaveBeenCalled(); expect(screen.queryByText('workspace')).toBeNull();
});
test('old recovery link still sets a password with the token and clears it from the URL', async () => {
  window.history.replaceState(null, '', '/?token=unit-test-reset-token');
  render(<CloudGate><div>workspace</div></CloudGate>);
  await waitFor(() => expect(screen.getByRole('button', { name: '비밀번호 설정' })).toBeTruthy());
  fireEvent.change(screen.getByLabelText('새 비밀번호'), { target: { value: 'unit-test-password' } });
  fireEvent.change(screen.getByLabelText('새 비밀번호 확인'), { target: { value: 'unit-test-password' } });
  fireEvent.click(screen.getByRole('button', { name: '비밀번호 설정' }));
  await waitFor(() => expect(m.reset).toHaveBeenCalledWith({ newPassword: 'unit-test-password', token: 'unit-test-reset-token' }));
  await waitFor(() => expect(window.location.search).toBe('')); expect(m.hydrate).not.toHaveBeenCalled();
});
test('충돌만 남았으면 저장 재시도는 숨기고 충돌한 양식 이름을 보여준다', async () => {
  m.session = { user: { id: 'user-a' }, access_token: 'test' };
  Object.assign(state, { pending: 1, message: '충돌한 로컬 수정이 남아 있습니다.', conflict: true, conflicted: ['지사별 실적'] });
  try {
    render(<CloudGate><div>workspace</div></CloudGate>);
    await waitFor(() => expect(screen.getByText(/충돌한 양식: '지사별 실적'/)).toBeTruthy());
    expect(screen.queryByRole('button', { name: '저장 재시도' })).toBeNull();
    expect(screen.getByRole('button', { name: '로컬 수정 버리고 서버 불러오기' })).toBeTruthy();
  } finally { Object.assign(state, { pending: 0, message: '', conflict: false, conflicted: [] }); }
});
