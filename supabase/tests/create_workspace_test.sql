begin;
select plan(8);

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

-- Client-supplied id round-trips: the extension registers a workspace it
-- already created locally, so the server row must land under the same id.
reset role;

insert into auth.users (id, email)
values ('44444444-4444-4444-4444-444444444444', 'dave@example.com');

set local role authenticated;
set local "request.jwt.claim.sub" to '44444444-4444-4444-4444-444444444444';

select is(
  (select (create_workspace('Client-id workspace', '[]'::jsonb, '55555555-5555-5555-5555-555555555555'::uuid)).id::text),
  '55555555-5555-5555-5555-555555555555',
  'create_workspace uses the caller-supplied id when given one'
);

-- A lapsed access_expires_at blocks creation even though max_workspaces is
-- still generous — mirrors the Creem webhook, which only ever touches
-- access_expires_at on expiry, never claws back max_workspaces.
reset role;
update public.entitlements
set max_workspaces = 100000, access_expires_at = now() - interval '1 day'
where user_id = '44444444-4444-4444-4444-444444444444';

set local role authenticated;
set local "request.jwt.claim.sub" to '44444444-4444-4444-4444-444444444444';

select throws_ok(
  $$ select create_workspace('Too late', '[]'::jsonb) $$,
  'access expired',
  'create_workspace rejects a call once access_expires_at has lapsed, regardless of max_workspaces'
);

-- An account with no entitlements row at all (e.g. one that predates the
-- on_auth_user_created trigger, see
-- 20260930180000_backfill_missing_entitlements_and_fail_closed.sql) must
-- fail loudly, not silently skip the limit check — `select ... into
-- v_limit` leaves it null on no match, and `v_count >= null` is null
-- (falsy) in plpgsql's `if`, which is exactly the bug this guards against.
reset role;

insert into auth.users (id, email)
values ('66666666-6666-6666-6666-666666666666', 'erin@example.com');
delete from public.entitlements
where user_id = '66666666-6666-6666-6666-666666666666';

set local role authenticated;
set local "request.jwt.claim.sub" to '66666666-6666-6666-6666-666666666666';

select throws_ok(
  $$ select create_workspace('Should fail', '[]'::jsonb) $$,
  'no entitlements row',
  'create_workspace rejects a caller with no entitlements row instead of silently skipping the limit check'
);

select * from finish();
rollback;
