import { authMessage, passwordProblem } from '../AccountPage';
vi.mock('../../cloud', () => ({ cloudFetch: vi.fn(), nativeAuth: vi.fn() }));
describe('내 계정 도우미', () => {
  it('비밀번호 규칙', () => {
    expect(passwordProblem('short', 'short')).toMatch(/8자/);
    expect(passwordProblem('longenough1', 'different1')).toMatch(/서로 달라요/);
    expect(passwordProblem('longenough1', 'longenough1')).toBe('');
  });
  it('인증 오류를 쉬운 한국어로', () => {
    expect(authMessage({ code: 'INVALID_PASSWORD' })).toBe('현재 비밀번호가 맞지 않아요.');
    expect(authMessage({ code: 'INVALID_OTP' })).toMatch(/코드가 맞지/);
    expect(authMessage({ message: 'OTP expired' })).toMatch(/만료/);
    expect(authMessage({ status: 429 })).toMatch(/너무 많아요/);
  });
});
