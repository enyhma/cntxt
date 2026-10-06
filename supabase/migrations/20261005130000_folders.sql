-- Area/Project hierarchy from the PRD, collapsed into one self-referencing
-- table rather than two: an Area is a folder with parent_id null, a Project
-- is a folder whose parent is an Area. One table means one RLS pair and one
-- CRUD/sync module instead of duplicating both for two fixed tiers, and it
-- doesn't rule out a workspace sitting directly under an Area with no
-- Project. Depth (only 2 levels in practice) is a UI convention, not a DB
-- constraint — add a check if something ever actually needs enforcing it.
create table folders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  parent_id uuid references folders (id) on delete cascade,
  name text not null,
  color text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger folders_set_updated_at
  before update on folders
  for each row execute procedure extensions.moddatetime (updated_at);

alter table folders enable row level security;

-- Same split as the workspaces/resources policies in
-- 20261005120000_freeze_writes_on_expiry.sql: reads stay owner-only with no
-- expiry check, writes additionally require has_active_access().
create policy "folders: owner read"
  on folders for select
  using (auth.uid() = user_id);

create policy "folders: owner write while active"
  on folders for insert
  with check (auth.uid() = user_id and has_active_access(user_id));

create policy "folders: owner update while active"
  on folders for update
  using (auth.uid() = user_id and has_active_access(user_id))
  with check (auth.uid() = user_id and has_active_access(user_id));

create policy "folders: owner delete while active"
  on folders for delete
  using (auth.uid() = user_id and has_active_access(user_id));

-- Nullable and "on delete set null": a workspace's folder is purely
-- organizational, so deleting a Project ungroups its Missions instead of
-- taking them down with it. No RLS change needed — the existing workspaces
-- policies already gate this column like any other.
alter table workspaces add column folder_id uuid references folders (id) on delete set null;
