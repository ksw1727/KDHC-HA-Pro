import { useEffect, useRef, useState } from 'react';
import { cloudEnabled, readCloudChat, scopedStorageKey, writeCloudChat } from '../cloud';
import { canonicalJSON } from '@contract/checksum';

export interface Draft { chatId: string | null; msgs: unknown[]; aiVersion: string | null }
const empty = (): Draft => ({ chatId: null, msgs: [], aiVersion: null });
const key = () => scopedStorageKey('hanan-moa:ai-chat');
// 서버(jsonb)는 키 순서를 바꿔 돌려주므로 키 순서와 무관하게 비교한다
const signature = (value: Draft) => canonicalJSON(value);
export function parseDraft(value: unknown): Draft | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Partial<Draft>;
  if (!Array.isArray(v.msgs)) return null;
  return { chatId: typeof v.chatId === 'string' ? v.chatId : null, msgs: v.msgs.filter((m) => m && typeof m === 'object' && ['ai', 'user'].includes((m as { role: string }).role)).map((m) => ({ ...m as object, status: undefined })), aiVersion: typeof v.aiVersion === 'string' ? v.aiVersion : null };
}
export function loadDraft(): Draft {
  try { return parseDraft(JSON.parse(localStorage.getItem(key()) ?? 'null')) ?? empty(); } catch { return empty(); }
}
function cache(value: Draft, unsynced: boolean) {
  try { localStorage.setItem(key(), JSON.stringify({ ...value, unsynced })); } catch { /* storage may be unavailable */ }
}

/** A single in-flight writer and latest-only debounce. Never write until a successful read. */
export function useCloudDraft(payload: Draft, busy: boolean, apply: (draft: Draft) => void) {
  const [ready, setReady] = useState(!cloudEnabled);
  const [notice, setNotice] = useState('');
  const [conflict, setConflict] = useState(false);
  const [tick, setTick] = useState(0);
  const latest = useRef(payload); latest.current = payload;
  const busyRef = useRef(busy); busyRef.current = busy;
  const applyRef = useRef(apply); applyRef.current = apply;
  const alive = useRef(true);
  const allowed = useRef(false);
  const writing = useRef(false);
  const confirmed = useRef('');
  const resolving = useRef(false);
  // 서버에 메시지가 있는 대화가 있으면, 사용자가 [새 대화]를 누른 경우에만 빈 대화로 바꾼다
  const serverHasMsgs = useRef(false);
  const clearRequested = useRef(false);

  const read = async (choice?: 'server' | 'local') => {
    if (resolving.current) return;
    resolving.current = true;
    allowed.current = false;
    setReady(false);
    let dirty = false;
    try { const stored = JSON.parse(localStorage.getItem(key()) ?? 'null'); dirty = !!stored && stored.unsynced !== false; } catch { /* no cache */ }
    try {
      const remote = parseDraft(await readCloudChat()) ?? empty();
      if (!alive.current) return;
      const local = latest.current;
      if (!choice && dirty && signature(remote) !== signature(local)) {
        setConflict(true); setNotice('이 기기와 서버의 대화가 달라요. 사용할 대화를 선택해 주세요.'); return;
      }
      confirmed.current = signature(remote);
      serverHasMsgs.current = remote.msgs.length > 0;
      // 서버가 비어 있는데 이 기기에 대화가 있으면 지우지 않고 이 기기 대화를 올린다
      const keepLocal = !choice && remote.msgs.length === 0 && local.msgs.length > 0;
      const chosen = choice === 'local' || keepLocal ? local : remote;
      latest.current = chosen;
      applyRef.current(chosen);
      cache(chosen, signature(chosen) !== confirmed.current);
      allowed.current = true;
      setConflict(false); setNotice(''); setReady(true); setTick((n) => n + 1);
    } catch (error) {
      if (alive.current) { setNotice(`서버 대화를 불러오지 못했어요. 대화는 이 기기에만 보관해요. ${(error as Error).message}`); setConflict(false); }
    } finally { resolving.current = false; }
  };

  useEffect(() => {
    alive.current = true;
    if (cloudEnabled) void read();
    return () => { alive.current = false; allowed.current = false; };
    // CloudGate remounts this component when the user changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!cloudEnabled) {
      try { if (payload.msgs.length) localStorage.setItem(key(), JSON.stringify(payload)); else localStorage.removeItem(key()); } catch { /* local-only */ }
      return;
    }
    cache(payload, signature(payload) !== confirmed.current);
    if (!ready || !allowed.current || busy || writing.current || signature(payload) === confirmed.current) return;
    if (payload.msgs.length === 0 && serverHasMsgs.current && !clearRequested.current) return;
    const timer = setTimeout(() => {
      if (!allowed.current || busyRef.current || writing.current || !alive.current) return;
      const next = latest.current;
      if (next.msgs.length === 0 && serverHasMsgs.current && !clearRequested.current) return;
      writing.current = true;
      void writeCloudChat({ ...next, savedAt: new Date().toISOString() }).then(() => {
        confirmed.current = signature(next);
        serverHasMsgs.current = next.msgs.length > 0;
        if (next.msgs.length === 0) clearRequested.current = false;
        if (alive.current) { cache(latest.current, signature(latest.current) !== confirmed.current); setNotice(''); }
      }).catch((error: Error) => {
        if (alive.current) {
          allowed.current = false;
          setConflict(true);
          setReady(false);
          setNotice(`서버 저장 실패: 이 기기에만 보관해요. ${error.message} 사용할 대화를 다시 선택해 주세요.`);
        }
      }).finally(() => { writing.current = false; if (alive.current) setTick((n) => n + 1); });
    }, 450);
    return () => clearTimeout(timer);
  }, [payload.chatId, payload.msgs, payload.aiVersion, busy, ready, tick]);

  return { ready, notice, conflict, markCleared: () => { clearRequested.current = true; }, reload: () => void read(), chooseServer: () => void read('server'), chooseLocal: () => void read('local') };
}
