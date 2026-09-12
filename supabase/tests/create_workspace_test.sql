begin;
select plan(5);

insert into auth.users (id, email)
values ('33333333-3333-3333-3333-333333333333', 'carol@example.com');

update public.entitlements set max_workspaces = 2
where user_id = '33333333-3333-3333-3333-333333333333';

set local role authenticated;
set local "request.jwt.claim.sub" to '33333333-3333-3333-3333-333333333333';

-- Under the limit: succeeds and is attributed to the caller, not a
-- client-supplied user_id.
select isnt(
  (select (create_workspace('Research', '[]'::jsonb)).id),
  null,
  'create_workspace succeeds under the limit and returns the new row'
);

select is(
  (select user_id::text from public.workspaces where name = 'Research'),
  '33333333-3333-3333-3333-333333333333',
  'the created workspace is owned by the caller (auth.uid()), via security invoker + RLS'
);

-- Fill the remaining slot.
select create_workspace('Second workspace', '[]'::jsonb);

select is(
  (select count(*) from public.workspaces where user_id = '33333333-3333-3333-3333-333333333333'),
  2::bigint,
  'caller now has exactly max_workspaces (2) workspaces'
);

-- At the limit: the third call is rejected, and no row is inserted.
select throws_ok(
  $$ select create_workspace('One too many', '[]'::jsonb) $$,
  'workspace limit reached',
  'create_workspace rejects a call once the caller is at their entitlement limit'
);

select is(
  (select count(*) from public.workspaces where user_id = '33333333-3333-3333-3333-333333333333'),
  2::bigint,
  'the rejected call did not insert a row — still exactly 2'
);

select * from finish();
rollback;
