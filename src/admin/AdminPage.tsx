import { useEffect, useState, type FormEvent } from 'react';
import { cloudEnabled, cloudFetch } from '../cloud';

export interface AdminUser { email: string; enabled: boolean; isAdmin: boolean; userId: string | null; emailVerified: boolean | null; createdAt: string | null; updatedAt: string }
type Action = 'add' | 'enable' | 'disable' | 'remove';

async function call(init?: RequestInit): Promise<AdminUser[]> {
  const res = await cloudFetch('/api/admin', { cache: 'no-store', ...init, headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) } });
  const body = await res.json().catch(() => ({})) as { users?: AdminUser[]; error?: string };
  if (!res.ok || !Array.isArray(body.users)) throw new Error(body.error ?? `요청 실패 (${res.status})`);
  return body.users;
}

/** 관리자인지 조용히 확인 (관리자 탭 표시용). 관리자가 아니거나 로컬 모드면 false */
export async function probeAdmin(): Promise<boolean> {
  if (!cloudEnabled) return false;
  try { await call(); return true; } catch { return false; }
}

const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleString('ko-KR', { dateStyle: 'short', timeStyle: 'short' }) : '-');

/** 관리자 페이지: 사용할 사람(이메일)을 추가·중지·다시 허용·삭제한다 */
export function AdminPage() {
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');

  const run = async (fn: () => Promise<AdminUser[]>, done?: string) => {
    setBusy(true); setError(''); setInfo('');
    try { setUsers(await fn()); if (done) setInfo(done); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  useEffect(() => { void run(() => call()); }, []);

  const act = (action: Action, target: string, done: string) =>
    run(() => call({ method: 'POST', body: JSON.stringify({ action, email: target }) }), done);

  const add = (e: FormEvent) => {
    e.preventDefault();
    const target = email.trim();
    if (!target) return;
    void act('add', target, `${target} 계정을 추가했어요. 로그인 화면에서 "로그인 코드 받기"로 들어오면 돼요.`).then(() => setEmail(''));
  };

  return (
    <div className="mx-auto flex max-w-[960px] flex-col gap-4 px-4 py-5">
      <div>
        <h1 className="m-0 text-xl font-bold">관리자 · 사용자 관리</h1>
        <p className="m-0 mt-1 text-sm text-sub">여기에 추가한 이메일만 한난MOA에 로그인할 수 있어요. 추가된 사람은 로그인 화면에서 이메일 코드를 받아 들어와요(비밀번호 없음).</p>
      </div>

      <form onSubmit={add} className="flex flex-wrap items-end gap-2 rounded-card border border-line bg-panel p-3">
        <label className="flex flex-1 flex-col gap-1 text-sm">사용자 이메일
          <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@kdhc.co.kr" className="rounded border border-line bg-white px-2 py-1.5" disabled={busy} />
        </label>
        <button type="submit" disabled={busy || !email.trim()} className="rounded-btn bg-pri px-4 py-1.5 font-semibold text-white disabled:opacity-50">추가</button>
      </form>

      {error && <p role="alert" className="m-0 rounded border border-[#f1c0c0] bg-[#fff5f5] px-3 py-2 text-sm text-err-ink">{error}</p>}
      {info && <p role="status" className="m-0 rounded border border-line bg-[#f3faf5] px-3 py-2 text-sm">{info}</p>}

      <div className="overflow-auto rounded-card border border-line bg-white">
        <table className="w-full border-collapse text-sm" aria-label="사용자 목록">
          <thead>
            <tr className="bg-[#f3f5f8] text-left">
              <th className="px-3 py-2">이메일</th><th className="px-3 py-2">상태</th><th className="px-3 py-2">이메일 인증</th><th className="px-3 py-2">추가·변경</th><th className="px-3 py-2 text-right">작업</th>
            </tr>
          </thead>
          <tbody>
            {users === null && <tr><td colSpan={5} className="px-3 py-4 text-center text-sub">불러오는 중…</td></tr>}
            {users?.length === 0 && <tr><td colSpan={5} className="px-3 py-4 text-center text-sub">등록된 사용자가 없어요.</td></tr>}
            {users?.map((u) => (
              <tr key={u.email} className="border-t border-line">
                <td className="px-3 py-2">{u.email}{u.isAdmin && <span className="ml-2 rounded bg-pri-bg px-1.5 py-0.5 text-xs font-semibold text-pri-ink">관리자</span>}</td>
                <td className="px-3 py-2">{u.enabled ? '사용 중' : <span className="text-err-ink">중지됨</span>}</td>
                <td className="px-3 py-2">{u.emailVerified === true ? '완료' : u.emailVerified === false ? '첫 로그인 전' : '-'}</td>
                <td className="px-3 py-2 text-sub">{fmt(u.updatedAt)}</td>
                <td className="px-3 py-2 text-right">
                  {u.isAdmin ? <span className="text-xs text-muted">변경 불가</span> : (
                    <span className="inline-flex gap-1.5">
                      {u.enabled
                        ? <button type="button" disabled={busy} onClick={() => void act('disable', u.email, `${u.email} 사용을 중지했어요.`)} className="rounded-btn border border-line px-2 py-0.5">중지</button>
                        : <button type="button" disabled={busy} onClick={() => void act('enable', u.email, `${u.email}을(를) 다시 허용했어요.`)} className="rounded-btn border border-line px-2 py-0.5">다시 허용</button>}
                      <button type="button" disabled={busy} onClick={() => { if (window.confirm(`${u.email}을(를) 승인 목록에서 삭제할까요? 다시 추가하면 쓸 수 있어요.`)) void act('remove', u.email, `${u.email}을(를) 삭제했어요.`); }} className="rounded-btn border border-[#f1c0c0] px-2 py-0.5 text-err-ink">삭제</button>
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="m-0 text-xs text-muted">중지·삭제하면 다음 요청부터 바로 막혀요. 그 사람이 저장한 양식은 지우지 않아요. 관리자 계정은 이 화면에서 바꿀 수 없어요.</p>
    </div>
  );
}
