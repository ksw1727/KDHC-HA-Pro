// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { ensureTitle, titleFromRequest, PLACEHOLDER_TITLE } from './ai';
import { newSchema } from '../src/generator/state/newSchema';

const form = (title: string) => { const f = newSchema('list', new Date('2026-01-01'), { formId: '0f9e6a3c-1111-4222-8333-444455556666', key: () => 'f_abcd' }); f.title = title; return f; };

describe('AI 양식 제목', () => {
  it('요청 문장에서 짧은 제목을 만든다', () => {
    expect(titleFromRequest('지사별 교육 참가자 명단을 받고 싶어요. 이름·직급·참가 희망일, 지사 전체')).toBe('지사별 교육 참가자 명단');
    expect(titleFromRequest('이름 한 칸만 받는 간단한 목록형 양식, 지사 전체')).toBe('이름 한 칸만 받는 간단한 목록형');
    expect(titleFromRequest('2027 사업예산 요구표. 사업별로 지사마다 자기 열에 요구액을 적게 해 주세요')).toBe('2027 사업예산 요구표');
    expect(titleFromRequest('(사용자가 빌더에서 form.json을 직접 고쳤어요.)\n안전점검 결과 보고')).toBe('안전점검 결과 보고');
    expect(titleFromRequest('A/B: 점검[1]?')).toBe('A B 점검 1');
    expect(titleFromRequest('가'.repeat(80))).toHaveLength(40);
  });
  it.each([PLACEHOLDER_TITLE, '새 양식', '', '  '])('임시·빈 제목(%j)이면 요청 내용으로 채운다', (t) => {
    expect(ensureTitle(form(t), '협력기관 분기별 에너지 절감 실적', null).title).toBe('협력기관 분기별 에너지 절감 실적');
  });
  it('AI가 지은 제목은 그대로 둔다', () => {
    expect(ensureTitle(form('지사별 교육 참가자 명단'), '아무 말', null).title).toBe('지사별 교육 참가자 명단');
  });
  it('고치는 중에 AI가 제목을 비우면 기존 제목을 유지한다', () => {
    expect(ensureTitle(form(PLACEHOLDER_TITLE), '교육비는 빼 주세요', form('하반기 교육 신청')).title).toBe('하반기 교육 신청');
  });
});
