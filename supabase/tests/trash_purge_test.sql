begin;
select plan(7);

insert into auth.users (id, email)
values
  ('99999999-9999-9999-9999-999999999999', 'free@example.com'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'paid@example.com');

-- Free account (default entitlements row: access_expires_at null): one
-- workspace trashed 8 days ago (past the 7-day free retention window),
-- one trashed 1 day ago (still within it).
insert into public.workspaces (id, user_id, name, deleted_at)
values
  ('11111111-1111-1111-1111-111111111111',
   '99999999-9999-9999-9999-999999999999', 'Old trash',
   now() - interval '8 days'),
  ('22222222-2222-2222-2222-222222222222',
   '99999999-9999-9999-9999-999999999999', 'Recent trash',
   now() - interval '1 day');

-- Paid account (access_expires_at in the future): trashed 10 days ago —
-- past the free window but well within the 30-day paid one.
update public.entitlements set access_expires_at = now() + interval '1 year'
where user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

insert into public.workspaces (id, user_id, name, deleted_at)
values
  ('33333333-aaaa-aaaa-aaaa-333333333333',
   'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Paid old trash',
   now() - interval '10 days');

reset role;
select purge_trashed_workspaces();

select is(
  (select count(*) from public.workspaces where id = '11111111-1111-1111-1111-111111111111'),
  0::bigint,
  'a free-tier workspace trashed past the 7-day window is purged'
);

select is(
  (select count(*) from public.workspaces where id = '22222222-2222-2222-2222-222222222222'),
  1::bigint,
  'a free-tier workspace trashed within the 7-day window survives'
);

select is(
  (select count(*) from public.workspaces where id = '33333333-aaaa-aaaa-aaaa-333333333333'),
  1::bigint,
  'a paid-tier workspace trashed 10 days ago survives — within the 30-day paid window'
);

-- Active (non-trashed) workspaces are never touched regardless of age.
insert into public.workspaces (id, user_id, name, created_at, updated_at)
values (
  '44444444-4444-4444-4444-444444444444',
  '99999999-9999-9999-9999-999999999999',
  'Still active',
  now() - interval '100 days',
  now() - interval '100 days'
);
select purge_trashed_workspaces();
select is(
  (select count(*) from public.workspaces where id = '44444444-4444-4444-4444-444444444444'),
  1::bigint,
  'an active (non-trashed) workspace is never purged, however old'
);

-- Internal maintenance op, not client-facing — see the revoke in
-- 20260930200000_trash_and_purge.sql.
set local role authenticated;
set local "request.jwt.claim.sub" to '99999999-9999-9999-9999-999999999999';
select throws_like(
  $$ select purge_trashed_workspaces() $$,
  '%permission denied%',
  'an authenticated client cannot call purge_trashed_workspaces directly'
);

-- Trashing a workspace frees the quota slot it held — create_workspace's
-- count now excludes deleted_at rows (see 20260930200000_trash_and_purge.sql).
insert into auth.users (id, email)
values ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'quota@example.com');

set local role authenticated;
set local "request.jwt.claim.sub" to 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

select create_workspace('W1');
select create_workspace('W2');
select create_workspace('W3');

select throws_ok(
  $$ select create_workspace('W4') $$,
  'workspace limit reached',
  'at the default free limit (3), a fourth create_workspace is rejected'
);

reset role;
update public.workspaces set deleted_at = now()
where user_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb' and name = 'W1';

set local role authenticated;
set local "request.jwt.claim.sub" to 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

select isnt(
  (select (create_workspace('W4')).id),
  null,
  'trashing a workspace frees its quota slot for a new create_workspace call'
);

select * from finish();
rollback;
