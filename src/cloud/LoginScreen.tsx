import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { cloudClient } from './runtime';

/**
 * 로그인 화면 (시안 A 가운데 카드, docs/mockups/login-mockups.html).
 * 기본은 아이디(회사 이메일) + 비밀번호. 잊었을 때만 인증코드 → 새 비밀번호 → 바로 로그인.
 * 인증코드로 비밀번호를 정하면 이메일 인증도 함께 끝난다 (Neon 인증의 email-otp reset-password).
 */

export type GateProblem = { kind: 'verify' | 'denied' | 'other'; message: string } | null;
type Step = 'login' | 'forgot' | 'code' | 'newpw';

const MIN_PW = 8;
const RESEND_SEC = 60;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Neon 인증 오류를 쉬운 한국어로 */
export function loginMessage(error: unknown): string {
  const e = (error ?? {}) as { code?: string; message?: string; status?: number };
  const code = String(e.code ?? '').toUpperCase(); const msg = String(e.message ?? '');
  if (code.includes('INVALID_EMAIL_OR_PASSWORD') || /invalid email or password/i.test(msg) || e.status === 401) return '아이디 또는 비밀번호가 맞지 않아요.';
  if (code.includes('OTP_EXPIRED') || /expired/i.test(msg)) return '인증코드가 만료됐어요. 코드를 다시 받아 주세요.';
  if (code.includes('TOO_MANY_ATTEMPTS')) return '인증코드를 여러 번 틀렸어요. 코드를 다시 받아 주세요.';
  if (code.includes('INVALID_OTP') || /invalid otp|invalid code/i.test(msg)) return '인증코드가 맞지 않아요.';
  if (code.includes('USER_NOT_FOUND')) return '등록되지 않은 아이디예요. 관리자에게 확인해 주세요.';
  if (code.includes('PASSWORD_TOO_SHORT') || /too short/i.test(msg)) return `비밀번호는 ${MIN_PW}자 이상이어야 해요.`;
  if (code.includes('PASSWORD_TOO_LONG') || /too long/i.test(msg)) return '비밀번호가 너무 길어요.';
  if (e.status === 429 || code.includes('TOO_MANY')) return '시도가 너무 많아요. 잠시 후 다시 해 주세요.';
  return msg || '처리하지 못했어요. 잠시 후 다시 해 주세요.';
}
async function call(p: Promise<{ error: unknown }>): Promise<void> {
  const { error } = await p;
  if (error) throw new Error(loginMessage(error));
}

export function LoginScreen({ initialEmail, checking, problem, recoveryToken, onSignedIn, onRecheck, onSignOut, onRecoveryDone }: {
  initialEmail: string;
  checking: string | null;          // 로그인은 됐고 권한·양식 확인 중인 이메일
  problem: GateProblem;             // 로그인 뒤 확인에서 막힌 이유
  recoveryToken: string | null;     // 옛 비밀번호 재설정 메일 링크(?token=)로 들어온 경우
  onSignedIn: () => void;
  onRecheck: () => void;
  onSignOut: () => void;
  onRecoveryDone: () => void;
}) {
  const [step, setStep] = useState<Step>('login');
  const [email, setEmail] = useState(initialEmail);
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [pw, setPw] = useState(''); const [pw2, setPw2] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [wrongPw, setWrongPw] = useState(false);
  const [resendAt, setResendAt] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { if (initialEmail) setEmail(initialEmail); }, [initialEmail]);
  useEffect(() => { if (resendAt <= Date.now()) return; const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, [resendAt]);
  const wait = Math.max(0, Math.ceil((resendAt - now) / 1000));
  const auth = () => cloudClient().auth.getBetterAuthInstance();
  const target = email.trim();

  const run = (fn: () => Promise<void>) => async (e?: FormEvent) => {
    e?.preventDefault();
    setBusy(true); setError(''); setInfo('');
    try { await fn(); } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); } finally { setBusy(false); }
  };
  const go = (s: Step) => { setStep(s); setError(''); setInfo(''); setWrongPw(false); };

  const login = run(async () => {
    if (!EMAIL_RE.test(target)) throw new Error('아이디(회사 이메일)를 확인해 주세요.');
    const { error: e } = await cloudClient().auth.signInWithPassword({ email: target, password });
    if (e) { setWrongPw(true); throw new Error(loginMessage(e)); }
    setPassword(''); onSignedIn();
  });
  const sendCode = (type: 'forget-password' | 'email-verification') => run(async () => {
    if (!EMAIL_RE.test(target)) throw new Error('아이디(회사 이메일)를 확인해 주세요.');
    await call(auth().emailOtp.sendVerificationOtp({ email: target, type }));
    setCode(''); setResendAt(Date.now() + RESEND_SEC * 1000); setNow(Date.now());
    if (type === 'forget-password') setStep('code');
    setInfo('인증코드를 보냈어요. 메일을 확인해 주세요.');
  });
  const checkCode = run(async () => {
    if (!/^\d{6}$/.test(code)) throw new Error('메일로 받은 6자리 인증코드를 넣어 주세요.');
    await call(auth().emailOtp.checkVerificationOtp({ email: target, type: 'forget-password', otp: code }));
    setStep('newpw');
  });
  const savePw = run(async () => {
    if (pw.length < MIN_PW) throw new Error(`새 비밀번호는 ${MIN_PW}자 이상으로 정해 주세요.`);
    if (pw !== pw2) throw new Error('새 비밀번호 두 칸이 서로 달라요.');
    await call(auth().emailOtp.resetPassword({ email: target, otp: code, password: pw }));
    const { error: e } = await cloudClient().auth.signInWithPassword({ email: target, password: pw });
    if (e) throw new Error(loginMessage(e));
    setPw(''); setPw2(''); setCode(''); onSignedIn();
  });
  const verifyEmail = run(async () => {
    if (!/^\d{6}$/.test(code)) throw new Error('메일로 받은 6자리 인증코드를 넣어 주세요.');
    await call(auth().emailOtp.verifyEmail({ email: target, otp: code }));
    setCode(''); onRecheck();
  });
  const recover = run(async () => {
    if (pw.length < MIN_PW) throw new Error(`새 비밀번호는 ${MIN_PW}자 이상으로 정해 주세요.`);
    if (pw !== pw2) throw new Error('새 비밀번호 두 칸이 서로 달라요.');
    await call(auth().resetPassword({ newPassword: pw, token: recoveryToken! }));
    setPw(''); setPw2(''); onRecoveryDone();
    setInfo('비밀번호를 정했어요. 새 비밀번호로 로그인해 주세요.');
  });

  const alerts = <>
    {error && <Note tone="err">{error}</Note>}
    {info && <Note tone="info" status>{info}</Note>}
  </>;
  const who = (action: ReactNode) => <div className="flex items-center gap-2 rounded-box border border-line bg-panel px-2.5 py-2">
    <i className="grid size-[26px] flex-none place-items-center rounded-full bg-pri-bg text-xs font-bold not-italic text-pri-ink">{(target[0] ?? '?').toUpperCase()}</i>
    <span className="min-w-0 flex-1 truncate">{target}</span>{action}
  </div>;
  const newPwFields = <>
    <Field id="np" label="새 비밀번호" hint={`${MIN_PW}자 이상`}><input id="np" className={INPUT} type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} disabled={busy} /></Field>
    <Field id="np2" label="새 비밀번호 확인"><input id="np2" className={INPUT} type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} disabled={busy} /></Field>
  </>;

  // 옛 메일 링크로 들어온 비밀번호 설정
  if (recoveryToken) return <Card title="새 비밀번호 설정" sub="앞으로 쓸 비밀번호를 정해 주세요">
    <form className="flex flex-col gap-3.5" onSubmit={recover}>{newPwFields}{alerts}<Primary busy={busy}>비밀번호 설정</Primary></form>
  </Card>;

  // 로그인은 됐고 확인 중
  if (checking && !problem) return <Card title="로그인했어요" sub="사용 권한을 확인하고 내 양식을 불러오고 있어요">
    <div className="flex flex-col gap-3.5">{who(null)}<Primary busy disabled>불러오는 중</Primary></div>
  </Card>;

  if (problem?.kind === 'verify') return <Card title="이메일 인증이 필요해요" sub="처음 로그인하는 계정은 이메일 주인인지 한 번 확인해요">
    <form className="flex flex-col gap-3.5" onSubmit={verifyEmail}>
      {who(<button type="button" className={LINK} onClick={onSignOut}>로그아웃</button>)}
      <Field id="otp" label="이메일 인증코드" hint={wait ? `${wait}초 뒤 다시 보낼 수 있어요` : undefined}><CodeInput id="otp" value={code} onChange={setCode} disabled={busy} /></Field>
      {alerts}
      <Primary busy={busy}>인증하고 시작하기</Primary>
      <div className="text-right"><button type="button" className={LINK} disabled={busy || wait > 0} onClick={() => void sendCode('email-verification')()}>{info || wait ? '인증코드 다시 보내기' : '인증코드 받기'}</button></div>
    </form>
  </Card>;

  if (problem?.kind === 'denied') return <Card title="아직 사용 승인 전이에요" sub="로그인은 됐지만 관리자 승인이 필요해요">
    <div className="flex flex-col gap-3.5">
      {who(<button type="button" className={LINK} onClick={onSignOut}>로그아웃</button>)}
      <Note tone="warn">이 아이디는 <b>승인 목록에 없어요.</b> 관리자에게 이 이메일 주소로 사용 승인을 요청하세요. 승인되면 [다시 확인]을 누르면 돼요.</Note>
      <button type="button" className={BTN} onClick={() => { void navigator.clipboard?.writeText(target).then(() => setInfo('아이디를 복사했어요.'), () => {}); }}>아이디(이메일) 복사</button>
      {info && <Note tone="info" status>{info}</Note>}
      <Primary onClick={onRecheck}>다시 확인</Primary>
    </div>
  </Card>;

  if (step === 'forgot') return <Card back={() => go('login')} title="인증코드로 로그인" sub="아이디(회사 이메일)로 6자리 인증코드를 보내 드려요" flow={1}>
    <form className="flex flex-col gap-3.5" onSubmit={sendCode('forget-password')}>
      <IdField email={email} setEmail={setEmail} busy={busy} autoFocus />
      {alerts}
      <Primary busy={busy}>인증코드 받기</Primary>
      <p className="m-0 text-xs text-muted">처음 로그인하는 계정이라면 이메일 인증도 이 코드로 함께 끝나요.</p>
    </form>
  </Card>;

  if (step === 'code') return <Card back={() => go('login')} title="메일을 확인하세요" sub="받은 편지함으로 보낸 6자리 인증코드를 넣어 주세요" flow={2}>
    <form className="flex flex-col gap-3.5" onSubmit={checkCode}>
      {who(<button type="button" className={LINK} onClick={() => go('forgot')}>다른 아이디</button>)}
      <Field id="otp" label="인증코드" hint="10분 안에 넣어 주세요 · 스팸함도 확인해 보세요"><CodeInput id="otp" value={code} onChange={setCode} disabled={busy} autoFocus /></Field>
      {alerts}
      <Primary busy={busy}>다음</Primary>
      <p className="m-0 text-xs text-muted">코드가 안 왔나요? {wait
        ? <><b className="text-sub">{Math.floor(wait / 60)}:{String(wait % 60).padStart(2, '0')}</b> 뒤 다시 보낼 수 있어요</>
        : <button type="button" className={LINK} disabled={busy} onClick={() => void sendCode('forget-password')()}>인증코드 다시 보내기</button>}</p>
    </form>
  </Card>;

  if (step === 'newpw') return <Card back={() => go('login')} title="새 비밀번호를 정해 주세요" sub="정하면 바로 로그인해요. 다음부터는 이 비밀번호로 들어오면 돼요" flow={3}>
    <form className="flex flex-col gap-3.5" onSubmit={savePw}>
      {who(null)}{newPwFields}{alerts}
      <Primary busy={busy}>저장하고 로그인</Primary>
    </form>
  </Card>;

  return <Card title="로그인" sub="아이디와 비밀번호를 넣어 주세요" foot="관리자가 승인한 계정만 쓸 수 있어요. 회원가입은 없어요.">
    <form className="flex flex-col gap-3.5" onSubmit={login}>
      <IdField email={email} setEmail={(v) => { setEmail(v); setWrongPw(false); }} busy={busy} autoFocus={!email} />
      <div className="flex flex-col gap-1">
        <div className="flex items-baseline justify-between"><label htmlFor="pw" className="text-[13px] font-semibold">비밀번호</label>
          <button type="button" className={LINK} onClick={() => go('forgot')}>비밀번호를 잊었어요</button></div>
        <input id="pw" className={INPUT + (wrongPw ? ' border-err-ink ring-3 ring-err' : '')} type="password" autoComplete="current-password" required value={password} disabled={busy} autoFocus={!!email}
          onChange={(e) => { setPassword(e.target.value); setWrongPw(false); }} />
      </div>
      {alerts}
      {problem?.kind === 'other' && <Note tone="err">{problem.message} <button type="button" className={LINK} onClick={onRecheck}>다시 확인</button></Note>}
      <Primary busy={busy}>로그인</Primary>
      {wrongPw && <Note tone="info">비밀번호가 기억나지 않으면 <button type="button" className={LINK + ' font-bold'} onClick={() => go('forgot')}>인증코드로 로그인</button>할 수 있어요.</Note>}
    </form>
  </Card>;
}

const INPUT = 'h-10 w-full rounded-btn border border-line-strong bg-white px-3 outline-none focus:border-pri focus:ring-3 focus:ring-pri-bg disabled:bg-panel';
const BTN = 'inline-flex h-10 w-full items-center justify-center gap-1.5 rounded-btn border border-line-strong bg-white font-semibold hover:bg-panel disabled:opacity-60';
const LINK = 'border-0 bg-transparent p-0 text-[12.5px] text-pri hover:underline disabled:text-muted disabled:no-underline';

function Card({ title, sub, children, foot, back, flow }: { title: string; sub: string; children: ReactNode; foot?: string; back?: () => void; flow?: 1 | 2 | 3 }) {
  return (
    <div className="grid min-h-full place-items-center bg-panel px-4 py-10">
      <section className="w-[400px] max-w-full rounded-[12px] border border-line bg-white px-8 pb-7 pt-8 shadow-[0_1px_2px_#0000000a,0_12px_32px_-18px_#18202b33] max-sm:px-5">
        {back && <button type="button" className={LINK + ' -mt-3 mb-3 block'} onClick={back}>← 비밀번호로 로그인</button>}
        <div className="mb-5 flex flex-col items-center gap-1.5 text-center">
          <div aria-hidden className="mb-1.5 grid size-11 place-items-center rounded-[11px] bg-pri text-[15px] font-extrabold text-white">MOA</div>
          <h1 className="m-0 text-[20px] font-bold tracking-tight">{title}</h1>
          <p className="m-0 text-sub">{sub}</p>
        </div>
        {flow && <Flow at={flow} />}
        {children}
        {foot && <p className="m-0 mt-[18px] text-center text-xs text-muted">{foot}</p>}
      </section>
    </div>
  );
}
function Flow({ at }: { at: 1 | 2 | 3 }) {
  return (
    <ol aria-label="진행 단계" className="m-0 -mt-1 mb-[18px] flex list-none items-center gap-1.5 p-0 text-xs text-muted">
      {['아이디 확인', '인증코드', '새 비밀번호'].map((t, i) => {
        const n = i + 1, now = n === at, done = n < at;
        return <li key={t} className="contents">
          <span aria-current={now ? 'step' : undefined} className={'inline-flex items-center gap-1.5 whitespace-nowrap ' + (now ? 'font-bold text-pri' : done ? 'text-auto-ink' : '')}>
            <b className={'inline-grid size-[18px] place-items-center rounded-full text-[10.5px] ' + (now ? 'bg-pri text-white' : done ? 'bg-auto text-auto-ink' : 'bg-chip')}>{done ? '✓' : n}</b>{t}
          </span>
          {n < 3 && <span aria-hidden className="h-px min-w-2.5 flex-1 bg-line" />}
        </li>;
      })}
    </ol>
  );
}
function Field({ id, label, hint, children }: { id: string; label: string; hint?: string; children: ReactNode }) {
  return <div className="flex flex-col gap-1"><label htmlFor={id} className="text-[13px] font-semibold">{label}</label>{children}{hint && <span className="text-xs text-muted">{hint}</span>}</div>;
}
function IdField({ email, setEmail, busy, autoFocus }: { email: string; setEmail: (v: string) => void; busy: boolean; autoFocus?: boolean }) {
  return <Field id="id" label="아이디 (회사 이메일)">
    <input id="id" className={INPUT} type="email" autoComplete="username" placeholder="name@kdhc.co.kr" required value={email} disabled={busy} autoFocus={autoFocus} onChange={(e) => setEmail(e.target.value)} />
  </Field>;
}
function Primary({ busy, disabled, onClick, children }: { busy?: boolean; disabled?: boolean; onClick?: () => void; children: ReactNode }) {
  return <button type={onClick ? 'button' : 'submit'} onClick={onClick} disabled={busy || disabled}
    className="inline-flex h-10 w-full items-center justify-center gap-1.5 rounded-btn border border-pri bg-pri font-bold text-white hover:bg-pri-ink disabled:opacity-70">
    {busy && <i aria-hidden className="size-3.5 animate-spin rounded-full border-2 border-white/40 border-t-white" />}{children}
  </button>;
}
function Note({ tone, status, children }: { tone: 'err' | 'info' | 'warn'; status?: boolean; children: ReactNode }) {
  const c = tone === 'err' ? 'bg-err text-err-ink' : tone === 'warn' ? 'bg-warn text-warn-ink' : 'bg-pri-bg text-pri-ink';
  return <div role={status ? 'status' : tone === 'err' ? 'alert' : undefined} className={'rounded-box px-3 py-2.5 text-[12.5px] ' + c}>{children}</div>;
}

/** 6칸 인증코드. 붙여넣기·자동 다음 칸·지우면 앞 칸. 값은 숫자 문자열 하나로 다룬다 */
function CodeInput({ id, value, onChange, disabled, autoFocus }: { id: string; value: string; onChange: (v: string) => void; disabled?: boolean; autoFocus?: boolean }) {
  const refs = useRef<(HTMLInputElement | null)[]>([]);
  const put = (i: number, raw: string) => {
    const digits = raw.replace(/\D/g, '');
    const cur = value.padEnd(6, ' ').split('');
    if (!digits) { cur[i] = ' '; onChange(cur.join('').trimEnd().replace(/ /g, '')); return; }
    digits.slice(0, 6 - i).split('').forEach((d, k) => { cur[i + k] = d; });
    const next = cur.join('').replace(/ /g, '').slice(0, 6);
    onChange(next);
    refs.current[Math.min(i + digits.length, 5)]?.focus();
  };
  return (
    <div role="group" aria-labelledby={`${id}-l`} className="grid grid-cols-6 gap-2">
      <span id={`${id}-l`} className="sr-only">6자리 인증코드</span>
      {Array.from({ length: 6 }, (_, i) => (
        <input key={i} id={i === 0 ? id : undefined} ref={(el) => { refs.current[i] = el; }} aria-label={`${i + 1}번째 숫자`}
          inputMode="numeric" autoComplete={i === 0 ? 'one-time-code' : 'off'} maxLength={i === 0 ? 6 : 1} disabled={disabled} autoFocus={autoFocus && i === 0}
          value={value[i] ?? ''} onChange={(e) => put(i, e.target.value)} onFocus={(e) => e.target.select()}
          onKeyDown={(e) => { if (e.key === 'Backspace' && !value[i] && i > 0) refs.current[i - 1]?.focus(); }}
          className={'h-[52px] w-full min-w-0 rounded-box border text-center text-[20px] font-bold outline-none focus:border-pri focus:ring-3 focus:ring-pri-bg ' + (value[i] ? 'border-pri-line bg-pri-bg' : 'border-line-strong bg-white')} />
      ))}
    </div>
  );
}
