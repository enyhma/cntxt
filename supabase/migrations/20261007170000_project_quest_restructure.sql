-- Project/Quest restructuring: Mission + Phase merge into one flat Quest
-- record, and Project becomes a window-bound workspace in its own right —
-- the role Mission used to have alone. Clean break, no deployed user data
-- to preserve (the workspaces->quests rename was deliberately deferred when
-- Mission was introduced at the TS layer, see the old comment this removes
-- in extension/utils/missions.ts; nothing stops it now).

alter table workspaces rename to quests;

-- Phase merges into Quest: each former phase becomes its own first-class
-- Quest row instead of a jsonb array entry on its parent. No data to carry
-- forward (clean break) — just drop the old columns and add what a flat
-- Quest needs instead.
alter table quests drop column phases;
alter table quests drop column active_phase_id;

alter table quests add column status text not null default 'pending'
  check (status in ('pending', 'active', 'done'));
-- "order" is a reserved word; order_index maps to/from the TS `order`
-- field the same way folder_id already maps to/from `folderId`. Replaces
-- the implicit array-index ordering Mission.phases relied on.
alter table quests add column order_index integer not null default 0;

-- Cosmetic only — Postgres already rewrote these policies' actual
-- table/column references when the table above was renamed; this just
-- keeps their displayed names matching the renamed table.
alter policy "workspaces: owner read" on quests rename to "quests: owner read";
alter policy "workspaces: owner write while active" on quests rename to "quests: owner write while active";
alter policy "workspaces: owner update while active" on quests rename to "quests: owner update while active";
alter policy "workspaces: owner delete while active" on quests rename to "quests: owner delete while active";

-- Area/Project/Section was inferred purely from nesting depth (see
-- 20261005130000_folders.sql). A Project can now be created with
-- parent_id null (ad-hoc, window-created, see below), so depth alone can
-- no longer tell an unparented Project apart from an Area — make the tier
-- explicit instead. No default: every existing row and every future
-- insert must say what it is (createFolder's `kind` param is required as
-- of this change).
alter table folders add column kind text not null
  check (kind in ('area', 'project', 'section'));

-- Project-only fields (kind = 'project'): its own live tab list, and which
-- child Quest (if any) currently has its tabs swapped into this Project's
-- window in place of its own. Area/Section rows simply never populate
-- these — same "tier-specific optional column on the one shared table"
-- precedent `color` already set.
alter table folders add column tabs jsonb not null default '[]';
alter table folders add column active_quest_id uuid references quests (id) on delete set null;

alter table resources rename column workspace_id to quest_id;

-- Ad-hoc, window-created Projects must stay quota-gated the same way Quest
-- creation always has been — otherwise opening a browser window becomes a
-- free, unlimited way to create what used to cost a workspace slot. Rather
-- than a separate max_projects limit, Projects and Quests now draw from the
-- same existing max_workspaces pool: both are "workspace-like" uses of the
-- one limit the plan already governs.
create function count_workspace_like(p_uid uuid)
returns int
language sql
stable
security definer
set search_path = public
as $$
  select (select count(*) from quests where user_id = p_uid)
       + (select count(*) from folders where user_id = p_uid and kind = 'project');
$$;

-- Renamed from create_workspace (20260928163000_create_workspace_client_id_and_expiry.sql);
-- the create-or-replace below then updates its body to count against the
-- shared quest+project pool instead of quests alone.
alter function create_workspace(text, jsonb, uuid) rename to create_quest;

create or replace function create_quest(
  p_name text,
  p_tabs jsonb default '[]'::jsonb,
  p_id uuid default null
)
returns quests
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_limit int;
  v_expires timestamptz;
  v_count int;
  v_row quests;
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

  v_count := count_workspace_like(v_uid);

  if v_count >= v_limit then
    raise exception 'workspace limit reached';
  end if;

  insert into quests (id, user_id, name, tabs)
  values (coalesce(p_id, gen_random_uuid()), v_uid, p_name, p_tabs)
  returning * into v_row;

  return v_row;
end;
$$;

-- Mirrors create_quest's entitlement check (same v_limit/v_expires/for-update
-- shape), against the same shared pool, for Project creation — both the
-- ad-hoc "every window is a Project" path (attach.ts's ensureBindingForWindow)
-- and the dashboard's explicit "+ Project" button go through this, so the
-- limit can't be bypassed by creating Projects instead of Quests.
create function create_project(
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

  v_count := count_workspace_like(v_uid);

  if v_count >= v_limit then
    raise exception 'workspace limit reached';
  end if;

  insert into folders (id, user_id, parent_id, name, kind)
  values (coalesce(p_id, gen_random_uuid()), v_uid, p_parent_id, p_name, 'project')
  returning * into v_row;

  return v_row;
end;
$$;
