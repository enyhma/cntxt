-- Two related fixes, both surfaced by an account (pre-dating the
-- on_auth_user_created trigger in 20260912162121_entitlements.sql) that
-- had zero entitlements rows and so silently bypassed workspace limits
-- entirely.

-- 1. Backfill: give every existing auth.users row without a matching
--    entitlements row the same default a new signup gets. The trigger only
--    fires on future inserts, not retroactively.
insert into public.entitlements (user_id)
select id from auth.users
where id not in (select user_id from public.entitlements);

-- 2. Fail closed, not open: create_workspace's `select ... into v_limit`
--    leaves v_limit null on no match, and `v_count >= null` is null
--    (falsy) in plpgsql's `if`, so a missing entitlements row silently
--    skipped the limit check instead of rejecting the call. The backfill
--    above should make this unreachable in practice, but the function
--    shouldn't depend on that holding forever — a future bug that creates
--    a user without an entitlements row (a race in the trigger, a manual
--    auth.users insert, ...) should fail loudly here, not open the gate.
create or replace function create_workspace(
  p_name text,
  p_tabs jsonb default '[]'::jsonb,
  p_id uuid default null
)
returns workspaces
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_limit int;
  v_expires timestamptz;
  v_count int;
  v_row workspaces;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;

  select max_workspaces, access_expires_at into v_limit, v_expires
  from entitlements
  where user_id = v_uid
  for update;

  if v_limit is null then
    raise exception 'no entitlements row';
  end if;

  if v_expires is not null and v_expires <= now() then
    raise exception 'access expired';
  end if;

  select count(*) into v_count from workspaces where user_id = v_uid;

  if v_count >= v_limit then
    raise exception 'workspace limit reached';
  end if;

  insert into workspaces (id, user_id, name, tabs)
  values (coalesce(p_id, gen_random_uuid()), v_uid, p_name, p_tabs)
  returning * into v_row;

  return v_row;
end;
$$;
