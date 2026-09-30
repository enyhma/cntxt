-- Extends create_workspace (see 20260912162121_entitlements.sql) for two
-- things the Creem integration needs:
--
-- 1. An optional client-supplied id, so the extension's locally-generated
--    workspace id (crypto.randomUUID(), already Postgres-uuid-compatible
--    per docs/architecture-sync.md) becomes the server row's id too — no
--    local/remote id remapping once a general sync engine
--    (implementation-plan-sync.md M6) exists to read it back.
-- 2. An access_expires_at check: once a paid plan lapses, creation should
--    stop even though max_workspaces was left at its Pro value — the Creem
--    webhook (supabase/functions/creem-webhook) only ever touches
--    access_expires_at on expiry, it never claws back max_workspaces.
--    Free-tier accounts have a null access_expires_at forever and are
--    unaffected by this check — only a *set and lapsed* expiry blocks
--    creation, per the corrected reading of docs/architecture-sync.md's
--    "Payments" section (the original text would have blocked free-tier
--    accounts entirely, since they never have a non-null expiry).
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
