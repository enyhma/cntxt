-- Introduces a second paid tier (Basic: one-time purchase) alongside the
-- existing Pro subscription, and makes Sync/History actually plan-gated
-- instead of available to every signed-in account. See
-- docs/architecture-sync.md and marketing/src/pages/pricing.astro for the
-- product shape this backs: Free (capped), Basic (unlimited workspaces/
-- tabs, one-time, no sync), Pro (unlimited + sync, subscription).

-- Lifetime grant from the Basic one-time purchase. Deliberately not an
-- expiring column like access_expires_at — Basic never lapses on its own,
-- only a refund clears it (see supabase/functions/creem-webhook).
alter table entitlements add column has_basic_license boolean not null default false;

-- has_active_access gated every write on "is access currently active",
-- which used to mean exactly one thing: Pro, via access_expires_at. Now
-- that Basic is a separate, permanent grant, a Basic buyer whose Pro trial/
-- subscription separately lapses must NOT be frozen out — has_basic_license
-- short-circuits the expiry check the same way a null (free-tier, never
-- expires) expiry already does.
create or replace function has_active_access(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select has_basic_license or access_expires_at is null or access_expires_at > now()
     from entitlements where user_id = p_user_id),
    false
  );
$$;

-- "Sync" (cross-device continuity) is the one thing in this schema that
-- was never actually gated: every signed-in account, Free included,
-- already pushed/pulled Groups/Folders/Sessions in full. This is the new,
-- narrower check for that — unlike has_active_access, Basic does NOT
-- satisfy it: only a currently-active Pro subscription does, since nothing
-- else ever sets access_expires_at to a real future timestamp.
create function has_sync_access(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select access_expires_at is not null and access_expires_at > now()
     from entitlements where user_id = p_user_id),
    false
  );
$$;

-- create_group/create_project each duplicated the same raw
-- "v_expires is not null and v_expires <= now()" check inline — that
-- logic now has a name (has_active_access already covers it, with the
-- has_basic_license fix above baked in), so route both through it instead
-- of keeping two copies that would otherwise need the same fix twice.
create or replace function create_group(
  p_name text,
  p_tabs jsonb default '[]'::jsonb,
  p_id uuid default null
)
returns groups
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_limit int;
  v_count int;
  v_row groups;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;

  select max_workspaces into v_limit
  from entitlements
  where user_id = v_uid
  for update;

  if not has_active_access(v_uid) then
    raise exception 'access expired';
  end if;

  v_count := count_group_like(v_uid);

  if v_count >= v_limit then
    raise exception 'workspace limit reached';
  end if;

  insert into groups (id, user_id, name, tabs)
  values (coalesce(p_id, gen_random_uuid()), v_uid, p_name, p_tabs)
  returning * into v_row;

  return v_row;
end;
$$;

create or replace function create_project(
  p_name text,
  p_parent_id uuid default null,
  p_id uuid default null
)
returns folders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_limit int;
  v_count int;
  v_row folders;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;

  select max_workspaces into v_limit
  from entitlements
  where user_id = v_uid
  for update;

  if not has_active_access(v_uid) then
    raise exception 'access expired';
  end if;

  v_count := count_group_like(v_uid);

  if v_count >= v_limit then
    raise exception 'workspace limit reached';
  end if;

  insert into folders (id, user_id, parent_id, name, kind)
  values (coalesce(p_id, gen_random_uuid()), v_uid, p_parent_id, p_name, 'project')
  returning * into v_row;

  return v_row;
end;
$$;

-- Narrow three write policies from "access is active" (which Free/Basic
-- also satisfy) to "Sync is active" (Pro only). Deliberately UPDATE/INSERT
-- only, not DELETE: Free/Basic must still be able to delete/trash a
-- Group or Project to free up their workspace-count slot, and still
-- create up to their cap via the RPCs above (which are security definer
-- and bypass RLS entirely, gated by has_active_access inside the function
-- body instead) — only the continuous push of edits (renames, tab-list
-- changes) is what "Sync" actually means, and that's what this blocks.
--
-- Known limitation, accepted rather than solved here: the matching read
-- ("owner read") policies stay unconditional, so a modified client could
-- still manually pull its own already-synced rows even without Sync
-- access. No confidentiality issue (it's the user's own data) — the real
-- gate is the extension's sync engine never running its pull loop
-- (extension/utils/sync.ts) when entitlements say Sync isn't active; this
-- is the defense-in-depth half for the push side only.
alter policy "groups: owner update while active" on groups
  using (auth.uid() = user_id and has_sync_access(user_id))
  with check (auth.uid() = user_id and has_sync_access(user_id));

alter policy "folders: owner update while active" on folders
  using (auth.uid() = user_id and has_sync_access(user_id))
  with check (auth.uid() = user_id and has_sync_access(user_id));

-- Sessions (History) has no update policy at all (a session is immutable),
-- so insert is the only write to gate — this is what makes History
-- genuinely Pro-only server-side, not just un-synced.
alter policy "sessions: owner insert while active" on sessions
  with check (auth.uid() = user_id and has_sync_access(user_id));

-- resources (Bookmarks) policies are deliberately untouched: Bookmarks
-- stay free for every tier, by product decision.
