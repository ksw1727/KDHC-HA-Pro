import { useEffect, useState, useSyncExternalStore, type FormEvent, type ReactNode } from 'react';
import { cloudClient, cloudEnabled, configurationError, setActiveUser, verifyCloudAccount, type CloudSession } from './runtime';
import { discardLocalChanges, flushForms, hydrateForms, stopFormSync, subscribeSync, syncStatus } from './forms';

export function CloudGate({ children }: { children: ReactNode }) {
  if (!cloudEnabled) return <>{children}</>;
  if (configurationError) return <Notice title="클라우드 실행 불가">{configurationError}</Notice>;
  return <AuthenticatedGate>{children}</AuthenticatedGate>;
}
function Notice({ title, children }: { title: string; children: ReactNode }) {
  return <section className="m-auto max-w-xl p-8"><h1 className="mb-4 text-xl font-bold">{title}</h1>{children}</section>;
}
type OtpPurpose = 'email-verification' | 'sign-in';
function AuthenticatedGate({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState<string | null>(null);
  // 내 계정에서 이메일을 바꾼 직후에는 새 이메일을 미리 채운다
  const [email, setEmail] = useState(() => { try { const v = sessionStorage.getItem('hanan-moa:login-email') ?? ''; sessionStorage.removeItem('hanan-moa:login-email'); return v; } catch { return ''; } });
  const [password, setPassword] = useState('');
  const [otp, setOtp] = useState('');
  const [otpPurpose, setOtpPurpose] = useState<OtpPurpose>('email-verification');
  const [recoveryToken, setRecoveryToken] = useState(() => new URLSearchParams(window.location.search).get('token'));
  const recovery = Boolean(recoveryToken);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState(() => new URLSearchParams(window.location.search).has('error') ? '인증 링크가 유효하지 않거나 만료되었습니다. 비밀번호 재설정 메일을 다시 요청하세요.' : '');
  const [info, setInfo] = useState('');
  const sync = useSyncExternalStore(subscribeSync, syncStatus);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let alive = true;
    let attempt = 0;
    let current: string | null = null;
    const recovering = recovery;
    const client = cloudClient();
    const activate = async (session: CloudSession | null) => {
      if (!alive) return;
      // Token refresh does not remount or discard the active workspace.
      if (session?.user.id === current) return;
      const ticket = ++attempt;
      current = null; setReady(null); setActiveUser(null); stopFormSync();
      if (!session) { setBusy(false); return; }
      setBusy(true); setError('');
      if ('email' in session.user && typeof session.user.email === 'string') setEmail(session.user.email);
      try {
        if (recovering) { setBusy(false); return; }
        const user = await verifyCloudAccount(session.user.id);
        if (!alive || ticket !== attempt) return;
        setActiveUser(user.id);
        if (!recovering) await hydrateForms();
        if (!alive || ticket !== attempt) return;
        current = user.id; setEmail(user.email);
        if (!recovering) setReady(user.id);
      } catch (cause) {
        if (!alive || ticket !== attempt) return;
        setActiveUser(null); stopFormSync(); setError(cause instanceof Error ? cause.message : String(cause));
      } finally { if (alive && ticket === attempt) setBusy(false); }
    };
    // Keep adapter callbacks synchronous; verification runs outside its state notification.
    const { data: subscription } = client.auth.onAuthStateChange((event, session) => {
      if (event === 'INITIAL_SESSION') return;
      setTimeout(() => { if (alive) void activate(session); }, 0);
    });
    void client.auth.getSession().then(({ data, error: sessionError }) => {
      if (!alive || attempt) return;
      if (sessionError) { setError(sessionError.message); setBusy(false); return; }
      void activate(data.session);
    }).catch(() => { if (alive) { setError('인증 서버 연결에 실패했습니다. /api/auth 프록시 설정을 확인하세요.'); setBusy(false); } });
    const online = () => { void flushForms(); };
    window.addEventListener('online', online);
    return () => { alive = false; attempt++; subscription.subscription.unsubscribe(); window.removeEventListener('online', online); setActiveUser(null); stopFormSync(); };
  // A successful password update restarts verified hydration.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revision]);
  const run = async (fn: () => Promise<void>) => {
    setBusy(true); setError(''); setInfo('');
    try { await fn(); } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  };
  const requestOtp = (purpose: OtpPurpose) => {
    void run(async () => {
      // Purpose is switched before requesting, so a previous code cannot carry over.
      setOtpPurpose(purpose); setOtp('');
      const target = email.trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(target)) throw new Error('올바른 이메일을 입력하세요.');
      const { error } = await cloudClient().auth.getBetterAuthInstance().emailOtp.sendVerificationOtp({ email: target, type: purpose });
      if (error) throw error;
      setInfo(purpose === 'sign-in'
        ? '로그인 코드 발송을 요청했습니다. 메일의 로그인용 코드를 입력하세요. 관리자 승인 계정만 앱을 사용할 수 있습니다.'
        : '등록된 계정이면 이메일 인증 코드가 발송됩니다. 메일의 인증용 코드를 입력하세요.');
    });
  };
  const login = (event: FormEvent) => {
    event.preventDefault();
    void run(async () => {
      const { error } = recoveryToken
        ? await cloudClient().auth.getBetterAuthInstance().resetPassword({ newPassword: password, token: recoveryToken })
        : await cloudClient().auth.signInWithPassword({ email, password });
      if (error) throw error;
      setPassword('');
      if (recovery) {
        setRecoveryToken(null);
        const url = new URL(window.location.href); url.searchParams.delete('token'); url.searchParams.delete('error');
        window.history.replaceState(null, '', url.pathname + url.search);
        setInfo('비밀번호를 설정했습니다. 새 비밀번호로 로그인하세요.');
      }
      setRevision(v => v + 1);
    });
  };
  if (ready && !recovery) return <div className="flex h-full flex-col">
    <div className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-1 text-sm">
      <span>{email}</span><span role="status">{sync.pending ? `미동기화 ${sync.pending}건 · 이 기기에만 저장됨` : '클라우드 동기화 준비됨'}</span>
      <button type="button" disabled={busy} onClick={() => void run(async () => { setReady(null); setActiveUser(null); stopFormSync(); const { error } = await cloudClient().auth.signOut(); if (error) throw error; setRevision(v => v + 1); })}>로그아웃</button>
    </div>
    {(sync.message || error) && <div role="alert" className="border-b border-line bg-amber-50 px-4 py-2 text-sm">
      {error || sync.message}
      <button className="ml-3 underline" type="button" onClick={() => void flushForms()}>저장 재시도</button>
      {sync.pending > 0 && <button className="ml-3 underline" type="button" onClick={() => {
        if (window.confirm('이 기기의 미동기화 양식 수정을 모두 버리고 서버 양식을 불러올까요?')) void run(async () => { await discardLocalChanges(); setRevision(v => v + 1); });
      }}>로컬 수정 버리고 서버 불러오기</button>}
    </div>}
    <div key={ready + ':' + revision} className="min-h-0 flex-1">{children}</div>
  </div>;
  return <Notice title={recovery ? '초대 / 비밀번호 설정' : '한난MOA 로그인'}>
    <p className="mb-4">관리자가 승인한 이메일 인증 계정만 사용할 수 있습니다. 이 화면에서는 회원가입을 제공하지 않습니다.</p>
    <form onSubmit={login} className="flex flex-col gap-3">
      {!recovery && <label>이메일<input className="ml-2 rounded border p-2" type="email" autoComplete="username" required disabled={busy} value={email} onChange={e => { setEmail(e.target.value); setOtp(''); setInfo(''); }} /></label>}
      <label>{recovery ? '새 비밀번호' : '비밀번호'}<input className="ml-2 rounded border p-2" type="password" autoComplete={recovery ? 'new-password' : 'current-password'} minLength={recovery ? 8 : undefined} required value={password} onChange={e => setPassword(e.target.value)} /></label>
      <button className="rounded bg-pri p-2 text-white" disabled={busy} type="submit">{busy ? '인증 / 양식 불러오는 중…' : recovery ? '비밀번호 설정' : '로그인'}</button>
    </form>
    {!recovery && <section aria-label="이메일 인증" className="mt-5 rounded border p-3">
      <h2 className="font-semibold">이메일 코드 인증 / 로그인</h2>
      <p className="mt-1 text-sm">비밀번호 없이 로그인하려면 로그인 코드를 받으세요. 이메일 인증만 필요한 경우 인증 코드를 받으세요. 두 코드는 서로 다른 용도입니다.</p>
      <div className="mt-2 flex flex-wrap gap-4">
        <button className="underline" disabled={busy || !email.trim()} type="button" onClick={() => requestOtp('sign-in')}>로그인 코드 받기</button>
        <button className="underline" disabled={busy || !email.trim()} type="button" onClick={() => requestOtp('email-verification')}>이메일 인증 코드 받기</button>
      </div>
      <p className="mt-3 text-sm" id="otp-purpose">{otpPurpose === 'sign-in' ? '현재 입력: 로그인용 코드. 이메일 인증 코드를 입력하지 마세요.' : '현재 입력: 이메일 인증용 코드. 로그인 코드를 입력하지 마세요.'}</p>
      <form className="mt-3 flex flex-wrap items-center gap-2" onSubmit={event => {
        event.preventDefault();
        void run(async () => {
          const native = cloudClient().auth.getBetterAuthInstance();
          const payload = { email: email.trim(), otp: otp.trim() };
          const { error } = otpPurpose === 'sign-in'
            ? await native.signIn.emailOtp(payload)
            : await native.emailOtp.verifyEmail(payload);
          if (error) throw error;
          setOtp('');
          if (otpPurpose === 'sign-in') setPassword('');
          setInfo(otpPurpose === 'sign-in'
            ? '코드 로그인을 완료했습니다. 이메일 인증 상태와 관리자 승인을 확인합니다.'
            : '이메일 인증을 완료했습니다. 로그인 상태와 사용 권한을 다시 확인합니다. 필요하면 로그인 코드를 받거나 비밀번호로 로그인하세요.');
          setRevision(v => v + 1);
        });
      }}>
        <label>인증 코드<input className="ml-2 w-32 rounded border p-2" type="text" inputMode="numeric" autoComplete="one-time-code" aria-describedby="otp-purpose" pattern="[0-9]+" required value={otp} disabled={busy} onChange={e => setOtp(e.target.value)} /></label>
        <button className="rounded border p-2" disabled={busy || !email.trim() || !otp.trim()} type="submit">{otpPurpose === 'sign-in' ? '코드로 로그인' : '이메일 인증 확인'}</button>
      </form>
      <p className="mt-2 text-sm">이메일 인증 후에도 관리자 승인이 필요합니다. 비밀번호 재설정 메일과는 별개입니다.</p>
    </section>}
    {!recovery && <button className="mt-4 underline" disabled={busy || !email} type="button" onClick={() => void run(async () => {
      const { error } = await cloudClient().auth.getBetterAuthInstance().requestPasswordReset({ email, redirectTo: window.location.origin + window.location.pathname });
      if (error) throw error;
      setInfo('등록된 계정이면 비밀번호 재설정 메일이 발송됩니다. 메일의 링크를 열어주세요.');
    })}>비밀번호 재설정 메일 받기</button>}
    {error && <p role="alert" className="mt-4 text-red-700">{error}</p>}
    {info && <p role="status" className="mt-4">{info}</p>}
    {error && <button type="button" className="mt-2 underline" onClick={() => setRevision(v => v + 1)}>세션 / 양식 다시 확인</button>}
  </Notice>;
}
