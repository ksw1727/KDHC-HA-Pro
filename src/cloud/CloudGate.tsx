import { useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import { cloudClient, cloudEnabled, configurationError, setActiveUser, verifyCloudAccount, type CloudSession } from './runtime';
import { discardLocalChanges, flushForms, hydrateForms, stopFormSync, subscribeSync, syncStatus } from './forms';
import { LoginScreen, type GateProblem } from './LoginScreen';

export function CloudGate({ children }: { children: ReactNode }) {
  if (!cloudEnabled) return <>{children}</>;
  if (configurationError) return <Notice title="클라우드 실행 불가">{configurationError}</Notice>;
  return <AuthenticatedGate>{children}</AuthenticatedGate>;
}
function Notice({ title, children }: { title: string; children: ReactNode }) {
  return <section className="m-auto max-w-xl p-8"><h1 className="mb-4 text-xl font-bold">{title}</h1>{children}</section>;
}
function AuthenticatedGate({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState<string | null>(null);
  // 내 계정에서 이메일을 바꾼 직후에는 새 이메일을 미리 채운다
  const [email, setEmail] = useState(() => { try { const v = sessionStorage.getItem('hanan-moa:login-email') ?? ''; sessionStorage.removeItem('hanan-moa:login-email'); return v; } catch { return ''; } });
  const [sessionEmail, setSessionEmail] = useState<string | null>(null);   // 로그인은 됐고 권한·양식 확인 중
  const [recoveryToken, setRecoveryToken] = useState(() => new URLSearchParams(window.location.search).get('token'));
  const recovery = Boolean(recoveryToken);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState(() => new URLSearchParams(window.location.search).has('error') ? '인증 링크가 유효하지 않거나 만료되었습니다. 비밀번호 재설정 메일을 다시 요청하세요.' : '');
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
      if (!session) { setSessionEmail(null); setBusy(false); return; }
      setBusy(true); setError('');
      if ('email' in session.user && typeof session.user.email === 'string') { setEmail(session.user.email); setSessionEmail(session.user.email); } else setSessionEmail('');
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
    setBusy(true); setError('');
    try { await fn(); } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  };
  const signOut = () => void run(async () => { setReady(null); setActiveUser(null); stopFormSync(); const { error } = await cloudClient().auth.signOut(); if (error) throw error; setSessionEmail(null); setRevision(v => v + 1); });
  if (ready && !recovery) return <div className="flex h-full flex-col">
    <div className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-1 text-sm">
      <span>{email}</span><span role="status">{sync.pending ? `미동기화 ${sync.pending}건 · 이 기기에만 저장됨` : '클라우드 동기화 준비됨'}</span>
      <button type="button" disabled={busy} onClick={signOut}>로그아웃</button>
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
  // 로그인 뒤 확인(이메일 인증·승인 목록)에서 막힌 이유를 화면 종류로 (runtime.verifyCloudAccount의 문구)
  const problem: GateProblem = !error ? null
    : /이메일 인증이 필요/.test(error) && sessionEmail !== null ? { kind: 'verify', message: error }
    : /허용된 계정이 아닙니다|허용목록/.test(error) && sessionEmail !== null ? { kind: 'denied', message: error }
    : { kind: 'other', message: error };
  return <LoginScreen initialEmail={email} checking={busy && sessionEmail !== null ? sessionEmail : null} problem={problem} recoveryToken={recoveryToken}
    onSignedIn={() => setRevision(v => v + 1)} onRecheck={() => { setError(''); setRevision(v => v + 1); }} onSignOut={signOut}
    onRecoveryDone={() => {
      setRecoveryToken(null);
      const url = new URL(window.location.href); url.searchParams.delete('token'); url.searchParams.delete('error');
      window.history.replaceState(null, '', url.pathname + url.search);
      setError(''); setRevision(v => v + 1);
    }} />;
}
