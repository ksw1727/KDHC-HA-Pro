# Neon 클라우드 클라이언트

## 실행 설정

- 클라우드 활성화: `VITE_CLOUD_MODE=true`, `VITE_NEON_DATA_API_URL`.
- 로컬 `npm run dev`는 클라우드 모드를 지정하지 않으면 기존 로컬 저장 방식 그대로 동작한다.
- 인증 SDK URL은 항상 `window.location.origin + '/api/auth'`이다. 프록시가 준비되지 않으면 인증은 실패하며 앱을 열지 않는다. 브라우저는 `credentials: 'include'`로 1st-party 쿠키를 사용한다.
- `VITE_NEON_AUTH_URL`은 사용하지 않는다. upstream `NEON_AUTH_BASE_URL` 및 JWT 검증 설정은 서버 전용이다. DB 연결 문자열이나 AI 키를 VITE 환경변수에 넣지 않는다.
- Data API와 Auth는 별개 서비스다. 설치 SDK `@neondatabase/neon-js@0.9.0-beta`의 `createClient({auth:{url,adapter:SupabaseAuthAdapter(...)},dataApi:{url}})` 타입을 직접 확인했다. 어댑터 이름만 Supabase 호환이며 Supabase 서비스/SDK는 사용하지 않는다.

## 공개 API (`src/cloud/index.ts`)

- `cloudEnabled: boolean`
- `CloudGate`: 서버 세션, 인증된 이메일, 허용목록을 확인하고 해당 사용자 원격 양식으로 로컬 캐시를 채운 뒤 앱을 마운트한다. 사용자가 바뀌면 작업 화면을 언마운트한다.
- `cloudFetch(url, init?)`: 로컬 모드에서는 fetch 그대로다. 클라우드에서는 같은 사이트 URL만 허용하고 JWT Bearer를 붙인다. 401/403과 인증 누락을 오류로 던지며, 다른 HTTP 상태는 fetch와 같다. 외부 리다이렉트로 인증 토큰이 전달되지 않도록 리다이렉트도 거부한다.
- `scopedStorageKey(key)`: 로컬에서는 기존 키 그대로, 클라우드에서는 인증 사용자별 키를 반환한다. 미인증이면 오류다. AI 대화/엔진 등 모든 로컬 키에 적용하고 익명 키로 대체해서 읽지 않는다.
- `readCloudChat(): Promise<unknown|null>`: 사용자 대화 초안 JSON과 서버 타임스탬프를 읽는다. 쓰기 전에 호출해야 한다.
- `writeCloudChat(payload): Promise<void>`: 타임스탬프 비교 후 저장한다. UI는 debounce/직렬화하고 실패 시 로컬 대화를 유지하며 저장 상태를 표시해야 한다. 동시 쓰기와 다른 기기 충돌은 명확한 오류다. 충돌 후에는 사용자의 명시적 선택으로 서버 초안을 다시 읽어야 한다. 로컬 모드에서 읽기는 null, 쓰기는 아무 작업도 하지 않는다.

AI 서버 히스토리는 별도 테이블이며 이 모듈에서 쓰지 않는다. AiPage 연결은 부모 작업 범위다.

## 인증과 계정 API

1. SDK 구독 및 getSession으로 로그인 상태를 관찰한다.
2. 네이티브 BetterAuth getSession에 `disableCookieCache`와 `X-Force-Fetch`를 지정해 조회하고 `emailVerified`를 확인한다.
3. 네이티브 `.token()`에서 JWT를 받는다. 어댑터의 session.access_token이 항상 JWT라고 가정하지 않는다.
4. `GET /api/account`에 JWT Bearer를 보낸다. 응답은 `{id,email,emailVerified:true,approved:true}`이며 현재 세션과 id/email이 같아야 한다. 401/403, 누락, 잘못된 응답은 모두 fail-closed다.
5. 사용자 namespace를 설정한 후 Data API에서 양식을 가져온다. 초기 양식 조회도 실패하면 앱을 열지 않는다.

로그인 화면은 `LoginScreen.tsx`(시안 A, `docs/mockups/login-mockups.html`). 기본은 아이디(이메일)·비밀번호 `signInWithPassword`. [비밀번호를 잊었어요]는 네이티브 email-otp로: `sendVerificationOtp({type:'forget-password'})` → `checkVerificationOtp`(코드만 확인, 쓰지 않음) → `emailOtp.resetPassword({email,otp,password})` → 새 비밀번호로 `signInWithPassword`. reset-password는 이메일 인증도 함께 끝낸다. 로그인 뒤 `verifyCloudAccount`가 막으면 문구로 화면을 고른다: 이메일 인증 필요 → `emailOtp.verifyEmail`, 허용목록 밖 → 승인 요청 안내. 비밀번호 설정은 미지원 `updateUser({password})`를 호출하지 않는다. 예전 재설정 메일 링크(URL `token`)는 `resetPassword({newPassword,token})`로 계속 받고, 성공하면 URL에서 token을 지운다. Supabase의 hash `type=invite/recovery`나 조직 초대 수락 흐름은 사용하지 않는다.

## 양식 저장

기존 동기 `saveForm/loadForm/loadCurrent/listForms/removeForm` API와 반환 타입을 유지한다. saveForm의 true는 로컬 캐시와 영속 대기열에 기록했다는 뜻이지 서버 저장 완료가 아니다. CloudGate가 미동기화 건수, 로컬전용 상태, 오류, 충돌을 표시한다.

- 사용자별 영속 대기열과 debounce 저장, 네트워크 복귀 시 재시도를 지원한다.
- 익명 양식이나 다른 사용자 캐시는 읽거나 자동 업로드하지 않는다.
- 원격 양식은 로그인 시 1000행씩 정렬 조회하며 모두 로드한 뒤 캐시를 갱신한다.
- 수정은 마지막 원격 updated_at에 대한 비교 후 저장, 신규는 insert, 삭제는 tombstone으로 저장한다. 다른 기기의 수정/삭제를 조용히 덮어쓰지 않는다.
- 서버와 주고받는 저장·불러오기는 `navigator.locks`(사용자별 잠금)로 한 탭씩만 한다. 탭 여럿이 같은 대기열을 동시에 올려 생기던 가짜 충돌을 막는다.
- 충돌로 보이면 서버 행을 다시 읽어, 내용이 같으면(키 순서 무시) 충돌 없이 정리한다. 불러오기 때도 남은 충돌을 같은 기준으로 지운다.
- 충돌한 로컬 수정은 유지하고 서버 저장을 막는다. 경고 띠에 충돌한 양식 이름(`syncStatus().conflicted`)을 보여주고, 다시 올릴 수 있는 수정이 없으면 [저장 재시도]는 숨긴다. 사용자가 확인한 경우에만 모든 미동기화 양식 수정을 버리고 서버를 다시 읽을 수 있다.
- 실시간 구독/주기적 원격 조회는 없다. 다른 기기의 최신 양식은 다시 로그인하거나 명시적으로 서버를 다시 불러와 확인한다. 오래된 양식을 저장하면 충돌로 알린다.
- DB의 user_id는 text이다. 조회/저장 사용자 id는 SDK 세션에서만 가져온다.

## 배포 보안과 검증 한계

- Neon managed Auth는 이 UI에 가입 버튼이 없어도 외부에서 signup이 가능하다. 계정 생성 성공이 앱 사용 승인이 아니다. 서버 API와 Data API RLS 모두 인증된 이메일과 활성 허용목록을 확인해야 한다. 브라우저 gate만으로 접근을 통제하면 안 된다.
- 서버 API는 JWKS로 JWT를 검증하고 현재 이메일 인증/ban/허용목록을 확인해야 한다. 초기 관리자 이메일 승인과 DB 초기화는 서버/운영 작업이다.
- RLS는 `auth.user_id()=user_id AND public.moa_is_allowed()`를 적용한다. 브라우저는 private 허용목록 테이블을 직접 조회하지 않는다.
- `/api/auth` 프록시는 경로, Set-Cookie의 Domain/Path와 first-party 쿠키 속성, 응답의 `set-auth-jwt`, Origin/redirect URL을 정확히 처리해야 한다. Neon의 신뢰 origin 및 재설정 메일 redirect 설정도 필요하다. 캐시되지 않도록 구성한다.
- SDK 세션은 쿠키/메모리를 사용하고 사용자별 양식/대화 로컬 캐시는 브라우저에 남는다. 로그아웃은 로컬 초안/대기열을 삭제하지 않는다. namespace는 암호화나 같은 브라우저 프로필 사용자 간 보안 경계가 아니다. 공유 PC에서는 별도 브라우저 프로필과 사이트 데이터 정리가 필요하다. XSS 방어도 별도 필수다.
- 초기 인증/권한 확인/원격 캐시 조회는 네트워크가 필요하다. 오프라인 인증 우회는 없다.
- 모든 외부 writer도 변경 시 updated_at을 반드시 증가시켜야 타임스탬프 충돌 방지가 유지된다.
- 테스트는 클라이언트 모의 검증이다. 운영 전 실제 first-party 쿠키 로그인, 인증메일/비밀번호 재설정, 허용되지 않은 계정 차단, RLS, 두 기기의 충돌/삭제 동기화를 점검해야 한다.
