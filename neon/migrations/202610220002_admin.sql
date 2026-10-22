-- 관리자 페이지: 승인 목록에 관리자 표시를 추가하고 첫 관리자를 지정한다.
-- 관리자 여부는 서버만 읽고 바꾼다(moa_private는 브라우저 접근 불가).
begin;
alter table moa_private.moa_allowed_users add column if not exists is_admin boolean not null default false;
update moa_private.moa_allowed_users set is_admin = true, updated_at = now() where email = 'ksw1727@gmail.com';
do $$ begin
  if (select count(*) from moa_private.moa_allowed_users where is_admin and enabled) <> 1 then raise exception '관리자 지정 확인 실패'; end if;
end $$;
commit;
