-- AI로 만들기 대화 보관함: 화면 대화(말풍선·양식 카드)를 대화마다 한 줄씩 남긴다.
-- form_ids로 "이 양식을 만든 대화"를 찾아, 내 업무공간 일정·양식에서 열면 그 대화와 미리보기를 다시 보여 준다.
-- 지금 대화(moa_chat_drafts)는 그대로 쓰고, 이 표는 보관·찾기용이다. 202610220001_cloud_ai.sql 다음에 적용한다 (moa_is_allowed 필요).
begin;
create table public.moa_chat_threads (
  user_id uuid not null references neon_auth."user"(id) on delete cascade,
  thread_id uuid not null,
  title text not null default '' check (length(title) <= 200),
  form_ids text[] not null default '{}' check (cardinality(form_ids) <= 200),
  payload jsonb not null check (jsonb_typeof(payload)='object' and octet_length(payload::text)<=524288),
  updated_at timestamptz not null default now(),
  primary key (user_id, thread_id)
);
alter table public.moa_chat_threads enable row level security;
create policy moa_chat_threads_owner on public.moa_chat_threads for all to authenticated
  using ((select public.moa_is_allowed()) and (select auth.user_id())=user_id::text)
  with check ((select public.moa_is_allowed()) and (select auth.user_id())=user_id::text);
revoke all on public.moa_chat_threads from public,anonymous,authenticated;
grant select,insert,update,delete on public.moa_chat_threads to authenticated;
create index moa_chat_threads_updated on public.moa_chat_threads(user_id,updated_at desc);
create index moa_chat_threads_forms on public.moa_chat_threads using gin(form_ids);
commit;
