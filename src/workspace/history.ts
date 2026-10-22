import type { Layout } from '@contract/schema';
import { activeUser, cloudClient, cloudEnabled, requireUser, scopedStorageKey } from '../cloud/runtime';

/**
 * 취합 기록 (내 업무공간의 취합 이력·달력 ✓ 표시).
 * 요약만 남긴다 — 결과 엑셀·받은 회신 파일은 어디에도 저장하지 않는다 (docs/deployment.md).
 * 이 기기 브라우저에 먼저 쓰고, 온라인 모드면 Neon moa_aggregations에도 올린다.
 */
export interface AggregationSummary {
  formId: string;
  formVersion: number;
  title: string;
  layout: Layout;
  unit: string;              // 제출처를 부르는 말 (지사·부서·담당자… / 식별 안 함이면 '파일')
  total: number | null;      // 제출처 목록 수. 목록이 없으면 null
  got: number;               // 취합에 넣은 제출 수
  missing: string[];         // 목록에 있는데 안 낸 곳
  rows: number;              // 모은 줄 수
  checked: number;           // 확인한 칸 수
  verifyOk: boolean;         // 검산 일치
}
export interface AggregationRecord extends AggregationSummary {
  id: string;
  doneAt: string;            // ISO 8601
  synced?: boolean;          // 온라인 모드에서 서버에 올렸는지
}

const KEY = 'hanan-moa:aggregations';
const KEEP = 300;

function readLocal(): AggregationRecord[] {
  try {
    const raw = localStorage.getItem(scopedStorageKey(KEY));
    return raw ? (JSON.parse(raw) as AggregationRecord[]) : [];
  } catch { return []; }
}
function writeLocal(list: AggregationRecord[]): void {
  try { localStorage.setItem(scopedStorageKey(KEY), JSON.stringify(sortNew(list).slice(0, KEEP))); } catch { /* 저장 못 해도 취합은 끝난 것 */ }
}
const sortNew = (list: AggregationRecord[]) => [...list].sort((a, b) => b.doneAt.localeCompare(a.doneAt));

/** 이 기기에 남은 기록 (최근 순) */
export function listLocalAggregations(): AggregationRecord[] { return sortNew(readLocal()); }

/** 취합을 마치고 결과 파일을 내려받은 뒤 부른다. 실패해도 취합 화면은 그대로 끝난다 */
export function recordAggregation(summary: AggregationSummary, now: Date): AggregationRecord {
  const rec: AggregationRecord = { ...summary, id: crypto.randomUUID(), doneAt: now.toISOString(), synced: !cloudEnabled };
  writeLocal([rec, ...readLocal()]);
  if (cloudEnabled) void pushPending().catch(() => { /* 다음에 업무공간을 열 때 다시 올린다 */ });
  return rec;
}

interface Row { id: string; form_id: string; done_at: string; summary: AggregationSummary }

async function pushPending(): Promise<void> {
  const owner = requireUser();
  for (const rec of readLocal().filter((r) => !r.synced)) {
    const { synced: _s, id, doneAt, ...summary } = rec;
    const { error } = await cloudClient().from('moa_aggregations').insert({ id, user_id: owner, form_id: rec.formId, done_at: doneAt, summary });
    if (activeUser() !== owner) return;
    if (error && error.code !== '23505') throw new Error(error.message);   // 23505 = 이미 올라감
    writeLocal(readLocal().map((r) => (r.id === id ? { ...r, synced: true } : r)));
  }
}

/** 업무공간을 열 때: 못 올린 기록을 올리고, 서버 기록으로 이 기기 목록을 맞춘다 (다른 PC에서 한 취합도 보이게) */
export async function loadAggregations(): Promise<{ list: AggregationRecord[]; error?: string }> {
  if (!cloudEnabled) return { list: listLocalAggregations() };
  const owner = requireUser();
  try {
    await pushPending();
    const { data, error } = await cloudClient().from('moa_aggregations').select('id,form_id,done_at,summary')
      .eq('user_id', owner).order('done_at', { ascending: false }).range(0, KEEP - 1);
    if (error) throw new Error(error.message);
    if (activeUser() !== owner) throw new Error('사용자가 변경되었습니다.');
    const remote = ((data ?? []) as Row[]).map((r) => ({ ...r.summary, formId: r.form_id, id: r.id, doneAt: r.done_at, synced: true }));
    const unsent = readLocal().filter((r) => !r.synced && !remote.some((x) => x.id === r.id));
    const list = sortNew([...unsent, ...remote]);
    writeLocal(list);
    return { list };
  } catch (e) {
    return { list: listLocalAggregations(), error: `취합 기록을 서버에서 불러오지 못했어요 · 이 기기 기록만 보여요 (${(e as Error).message})` };
  }
}
