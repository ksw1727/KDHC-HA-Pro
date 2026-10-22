import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { cloudFetch, nativeAuth } from '../cloud';

export interface Me { email: string; name: string; emailVerified: boolean; hasPassword: boolean; isAdmin: boolean }

const MIN_PW = 8;

/** Neon 인증 오류를 쉬운 한국어로 */
export function authMessage(error: unknown): string {
  const e = (error ?? {}) as { code?: string; message?: string; status?: number };
  const code = String(e.code ?? '').toUpperCase(); const msg = String(e.message ?? '');
  if (code.includes('INVALID_PASSWORD') || /invalid password/i.test(msg)) return '현재 비밀번호가 맞지 않아요.';
  if (code.includes('PASSWORD_TOO_SHORT') || /too short/i.test(msg)) return `비밀번호는 ${MIN_PW}자 이상이어야 해요.`;
  if (code.includes('PASSWORD_TOO_LONG') || /too long/i.test(msg)) return '비밀번호가 너무 길어요.';
  if (code.includes('OTP_EXPIRED') || /expired/i.test(msg)) return '인증 코드가 만료됐어요. 코드를 다시 받아 주세요.';
  if (code.includes('INVALID_OTP') || /invalid otp|invalid code/i.test(msg)) return '인증 코드가 맞지 않아요.';
  if (code.includes('TOO_MANY') || e.status === 429) return '시도가 너무 많아요. 잠시 후 다시 해 주세요.';
  if (code.includes('CHANGE_EMAIL_DISABLED') || /change email is disabled|verification email isn't enabled/i.test(msg)) return '지금은 이메일 변경을 쓸 수 없어요. 관리자에게 문의해 주세요.';
  if (/same/i.test(msg)) return '지금 이메일과 같아요.';
  return msg ? `처리하지 못했어요: ${msg}` : '처리하지 못했어요. 잠시 후 다시 해 주세요.';
}
async function unwrap<T>(p: Promise<{ data: T | null; error: unknown }>): Promise<T | null> {
  const { data, error } = await p;
  if (error) throw new Error(authMessage(error));
  return data;
}
export function passwordProblem(pw: string, again: string): string {
  if (pw.length < MIN_PW) return `새 비밀번호는 ${MIN_PW}자 이상으로 정해 주세요.`;
  if (pw !== again) return '새 비밀번호 두 칸이 서로 달라요.';
  return '';
}

function Section({ title, desc, children }: { title: string; desc?: ReactNode; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2 rounded-card border border-line bg-panel p-4">
      <h2 className="m-0 text-base font-bold">{title}</h2>
      {desc && <p className="m-0 text-sm text-sub">{desc}</p>}
      {children}
    </section>
  );
}
const input = 'rounded border border-line bg-white px-2 py-1.5';
const btn = 'rounded-btn bg-pri px-4 py-1.5 font-semibold text-white disabled:opacity-50';
const btn2 = 'rounded-btn border border-line bg-white px-3 py-1.5 disabled:opacity-50';

/** 내 계정: 이름·비밀번호·이메일(아이디) 변경 */
export function AccountPage() {
  const [me, setMe] = useState<Me | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [name, setName] = useState('');
  const [cur, setCur] = useState(''); const [pw, setPw] = useState(''); const [pw2, setPw2] = useState('');
  const [codeMode, setCodeMode] = useState(false); const [codeSent, setCodeSent] = useState(false); const [code, setCode] = useState('');
  const [newEmail, setNewEmail] = useState(''); const [newEmail2, setNewEmail2] = useState('');

  const load = async () => {
    const res = await cloudFetch('/api/me', { cache: 'no-store' });
    const body = await res.json().catch(() => ({})) as Partial<Me> & { error?: string };
    if (!res.ok || !body.email) throw new Error(body.error ?? `계정 정보를 불러오지 못했어요 (${res.status})`);
    setMe(body as Me); setName(body.name ?? ''); setCodeMode(!body.hasPassword);
  };
  const run = async (fn: () => Promise<void>, done?: string) => {
    setBusy(true); setError(''); setInfo('');
    try { await fn(); if (done) setInfo(done); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  useEffect(() => { void run(load); }, []);

  const saveName = (e: FormEvent) => { e.preventDefault(); void run(async () => {
    const n = name.trim(); if (!n) throw new Error('이름을 입력해 주세요.'); if (n.length > 60) throw new Error('이름은 60자 이내로 적어 주세요.');
    await unwrap(nativeAuth().updateUser({ name: n })); await load();
  }, '이름을 바꿨어요.'); };

  const clearPw = () => { setCur(''); setPw(''); setPw2(''); setCode(''); setCodeSent(false); };
  const changeWithCurrent = (e: FormEvent) => { e.preventDefault(); void run(async () => {
    const p = passwordProblem(pw, pw2); if (p) throw new Error(p); if (!cur) throw new Error('현재 비밀번호를 입력해 주세요.');
    await unwrap(nativeAuth().changePassword({ currentPassword: cur, newPassword: pw, revokeOtherSessions: true }));
    clearPw(); await load();
  }, '비밀번호를 바꿨어요. 다른 기기의 로그인은 끊었어요.'); };
  const sendCode = () => void run(async () => {
    if (!me) return;
    await unwrap(nativeAuth().emailOtp.sendVerificationOtp({ email: me.email, type: 'forget-password' }));
    setCodeSent(true);
  }, `${me?.email ?? ''}로 인증 코드를 보냈어요. 메일의 6자리 코드를 넣어 주세요.`);
  const setWithCode = (e: FormEvent) => { e.preventDefault(); void run(async () => {
    if (!me) return;
    const p = passwordProblem(pw, pw2); if (p) throw new Error(p); if (!/^\d{4,10}$/.test(code.trim())) throw new Error('메일로 받은 인증 코드를 넣어 주세요.');
    await unwrap(nativeAuth().emailOtp.resetPassword({ email: me.email, otp: code.trim(), password: pw }));
    clearPw(); await load(); setCodeMode(false);
  }, me?.hasPassword ? '비밀번호를 새로 정했어요.' : '비밀번호를 만들었어요. 이제 이메일과 비밀번호로도 로그인할 수 있어요.'); };

  const changeEmail = (e: FormEvent) => { e.preventDefault(); void run(async () => {
    if (!me) return;
    const a = newEmail.trim().toLowerCase(), b = newEmail2.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(a)) throw new Error('새 이메일 형식이 올바르지 않아요.');
    if (a !== b) throw new Error('새 이메일 두 칸이 서로 달라요.');
    if (a === me.email) throw new Error('지금 이메일과 같아요.');
    if (!window.confirm(`로그인 이메일을 ${a}(으)로 바꿀까요?\n\n바꾸면 로그아웃되고, 새 이메일로 받은 코드로 인증해야 다시 들어올 수 있어요. 주소가 틀리면 로그인할 수 없으니 꼭 확인해 주세요.`)) return;
    const res = await cloudFetch('/api/me', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'changeEmail', newEmail: a }) });
    const body = await res.json().catch(() => ({})) as { error?: string };
    if (!res.ok) throw new Error(body.error ?? `이메일을 바꾸지 못했어요 (${res.status})`);
    try { sessionStorage.setItem('hanan-moa:login-email', a); } catch { /* 없어도 됨 */ }
    await nativeAuth().signOut().catch(() => undefined);
    window.location.reload();
  }); };

  if (!me) return <div className="mx-auto max-w-[720px] p-6">{error ? <p role="alert" className="text-err-ink">{error}</p> : '불러오는 중…'}</div>;
  return (
    <div className="mx-auto flex max-w-[720px] flex-col gap-4 px-4 py-5">
      <div>
        <h1 className="m-0 text-xl font-bold">내 계정</h1>
        <p className="m-0 mt-1 text-sm text-sub">로그인 이메일(아이디): <b className="text-ink">{me.email}</b>{me.isAdmin && <span className="ml-2 rounded bg-pri-bg px-1.5 py-0.5 text-xs font-semibold text-pri-ink">관리자</span>} · 이메일 인증 {me.emailVerified ? '완료' : '전'} · 비밀번호 {me.hasPassword ? '있음' : '없음(이메일 코드로만 로그인)'}</p>
      </div>
      {error && <p role="alert" className="m-0 rounded border border-[#f1c0c0] bg-[#fff5f5] px-3 py-2 text-sm text-err-ink">{error}</p>}
      {info && <p role="status" className="m-0 rounded border border-line bg-[#f3faf5] px-3 py-2 text-sm">{info}</p>}

      <Section title="이름">
        <form onSubmit={saveName} className="flex flex-wrap items-end gap-2">
          <label className="flex flex-1 flex-col gap-1 text-sm">표시 이름<input className={input} value={name} onChange={(e) => setName(e.target.value)} disabled={busy} maxLength={60} /></label>
          <button type="submit" className={btn} disabled={busy || !name.trim() || name.trim() === me.name}>저장</button>
        </form>
      </Section>

      <Section title={me.hasPassword ? '비밀번호 변경' : '비밀번호 만들기'}
        desc={me.hasPassword ? '현재 비밀번호로 바꾸거나, 잊었으면 이메일 코드로 새로 정할 수 있어요.' : '지금은 이메일 코드로만 로그인해요. 비밀번호를 만들면 이메일과 비밀번호로도 로그인할 수 있어요. 본인 확인을 위해 이메일로 코드를 보내요.'}>
        {me.hasPassword && (
          <div className="flex gap-1.5 text-sm" role="radiogroup" aria-label="비밀번호 변경 방법">
            <button type="button" role="radio" aria-checked={!codeMode} className={btn2} onClick={() => { setCodeMode(false); clearPw(); }} disabled={busy}>현재 비밀번호로</button>
            <button type="button" role="radio" aria-checked={codeMode} className={btn2} onClick={() => { setCodeMode(true); clearPw(); }} disabled={busy}>이메일 코드로(잊었을 때)</button>
          </div>
        )}
        {!codeMode ? (
          <form onSubmit={changeWithCurrent} className="flex flex-col gap-2">
            <label className="flex flex-col gap-1 text-sm">현재 비밀번호<input className={input} type="password" autoComplete="current-password" value={cur} onChange={(e) => setCur(e.target.value)} disabled={busy} /></label>
            <label className="flex flex-col gap-1 text-sm">새 비밀번호 ({MIN_PW}자 이상)<input className={input} type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} disabled={busy} /></label>
            <label className="flex flex-col gap-1 text-sm">새 비밀번호 확인<input className={input} type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} disabled={busy} /></label>
            <div><button type="submit" className={btn} disabled={busy || !cur || !pw || !pw2}>비밀번호 바꾸기</button></div>
          </form>
        ) : (
          <form onSubmit={setWithCode} className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <button type="button" className={btn2} onClick={sendCode} disabled={busy}>{codeSent ? '코드 다시 받기' : `${me.email}로 인증 코드 받기`}</button>
            </div>
            <label className="flex flex-col gap-1 text-sm">인증 코드<input className={input} inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} disabled={busy || !codeSent} /></label>
            <label className="flex flex-col gap-1 text-sm">새 비밀번호 ({MIN_PW}자 이상)<input className={input} type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} disabled={busy || !codeSent} /></label>
            <label className="flex flex-col gap-1 text-sm">새 비밀번호 확인<input className={input} type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} disabled={busy || !codeSent} /></label>
            <div><button type="submit" className={btn} disabled={busy || !codeSent || !code || !pw || !pw2}>{me.hasPassword ? '새 비밀번호 정하기' : '비밀번호 만들기'}</button></div>
          </form>
        )}
      </Section>

      <Section title="로그인 이메일(아이디) 변경"
        desc={<>바꾸면 바로 로그아웃돼요. 로그인 화면에서 새 이메일로 <b>[이메일 인증 코드 받기]</b> → 인증한 뒤 <b>[로그인 코드 받기]</b>(또는 비밀번호)로 들어오면 돼요. 주소가 틀리면 로그인할 수 없으니 두 번 정확히 적어 주세요.{me.isAdmin && ' 관리자 계정은 특히 주의해 주세요.'}</>}>
        <form onSubmit={changeEmail} className="flex flex-col gap-2">
          <label className="flex flex-col gap-1 text-sm">새 이메일<input className={input} type="email" autoComplete="off" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} disabled={busy} /></label>
          <label className="flex flex-col gap-1 text-sm">새 이메일 확인<input className={input} type="email" autoComplete="off" value={newEmail2} onChange={(e) => setNewEmail2(e.target.value)} disabled={busy} /></label>
          <div><button type="submit" className={btn} disabled={busy || !newEmail || !newEmail2}>이메일 바꾸기</button></div>
        </form>
      </Section>
    </div>
  );
}
