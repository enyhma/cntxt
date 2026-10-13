-- Quest -> Group rename, matching the browser's own tab-group mental
-- model. Real user data exists (see the entitlements backfill migration),
-- so this is an in-place ALTER, not a drop/recreate, and ships in the same
-- release as the matching extension code (big-bang rollout, accepted).
--
-- Also fixes three leftovers the earlier workspaces->quests rename
-- (20261007170000_project_quest_restructure.sql) never caught: the
-- updated_at trigger, the trash-purge function, and the resources
-- policies' names all still said "workspace(s)".

alter table quests rename to groups;

alter table folders rename column active_quest_id to active_group_id;
alter table resources rename column quest_id to group_id;

-- Cosmetic: Postgres already rewrote these policies' actual table/column
-- references via the renames above (policy bodies are parsed expression
-- trees tracked by OID, not stored text) — this just keeps their
-- displayed names matching.
alter policy "quests: owner read" on groups rename to "groups: owner read";
alter policy "quests: owner write while active" on groups rename to "groups: owner write while active";
alter policy "quests: owner update while active" on groups rename to "groups: owner update while active";
alter policy "quests: owner delete while active" on groups rename to "groups: owner delete while active";
-- The original single "resources: owner full access via workspace" policy
-- (20260912040442_init_workspaces.sql) was dropped and replaced by these
-- four narrower ones in 20261005120000_freeze_writes_on_expiry.sql — that
-- policy name no longer exists, these are the real current ones.
alter policy "resources: owner read via workspace" on resources rename to "resources: owner read via group";
alter policy "resources: owner write via workspace while active" on resources rename to "resources: owner write via group while active";
alter policy "resources: owner update via workspace while active" on resources rename to "resources: owner update via group while active";
alter policy "resources: owner delete via workspace while active" on resources rename to "resources: owner delete via group while active";

alter trigger workspaces_set_updated_at on groups rename to groups_set_updated_at;

-- count_workspace_like/create_quest/purge_trashed_workspaces are PL/pgSQL
-- functions — their bodies are stored as text and parsed lazily, so they
-- do NOT follow a table rename automatically the way policies/views do.
-- Each is renamed, then recreated with its internal table/column
-- references updated to match. extension/utils/groups.ts and folders.ts
-- pattern-match these RPCs' exact RAISE EXCEPTION strings ('not
-- authenticated', 'access expired', 'workspace limit reached') — kept
-- verbatim here on purpose; only the table/column references change.

alter function count_workspace_like(uuid) rename to count_group_like;

create or replace function count_group_like(p_uid uuid)
returns int
language sql
stable
security definer
set search_path = public
as $$
  select (select count(*) from groups where user_id = p_uid and deleted_at is null)
       + (select count(*) from folders where user_id = p_uid and kind = 'project');
$$;

alter function create_quest(text, jsonb, uuid) rename to create_group;

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
  v_expires timestamptz;
  v_count int;
  v_row groups;
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

-- create_project shares count_workspace_like/count_group_like's pool —
-- its body calls the function by name, so it needs recreating too even
-- though its own table (folders) isn't being renamed.
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
  v_expires timestamptz;
  v_count int;
  v_row folders;
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

alter function purge_trashed_workspaces() rename to purge_trashed_groups;

create or replace function purge_trashed_groups()
returns void
language sql
security definer
set search_path = public
as $$
  delete from groups g
  using entitlements e
  where g.user_id = e.user_id
    and g.deleted_at is not null
    and g.deleted_at < now() - (
      case
        when e.access_expires_at is not null and e.access_expires_at > now()
          then interval '30 days'
        else interval '7 days'
      end
    );
$$;

-- The pg_cron job stores its command as plain text (`select
-- purge_trashed_workspaces();`), which a function rename does not rewrite
-- — unschedule and reschedule under the new name/command rather than
-- leaving a job that calls a function that no longer exists.
select cron.unschedule('purge-trashed-workspaces');
select cron.schedule(
  'purge-trashed-groups',
  '0 * * * *',
  'select purge_trashed_groups();'
);

-- Table/function grants (GRANT ... ON TABLE/FUNCTION) are tracked by OID
-- and survive renames automatically — nothing to re-grant here. Verify
-- with \dp groups / \df groups after applying.
