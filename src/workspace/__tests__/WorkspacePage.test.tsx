import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import type { FormSchema } from '@contract/schema';
import { WorkspacePage } from '../WorkspacePage';

const put = (id: string, title: string, exported: boolean, deadline?: string) => {
  const created = new Date(Date.now() - 3 * 864e5).toISOString();
  const s = { contractVersion: 1, formId: id, formVersion: 1, title, layout: 'list', blocks: [], aggregations: [], org: { mode: 'preset', label: '부서', orgs: ['가', '나'] }, createdAt: created, updatedAt: created, deadline } as unknown as FormSchema;
  localStorage.setItem(`hanan-moa:forms:${id}`, JSON.stringify({ schema: s, savedAt: created, lastExported: exported ? s : undefined }));
};

describe('내 업무공간', () => {
  beforeEach(() => {
    localStorage.clear();
    put('w', '기다리는 양식', true);
    put('d', '쓰는 중인 양식', false);
    localStorage.setItem('hanan-moa:aggregations', JSON.stringify([{ id: '1', formId: 'old', formVersion: 1, title: '지난 취합', layout: 'list', unit: '부서', total: 2, got: 1, missing: ['나'], rows: 3, checked: 1, verifyOk: true, doneAt: new Date().toISOString() }]));
  });

  it('취합 전 양식은 제출 현황 없이 기다리는 목록에, 이력은 요약과 안 낸 곳으로', () => {
    render(<WorkspacePage />);
    const side = screen.getByRole('complementary');
    expect(side.textContent).toContain('기다리는 양식');
    expect(side.textContent).toContain('취합 전');
    expect(side.textContent).not.toContain('쓰는 중인 양식');
    expect(side.textContent).not.toMatch(/\d+\s*\/\s*2/);   // 취합 전에는 몇 곳이 냈는지 보이지 않는다
    fireEvent.click(screen.getByRole('tab', { name: /취합 이력/ }));
    expect(screen.getByText('지난 취합')).toBeTruthy();
    expect(screen.getByText('1/2')).toBeTruthy();
    expect(screen.getByText('나')).toBeTruthy();
    expect(screen.queryByText(/결과 파일/)).toBeNull();
  });

  it('카드의 [받은 파일 취합하기]는 그 양식으로 취합하기 화면을 연다', () => {
    const on = vi.fn((e: Event) => (e as CustomEvent).detail);
    window.addEventListener('hanan-moa:tab', on);
    render(<WorkspacePage />);
    fireEvent.click(within(screen.getByRole('complementary')).getByRole('button', { name: '받은 파일 취합하기' }));
    window.removeEventListener('hanan-moa:tab', on);
    expect(on.mock.results[0].value).toEqual({ tab: 'aggregator', formId: 'w' });
  });
});
