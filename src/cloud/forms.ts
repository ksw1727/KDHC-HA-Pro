import type { StoredForm } from '../generator/storage/localForms';
import { markRemoved } from '../generator/storage/removedForms';
import { activeUser, cloudClient, cloudEnabled, requireUser, scopedStorageKey } from './runtime';

interface Row { form_id: string; payload: StoredForm; updated_at: string; deleted_at: string | null }
interface Pending { payload: StoredForm | null; deletedPayload?: StoredForm; base: string | null; conflict?: boolean }
interface CacheMeta { versions: Record<string, string>; pending: Record<string, Pending> }
export interface SyncStatus { pending: number; message: string; conflict: boolean }
let status: SyncStatus = { pending: 0, message: '', conflict: false };
const listeners = new Set<() => void>();
export function syncStatus(): SyncStatus { return status; }
export function subscribeSync(listener: () => void): () => void { listeners.add(listener); return () => { listeners.delete(listener); }; }
function report(meta?: CacheMeta, message = '') {
  status = { pending: Object.keys(meta?.pending ?? {}).length, message, conflict: Object.values(meta?.pending ?? {}).some(p => p.conflict) ?? false };
  listeners.forEach(f => f());
}
const PREFIX = 'hanan-moa:forms:';
const META = 'hanan-moa:sync-meta';
function readMeta(): CacheMeta {
  const raw = localStorage.getItem(scopedStorageKey(META));
  return raw ? JSON.parse(raw) as CacheMeta : { versions: {}, pending: {} };
}
function persist(meta: CacheMeta) { localStorage.setItem(scopedStorageKey(META), JSON.stringify(meta)); }
function cacheRow(row: Row) {
  const key = scopedStorageKey(PREFIX + row.form_id);
  if (row.deleted_at) { localStorage.removeItem(key); markRemoved(row.form_id, true); }
  else localStorage.setItem(key, JSON.stringify(row.payload));
}
let timer: ReturnType<typeof setTimeout> | undefined;
let running: Promise<void> | undefined;
let sequence = 0;
export function stopFormSync() { sequence++; if (timer) clearTimeout(timer); timer = undefined; running = undefined; report(); }
export function reportStorageFailure(): void {
  if (cloudEnabled) report(undefined, '로컬 저장 또는 동기화 대기열 기록 실패. 변경이 저장되지 않았을 수 있습니다. 저장 공간을 확인하세요.');
}
export function queueForm(formId: string, payload: StoredForm | null, deletedPayload?: StoredForm): void {
  if (!cloudEnabled) return;
  requireUser();
  const meta = readMeta();
  if (!payload && !deletedPayload && !meta.pending[formId]?.payload && !meta.versions[formId]) return;
  meta.pending[formId] = { ...meta.pending[formId], payload, deletedPayload: deletedPayload ?? meta.pending[formId]?.payload ?? meta.pending[formId]?.deletedPayload, base: meta.pending[formId]?.base ?? meta.versions[formId] ?? null };
  persist(meta);
  report(meta, '클라우드 저장 대기 중 · 현재는 이 기기에만 저장됨');
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => { void flushForms(); }, 400);
}
/** Hydrates only the authenticated user's cache. Anonymous keys are never read or uploaded. */
export async function hydrateForms(): Promise<void> {
  const owner = requireUser();
  const epoch = sequence;
  const rows: Row[] = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await cloudClient().from('moa_forms').select('form_id,payload,updated_at,deleted_at').eq('user_id', owner).order('form_id').range(offset, offset + 999);
    if (error) throw new Error(`양식 불러오기 실패: ${error.message}`);
    if (activeUser() !== owner || epoch !== sequence) throw new Error('사용자가 변경되었습니다.');
    rows.push(...(data ?? []) as Row[]);
    if (!data || data.length < 1000) break;
  }
  if (activeUser() !== owner || epoch !== sequence) throw new Error('사용자가 변경되었습니다.');
  const meta = readMeta();
  const ids = new Set(rows.map(r => r.form_id));
  const prefix = scopedStorageKey(PREFIX);
  const keys = Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i)).filter((k): k is string => k !== null);
  for (const key of keys) {
    if (key.startsWith(prefix) && !ids.has(key.slice(prefix.length)) && !meta.pending[key.slice(prefix.length)]) localStorage.removeItem(key);
  }
  for (const row of rows) {
    const pending = meta.pending[row.form_id];
    if (!pending) { cacheRow(row); meta.versions[row.form_id] = row.updated_at; }
    else if (pending.base !== row.updated_at) pending.conflict = true;
  }
  for (const [id, p] of Object.entries(meta.pending)) {
    if (!ids.has(id) && p.base !== null) p.conflict = true;
    if (p.payload) localStorage.setItem(scopedStorageKey(PREFIX + id), JSON.stringify(p.payload));
    else localStorage.removeItem(scopedStorageKey(PREFIX + id));
  }
  persist(meta); report(meta, Object.values(meta.pending).some(p => p.conflict) ? '다른 기기의 변경과 충돌했습니다. 로컬 수정은 보존되며 서버를 덮어쓰지 않습니다.' : '');
  void flushForms();
}
export async function flushForms(): Promise<void> {
  if (!cloudEnabled || !activeUser()) return;
  if (running) return running;
  const owner = requireUser();
  const epoch = sequence;
  const work = async () => {
    try {
      let meta = readMeta();
      for (const [id, pending] of Object.entries(meta.pending)) {
        if (pending.conflict || activeUser() !== owner || epoch !== sequence) continue;
        const updatedAt = new Date(Math.max(Date.now(), Date.parse(pending.base ?? '') + 1 || 0)).toISOString();
        const row = { user_id: owner, form_id: id, ...(pending.payload ? { payload: pending.payload } : pending.base === null ? { payload: pending.deletedPayload } : {}), updated_at: updatedAt, deleted_at: pending.payload ? null : updatedAt };
        // Compare-and-swap prevents quietly overwriting another device, including tombstones.
        const result = pending.base === null
          ? await cloudClient().from('moa_forms').insert(row).select('updated_at')
          : await cloudClient().from('moa_forms').update(row).eq('user_id', owner).eq('form_id', id).eq('updated_at', pending.base).select('updated_at');
        if (activeUser() !== owner || epoch !== sequence) return;
        meta = readMeta();
        if (result.error || !result.data?.length) {
          const conflict = result.error?.code === '23505' || (!result.error && !result.data?.length);
          if (conflict && meta.pending[id]) meta.pending[id].conflict = true;
          persist(meta);
          report(meta, conflict ? '다른 기기의 변경과 충돌했습니다. 로컬 수정만 보존되었습니다.' : `클라우드 저장 실패 · 이 기기에만 저장됨: ${result.error?.message ?? '알 수 없는 오류'}`);
          if (!conflict) return;
        } else {
          meta.versions[id] = result.data[0].updated_at;
          // A local edit made during the request must remain queued against the new version.
          if (JSON.stringify(meta.pending[id]) === JSON.stringify(pending)) delete meta.pending[id];
          else if (meta.pending[id]) meta.pending[id].base = result.data[0].updated_at;
          persist(meta); report(meta, Object.values(meta.pending).some(p => p.conflict) ? '충돌한 로컬 수정이 남아 있습니다.' : '');
        }
      }
    } catch (error) {
      if (activeUser() === owner && epoch === sequence) report(readMeta(), `클라우드 저장 실패 · 이 기기에만 저장됨: ${error instanceof Error ? error.message : String(error)}`);
    }
  };
  running = work();
  const current = running;
  try { await current; } finally {
    if (running === current) {
      running = undefined;
      // Edits arriving during an in-flight request get a second pass, but failures do not spin.
      if (activeUser() === owner && !status.message && status.pending) timer = setTimeout(() => { void flushForms(); }, 400);
    }
  }
}
/** Explicit user action only: discard queued local changes and reload remote state. */
export async function discardLocalChanges(): Promise<void> {
  if (running) throw new Error('저장 처리 중입니다. 잠시 후 다시 시도하세요.');
  const meta = readMeta(); meta.pending = {}; persist(meta); await hydrateForms();
}
