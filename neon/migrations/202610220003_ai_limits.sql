-- AI 사용 한도를 관리자 페이지에서 정한다 (기본: 모두 무제한, 관리자는 무제한)
--  - 전체 하루 한도, 사용자 기본 하루 한도: moa_private.moa_ai_settings (빈 값 = 무제한)
--  - 사용자별 하루 한도: moa_allowed_users.ai_daily_limit (빈 값 = 기본 한도 따름)
--  - 관리자: 사용자별 한도를 따로 정하지 않으면 전체·기본 한도 모두 적용하지 않음
-- 이전 환경변수(AI_DAILY_USER_LIMIT, AI_DAILY_GLOBAL_LIMIT) 방식은 쓰지 않는다.
begin;
create table if not exists moa_private.moa_ai_settings (
  id boolean primary key default true check (id),
  global_daily_limit integer check (global_daily_limit is null or global_daily_limit between 0 and 100000),
  default_user_daily_limit integer check (default_user_daily_limit is null or default_user_daily_limit between 0 and 100000),
  updated_at timestamptz not null default now()
);
insert into moa_private.moa_ai_settings(id) values (true) on conflict do nothing;
alter table moa_private.moa_ai_settings enable row level security;
revoke all on moa_private.moa_ai_settings from public, anonymous, authenticated;

alter table moa_private.moa_allowed_users add column if not exists ai_daily_limit integer
  check (ai_daily_limit is null or ai_daily_limit between 0 and 100000);

drop function if exists moa_private.moa_ai_reserve(uuid,uuid,uuid,integer,integer);
-- 결과: 'ok' | 'denied'(승인·소유권) | 'busy'(진행 중인 요청) | 'user_limit' | 'global_limit'
create or replace function moa_private.moa_ai_reserve(p_user uuid, p_chat uuid, p_lease uuid) returns text
language plpgsql security definer set search_path = pg_catalog as $$
declare d date := (now() at time zone 'UTC')::date; g integer; user_used integer; owner_id uuid;
  is_admin boolean; own_limit integer; user_limit integer; global_limit integer;
begin
  if p_user is null or p_chat is null or p_lease is null then return 'denied'; end if;
  select a.is_admin, a.ai_daily_limit into is_admin, own_limit
    from neon_auth."user" u join moa_private.moa_allowed_users a on a.email = lower(btrim(u.email))
    where u.id = p_user and u."emailVerified" is true and coalesce(to_jsonb(u)->>'banned','false') = 'false'
      and a.enabled is true and (a.user_id is null or a.user_id = u.id);
  if not found then return 'denied'; end if;
  -- 하나의 잠금으로 날짜 경계·사용량·동시 실행을 직렬화한다
  perform pg_catalog.pg_advisory_xact_lock(701244001);
  select user_id into owner_id from public.moa_ai_chats where id = p_chat;
  if owner_id is not null and owner_id <> p_user then return 'denied'; end if;
  if exists(select 1 from moa_private.moa_ai_leases where user_id = p_user and lease_until > now()) then return 'busy'; end if;
  if exists(select 1 from public.moa_ai_chats where id = p_chat and lease_until > now()) then return 'busy'; end if;
  select s.default_user_daily_limit, s.global_daily_limit into user_limit, global_limit from moa_private.moa_ai_settings s where s.id;
  if own_limit is not null then user_limit := own_limit;
  elsif is_admin then user_limit := null; global_limit := null;   -- 관리자 기본: 무제한
  end if;
  insert into moa_private.moa_ai_usage(day, scope) values (d, 'global'), (d, p_user::text) on conflict do nothing;
  select used into g from moa_private.moa_ai_usage where day = d and scope = 'global';
  select used into user_used from moa_private.moa_ai_usage where day = d and scope = p_user::text;
  if user_limit is not null and user_used >= user_limit then return 'user_limit'; end if;
  if global_limit is not null and g >= global_limit then return 'global_limit'; end if;
  update moa_private.moa_ai_usage set used = used + 1 where day = d and scope in ('global', p_user::text);
  insert into moa_private.moa_ai_leases(user_id, lease_id, lease_until) values (p_user, p_lease, now() + interval '90 seconds')
    on conflict (user_id) do update set lease_id = excluded.lease_id, lease_until = excluded.lease_until;
  insert into public.moa_ai_chats(id, user_id, lease_id, lease_until) values (p_chat, p_user, p_lease, now() + interval '90 seconds')
    on conflict (id) do update set lease_id = excluded.lease_id, lease_until = excluded.lease_until;
  return 'ok';
end $$;
revoke all on function moa_private.moa_ai_reserve(uuid,uuid,uuid) from public, anonymous, authenticated;
commit;
