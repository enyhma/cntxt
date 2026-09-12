begin;
select plan(4);

-- Arrange: two auth users. The auth.users trigger (added in this migration)
-- should seed a default entitlements row for each.
insert into auth.users (id, email)
values
  ('11111111-1111-1111-1111-111111111111', 'alice@example.com'),
  ('22222222-2222-2222-2222-222222222222', 'bob@example.com');

select is(
  (select max_workspaces from public.entitlements where user_id = '11111111-1111-1111-1111-111111111111'),
  10,
  'signing up seeds a default entitlements row via the auth.users trigger'
);

-- Act: become alice for the RLS checks below.
set local role authenticated;
set local "request.jwt.claim.sub" to '11111111-1111-1111-1111-111111111111';

select is(
  (select user_id::text from public.entitlements where user_id = '11111111-1111-1111-1111-111111111111'),
  '11111111-1111-1111-1111-111111111111',
  'a user can select their own entitlements row'
);

select is(
  (select count(*) from public.entitlements where user_id = '22222222-2222-2222-2222-222222222222'),
  0::bigint,
  'RLS hides another user''s entitlements row from a plain select'
);

update public.entitlements set max_workspaces = 999
where user_id = '11111111-1111-1111-1111-111111111111';

select is(
  (select max_workspaces from public.entitlements where user_id = '11111111-1111-1111-1111-111111111111'),
  10,
  'a user cannot change their own entitlements row directly (no write policy — RLS default-denies it)'
);

select * from finish();
rollback;
