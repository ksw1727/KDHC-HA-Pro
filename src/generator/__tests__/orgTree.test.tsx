import { fireEvent, render, screen, within } from '@testing-library/react';
import { BuilderPage } from '../pages/BuilderPage';
import { allBranches, allHqDivisions, recommendLabel, searchVisible, sortByTree } from '../org/kdhcOrg';
import { orgSource } from '../builder/OrgPanel';

beforeEach(() => localStorage.clear());

describe('한난 조직 데이터', () => {
  test('빠른 선택: 지사 19곳, 본사 처·실·센터', () => {
    expect(allBranches()).toHaveLength(19);
    expect(allBranches()).toContain('수원사업소');
    expect(allHqDivisions()).toContain('기획처');
    expect(allHqDivisions()).not.toContain('기획부');
  });
  test('트리 순서로 정렬, 트리에 없는 이름은 뒤에', () => {
    expect(sortByTree(['협력업체', '동탄지사', '중앙지사', '기획처', '동탄지사'])).toEqual(['기획처', '중앙지사', '동탄지사', '협력업체']);
  });
  test('부르는 말 추천', () => {
    expect(recommendLabel(['중앙지사', '수원사업소'])).toBe('지사');
    expect(recommendLabel(['중앙지사', '기획처'])).toBe('부서');
    expect(recommendLabel([])).toBe('지사');
  });
  test('검색은 맞는 노드와 조상만', () => {
    const v = searchVisible('인사부')!;
    expect(v.has('경영지원처 인사부')).toBe(true);
    expect(v.has('경영지원처')).toBe(true);
    expect(v.has('재무처')).toBe(false);
    expect(searchVisible('  ')).toBeNull();
  });
  test('부르는 말로 고르는 방식 판단', () => {
    expect(orgSource('지사')).toBe('kdhc');
    expect(orgSource('부서')).toBe('kdhc');
    expect(orgSource('기관')).toBe('inst');
    expect(orgSource('팀')).toBe('custom');
    expect(orgSource('')).toBe('custom');
  });
});

describe('⑤ 제출처 트리', () => {
  const openPanel = () => {
    render(<BuilderPage />);
    fireEvent.click(screen.getByRole('button', { name: /제출처/ }));
  };

  test('한난: 지사 전체 → 19곳, 본사 부서를 더 고르면 부르는 말이 부서로', () => {
    openPanel();
    expect(screen.getByRole('radio', { name: '한난' }).getAttribute('aria-checked')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: '지사 전체' }));
    expect(screen.getByText('19곳')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('조직 검색'), { target: { value: '인사부' } });
    fireEvent.click(within(screen.getByRole('tree')).getByLabelText('인사부'));
    expect(screen.getByText('20곳')).toBeTruthy();
    expect(screen.getByRole('radio', { name: '부서' }).getAttribute('aria-checked')).toBe('true');
  });

  test('트리에 없는 곳 직접 추가, 기관으로 바꾸면 입력 목록', () => {
    openPanel();
    fireEvent.change(screen.getByLabelText('트리에 없는 제출처 이름'), { target: { value: '협력업체 A' } });
    fireEvent.click(screen.getByRole('button', { name: '추가' }));
    expect(screen.getByRole('button', { name: '협력업체 A 빼기' })).toBeTruthy();
    fireEvent.click(screen.getByRole('radio', { name: '기관' }));
    expect(screen.queryByRole('tree')).toBeNull();
    expect(screen.getAllByDisplayValue('협력업체 A').some((el) => el.tagName === 'TEXTAREA')).toBe(true);
  });
});
