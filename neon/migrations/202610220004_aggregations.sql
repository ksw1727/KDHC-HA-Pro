-- 내 업무공간: 취합 기록(요약만). 결과 엑셀·받은 회신 파일은 저장하지 않는다.
-- 202610220001_cloud_ai.sql 다음에 적용한다 (적용 완료 2026-10-22) (moa_is_allowed 필요). 브라우저는 본인 행만 읽고 추가·삭제한다.
begin;
create table public.moa_aggregations (
  id uuid primary key,
  user_id uuid not null references neon_auth."user"(id) on delete cascade,
  form_id text not null check (length(form_id) between 1 and 128),
  done_at timestamptz not null,
  summary jsonb not null check (jsonb_typeof(summary)='object' and octet_length(summary::text)<=32768),
  created_at timestamptz not null default now()
);
alter table public.moa_aggregations enable row level security;
create policy moa_aggregations_owner on public.moa_aggregations for all to authenticated
  using ((select public.moa_is_allowed()) and (select auth.user_id())=user_id::text)
  with check ((select public.moa_is_allowed()) and (select auth.user_id())=user_id::text);
revoke all on public.moa_aggregations from public,anonymous,authenticated;
grant select,insert,delete on public.moa_aggregations to authenticated;
create index moa_aggregations_done on public.moa_aggregations(user_id,done_at desc);
commit;
