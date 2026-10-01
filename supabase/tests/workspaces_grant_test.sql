begin;
select plan(4);

-- Every existing workspaces test (create_workspace_test.sql) goes through
-- the create_workspace RPC, which is `security definer` and so never
-- needed a table-level grant to work — it runs as the function's owner,
-- not the caller's role. That's exactly how a missing `grant ... to
-- authenticated` on workspaces (fixed in
-- 20260930190000_grant_table_privileges.sql) went unnoticed: nothing here
-- plain-selected or plain-inserted as `authenticated` until now.

insert into auth.users (id, email)
values ('77777777-7777-7777-7777-777777777777', 'frank@example.com');

set local role authenticated;
set local "request.jwt.claim.sub" to '77777777-7777-7777-7777-777777777777';

select lives_ok(
  $$ select * from public.workspaces $$,
  'authenticated can plain-select from workspaces (base grant exists; RLS alone decides which rows)'
);

select lives_ok(
  $$ insert into public.workspaces (user_id, name)
     values ('77777777-7777-7777-7777-777777777777', 'Direct insert') $$,
  'authenticated can plain-insert into workspaces (RLS with check passes for own user_id)'
);

select is(
  (select count(*) from public.workspaces where user_id = '77777777-7777-7777-7777-777777777777'),
  1::bigint,
  'the direct insert landed'
);

-- RLS still hides another user's row even with the base grant in place —
-- the grant widens *capability*, never visibility.
reset role;
insert into auth.users (id, email)
values ('88888888-8888-8888-8888-888888888888', 'grace@example.com');
insert into public.workspaces (user_id, name)
values ('88888888-8888-8888-8888-888888888888', 'Grace''s workspace');

set local role authenticated;
set local "request.jwt.claim.sub" to '77777777-7777-7777-7777-777777777777';

select is(
  (select count(*) from public.workspaces),
  1::bigint,
  'RLS still hides another user''s workspace even with the base grant in place'
);

select * from finish();
rollback;
