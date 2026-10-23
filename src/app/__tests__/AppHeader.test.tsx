import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
const m = vi.hoisted(() => ({ session: null as null | { email: string; status: string; busy: boolean; signOut: () => void } }));
vi.mock('../../cloud', () => ({ useCloudSession: () => m.session }));
import { AppHeader } from '../AppHeader';

describe('머리줄: 계정·관리자는 오른쪽 위 둥근 아이콘', () => {
  it('주요 탭은 셋, 슬로건도 한 줄에, 관리자 아이콘은 관리자에게만, 프로필은 로그인했을 때만', () => {
    m.session = null;
    const { rerender } = render(<AppHeader tab="home" setTab={() => {}} admin={false} />);
    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual(['내 업무공간', 'AI로 만들기', '취합하기']);
    expect(screen.getByRole('img', { name: '깨끗한 에너지로 세상을 따뜻하게' })).toBeTruthy();
    m.session = { email: 'ksw1727@gmail.com', status: '클라우드 동기화 준비됨', busy: false, signOut: vi.fn() };
    rerender(<AppHeader tab="home" setTab={() => {}} admin />);
    expect(screen.getByRole('button', { name: '관리자' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '내 계정 메뉴' }).textContent).toContain('K');
  });
  it('프로필 메뉴에서 내 계정·관리자·로그아웃', () => {
    const setTab = vi.fn(), signOut = vi.fn();
    m.session = { email: 'ksw1727@gmail.com', status: '클라우드 동기화 준비됨', busy: false, signOut };
    render(<AppHeader tab="home" setTab={setTab} admin />);
    fireEvent.click(screen.getByRole('button', { name: '내 계정 메뉴' }));
    expect(screen.getByRole('menu').textContent).toContain('ksw1727@gmail.com');
    fireEvent.click(screen.getByRole('menuitem', { name: '내 계정' }));
    expect(setTab).toHaveBeenCalledWith('account');
    fireEvent.click(screen.getByRole('button', { name: '내 계정 메뉴' }));
    fireEvent.click(screen.getByRole('menuitem', { name: '로그아웃' }));
    expect(signOut).toHaveBeenCalled();
  });
});
