-- Apply manually after review. No migrations are run by the application.
-- Requires Neon Auth + Data API enabled, with auth.user_id() and authenticated role.
-- DATABASE_URL must use the migration/table-owner role, never expose it to browsers.
create schema if not exists moa_private;
revoke all on schema moa_private from public,anonymous,authenticated;
create table moa_private.moa_allowed_users (
  email text primary key check(email=lower(btrim(email)) and length(email) between 3 and 254),
  user_id uuid unique references neon_auth."user"(id) on delete set null,
  enabled boolean not null default false,
  updated_at timestamptz not null default now()
);
alter table moa_private.moa_allowed_users enable row level security;
revoke all on moa_private.moa_allowed_users from public,anonymous,authenticated;
-- No initial account is seeded. Review the verified signup account before provisioning.
create or replace function public.moa_is_allowed() returns boolean
language sql stable security definer set search_path=pg_catalog as $allowed$
  select exists (
    select 1 from neon_auth."user" u
    join moa_private.moa_allowed_users a on a.email=lower(btrim(u.email))
    where u.id::text=(select auth.user_id()) and u."emailVerified" is true
      and coalesce(to_jsonb(u)->>'banned','false')='false'
      and a.enabled is true and (a.user_id is null or a.user_id=u.id)
  )
$allowed$;
revoke all on function public.moa_is_allowed() from public,anonymous,authenticated;
grant execute on function public.moa_is_allowed() to authenticated;
grant usage on schema public to authenticated;
create table public.moa_forms (
  user_id uuid not null references neon_auth."user"(id) on delete cascade,
  form_id text not null check (length(form_id) between 1 and 128),
  payload jsonb not null check (jsonb_typeof(payload)='object' and octet_length(payload::text)<=524288),
  updated_at timestamptz not null default now(), deleted_at timestamptz,
  primary key(user_id,form_id)
);
create table public.moa_chat_drafts (
  user_id uuid primary key references neon_auth."user"(id) on delete cascade,
  payload jsonb not null check (jsonb_typeof(payload)='object' and octet_length(payload::text)<=524288),
  updated_at timestamptz not null default now()
);
alter table public.moa_forms enable row level security;
alter table public.moa_chat_drafts enable row level security;
create policy moa_forms_owner on public.moa_forms for all to authenticated using ((select public.moa_is_allowed()) and (select auth.user_id())=user_id::text) with check ((select public.moa_is_allowed()) and (select auth.user_id())=user_id::text);
create policy moa_drafts_owner on public.moa_chat_drafts for all to authenticated using ((select public.moa_is_allowed()) and (select auth.user_id())=user_id::text) with check ((select public.moa_is_allowed()) and (select auth.user_id())=user_id::text);
revoke all on public.moa_forms,public.moa_chat_drafts from public,anonymous,authenticated;
grant select,insert,update,delete on public.moa_forms,public.moa_chat_drafts to authenticated;
create index moa_forms_updated on public.moa_forms(user_id,updated_at desc);
create table public.moa_ai_chats (
  id uuid primary key, user_id uuid not null references neon_auth."user"(id) on delete cascade,
  conversation jsonb not null default '[]' check(jsonb_typeof(conversation)='array' and octet_length(conversation::text)<=131072),
  form jsonb check (form is null or (jsonb_typeof(form)='object' and octet_length(form::text)<=262144)),
  updated_at timestamptz not null default now(), lease_id uuid, lease_until timestamptz
);
alter table public.moa_ai_chats enable row level security;
create policy moa_ai_owner_read on public.moa_ai_chats for select to authenticated using ((select public.moa_is_allowed()) and (select auth.user_id())=user_id::text);
revoke all on public.moa_ai_chats from public,anonymous,authenticated;
grant select on public.moa_ai_chats to authenticated;
create index moa_ai_updated on public.moa_ai_chats(user_id,updated_at desc);
create table moa_private.moa_ai_usage(day date not null, scope text not null, used integer not null default 0 check(used>=0), primary key(day,scope));
create table moa_private.moa_ai_leases(user_id uuid primary key references neon_auth."user"(id) on delete cascade, lease_id uuid not null, lease_until timestamptz not null);
alter table moa_private.moa_ai_usage enable row level security;
alter table moa_private.moa_ai_leases enable row level security;
revoke all on moa_private.moa_ai_usage,moa_private.moa_ai_leases from public,anonymous,authenticated;
create or replace function moa_private.moa_ai_reserve(p_user uuid,p_chat uuid,p_lease uuid,p_user_limit integer,p_global_limit integer) returns boolean
language plpgsql security definer set search_path = pg_catalog as $$
declare d date := (now() at time zone 'UTC')::date; g integer; user_used integer; owner_id uuid;
begin
  if p_user is null or p_chat is null or p_lease is null or p_user_limit is null or p_global_limit is null or p_user_limit not between 1 and 10000 or p_global_limit not between 1 and 10000 then return false; end if;
  if not exists(select 1 from neon_auth."user" u join moa_private.moa_allowed_users a on a.email=lower(btrim(u.email)) where u.id=p_user and u."emailVerified" is true and coalesce(to_jsonb(u)->>'banned','false')='false' and a.enabled is true and (a.user_id is null or a.user_id=u.id)) then return false; end if;
  -- One global lock serializes day-boundary reservations, quota, and per-user leases.
  perform pg_catalog.pg_advisory_xact_lock(701244001);
  select user_id into owner_id from public.moa_ai_chats where id=p_chat;
  if owner_id is not null and owner_id<>p_user then return false; end if;
  if exists(select 1 from moa_private.moa_ai_leases where user_id=p_user and lease_until>now()) then return false; end if;
  if exists(select 1 from public.moa_ai_chats where id=p_chat and lease_until>now()) then return false; end if;
  insert into moa_private.moa_ai_usage(day,scope) values(d,'global'),(d,p_user::text) on conflict do nothing;
  select used into g from moa_private.moa_ai_usage where day=d and scope='global';
  select used into user_used from moa_private.moa_ai_usage where day=d and scope=p_user::text;
  if g>=p_global_limit or user_used>=p_user_limit then return false; end if;
  update moa_private.moa_ai_usage set used=used+1 where day=d and scope in ('global',p_user::text);
  insert into moa_private.moa_ai_leases(user_id,lease_id,lease_until) values(p_user,p_lease,now()+interval '90 seconds') on conflict(user_id) do update set lease_id=excluded.lease_id,lease_until=excluded.lease_until;
  insert into public.moa_ai_chats(id,user_id,lease_id,lease_until) values(p_chat,p_user,p_lease,now()+interval '90 seconds') on conflict(id) do update set lease_id=excluded.lease_id,lease_until=excluded.lease_until;
  return true;
end $$;
create or replace function moa_private.moa_ai_finish(p_user uuid,p_chat uuid,p_lease uuid,p_conversation jsonb,p_form jsonb) returns boolean
language plpgsql security definer set search_path = pg_catalog as $$
begin
  perform pg_catalog.pg_advisory_xact_lock(701244001);
  if not exists(select 1 from public.moa_ai_chats where id=p_chat and user_id=p_user and lease_id=p_lease and lease_until>now()) then return false; end if;
  if not exists(select 1 from moa_private.moa_ai_leases where user_id=p_user and lease_id=p_lease and lease_until>now()) then return false; end if;
  update public.moa_ai_chats set conversation=coalesce(p_conversation,conversation),form=case when p_conversation is null then form else p_form end,updated_at=now(),lease_id=null,lease_until=null where id=p_chat and user_id=p_user;
  delete from moa_private.moa_ai_leases where user_id=p_user and lease_id=p_lease;
  return true;
end $$;
revoke all on function moa_private.moa_ai_reserve(uuid,uuid,uuid,integer,integer) from public,anonymous,authenticated;
revoke all on function moa_private.moa_ai_finish(uuid,uuid,uuid,jsonb,jsonb) from public,anonymous,authenticated;
