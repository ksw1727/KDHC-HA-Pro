import { act, renderHook, waitFor, render, screen } from '@testing-library/react';
import { useState } from 'react';
const sdk = vi.hoisted(() => ({ read: vi.fn(), write: vi.fn(), fetch: vi.fn(), user: 'alice' }));
vi.mock('../../cloud', () => ({ cloudEnabled: true, scopedStorageKey: (k: string) => `${sdk.user}:${k}`, readCloudChat: sdk.read, writeCloudChat: sdk.write, cloudFetch: sdk.fetch }));
import { loadDraft, useCloudDraft, type Draft } from '../useCloudDraft';
import { AiPage } from '../AiPage';
const empty: Draft = { chatId: null, msgs: [], aiVersion: null };
const draft = (text: string): Draft => ({ ...empty, msgs: [{ role: 'user', text }] });
function useHarness(busy: boolean) {
  const [value, set] = useState(loadDraft);
  return { ...useCloudDraft(value, busy, set), value, set };
}
beforeEach(() => {
  localStorage.clear(); sdk.user = 'alice'; vi.clearAllMocks(); sdk.read.mockResolvedValue(null); sdk.write.mockResolvedValue(undefined);
  sdk.fetch.mockResolvedValue(new Response(JSON.stringify({ mode: 'cloud', engines: { claude: false, codex: true } })));
  Element.prototype.scrollIntoView = vi.fn();
});
describe('cloud draft synchronization', () => {
  it('namespaces cached conversations by user', () => {
    localStorage.setItem('alice:hanan-moa:ai-chat', JSON.stringify(draft('alice only')));
    expect(loadDraft().msgs).toHaveLength(1); sdk.user = 'bob'; expect(loadDraft().msgs).toHaveLength(0);
  });
  it('hydrates remote without creating a spurious local conflict or write', async () => {
    sdk.read.mockResolvedValue(draft('remote'));
    const { result } = renderHook(() => useHarness(false));
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.value).toEqual(draft('remote')); expect(result.current.conflict).toBe(false); expect(sdk.write).not.toHaveBeenCalled();
  });
  it('does not overwrite divergent unsynced local and offers an explicit choice', async () => {
    localStorage.setItem('alice:hanan-moa:ai-chat', JSON.stringify({ ...draft('local'), unsynced: true })); sdk.read.mockResolvedValue(draft('remote'));
    const { result } = renderHook(() => useHarness(false));
    await waitFor(() => expect(result.current.conflict).toBe(true)); expect(result.current.ready).toBe(false); expect(sdk.write).not.toHaveBeenCalled();
    act(() => result.current.chooseServer()); await waitFor(() => expect(result.current.ready).toBe(true)); expect(result.current.value).toEqual(draft('remote'));
  });
  it('never automatically writes after failed read', async () => {
    sdk.read.mockRejectedValue(new Error('offline')); const { result } = renderHook(() => useHarness(false));
    await waitFor(() => expect(result.current.notice).toContain('이 기기에만'));
    act(() => result.current.set(draft('pending'))); await new Promise((r) => setTimeout(r, 500)); expect(sdk.write).not.toHaveBeenCalled();
  });
  it('pauses during streaming and serializes latest-only changes and reset', async () => {
    let finish!: () => void; sdk.write.mockImplementationOnce(() => new Promise<void>((r) => { finish = r; }));
    const { result, rerender } = renderHook(({ busy }) => useHarness(busy), { initialProps: { busy: true } });
    await waitFor(() => expect(result.current.ready).toBe(true)); act(() => result.current.set(draft('stream')));
    await new Promise((r) => setTimeout(r, 500)); expect(sdk.write).not.toHaveBeenCalled(); rerender({ busy: false });
    await waitFor(() => expect(sdk.write).toHaveBeenCalledTimes(1)); act(() => result.current.set(draft('old'))); act(() => result.current.set(empty));
    await new Promise((r) => setTimeout(r, 500)); expect(sdk.write).toHaveBeenCalledTimes(1);
    await act(async () => finish()); await waitFor(() => expect(sdk.write).toHaveBeenCalledTimes(2)); expect(sdk.write.mock.calls[1][0]).toMatchObject(empty);
  });
  it('halts autosave on CAS conflict and requires another read/choice', async () => {
    sdk.write.mockRejectedValue(new Error('다른 기기에서 변경')); const { result } = renderHook(() => useHarness(false));
    await waitFor(() => expect(result.current.ready).toBe(true)); act(() => result.current.set(draft('new')));
    await waitFor(() => expect(result.current.conflict).toBe(true)); expect(result.current.ready).toBe(false); expect(result.current.notice).toContain('이 기기에만');
  });
});
describe('cloud AI page', () => {
  it('uses authenticated health and sends to the shared OpenAI (no engine or model picker online)', async () => {
    render(<AiPage />); expect(await screen.findByText(/OpenAI로 전달돼요/)).toBeTruthy();
    expect(screen.queryByRole('radio')).toBeNull(); expect(screen.queryByRole('combobox', { name: 'OpenAI 모델' })).toBeNull();
    expect(sdk.fetch).toHaveBeenCalledWith('/api/ai/health', undefined); expect(screen.queryByText(/npm run dev/)).toBeNull();
  });
  it('explains no paid AI features when neither model is configured', async () => {
    sdk.fetch.mockResolvedValue(new Response(JSON.stringify({ engines: { claude: false, codex: false } }))); render(<AiPage />);
    expect(await screen.findByText(/비용이 발생하는 AI 기능은 사용할 수 없어요/)).toBeTruthy();
    expect(screen.getByText('관리자 AI 설정이 아직 없어요')).toBeTruthy();
    expect(screen.queryByRole('textbox', { name: 'AI에게 보낼 말' })).toBeNull(); expect(screen.queryByRole('button', { name: '보내기' })).toBeNull();
  });
});
