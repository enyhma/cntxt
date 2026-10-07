-- Section = a depth-2 folder (parent is a Project) — see
-- 20261005130000_folders.sql for why depth is a UI convention, not a DB
-- constraint, so no schema change is needed on `folders` itself for this.
-- A resource can now be parented to a Section instead of (or in addition
-- to a prior) Mission, so it survives that Mission being deleted — make
-- workspace_id optional and add the sibling column. Exactly one of the two
-- is ever set; enforced at the call site (addResource), not here, mirroring
-- how workspaces.folder_id has no matching check constraint either.
alter table resources alter column workspace_id drop not null;
alter table resources add column folder_id uuid references folders (id) on delete cascade;

-- Additive, not a rewrite of the existing "via workspace" policies: each
-- EXISTS check below is trivially false whenever folder_id is null (or
-- workspace_id is null, for the existing policies), so Postgres simply
-- OR's the two permissive policies per operation — a folder-parented row
-- is governed by these, a mission-parented row by the existing ones.
create policy "resources: owner read via folder"
  on resources for select
  using (exists (
    select 1 from folders
    where folders.id = resources.folder_id
    and folders.user_id = auth.uid()
  ));

create policy "resources: owner write via folder while active"
  on resources for insert
  with check (exists (
    select 1 from folders
    where folders.id = resources.folder_id
    and folders.user_id = auth.uid()
    and has_active_access(folders.user_id)
  ));

create policy "resources: owner update via folder while active"
  on resources for update
  using (exists (
    select 1 from folders
    where folders.id = resources.folder_id
    and folders.user_id = auth.uid()
    and has_active_access(folders.user_id)
  ))
  with check (exists (
    select 1 from folders
    where folders.id = resources.folder_id
    and folders.user_id = auth.uid()
    and has_active_access(folders.user_id)
  ));

create policy "resources: owner delete via folder while active"
  on resources for delete
  using (exists (
    select 1 from folders
    where folders.id = resources.folder_id
    and folders.user_id = auth.uid()
    and has_active_access(folders.user_id)
  ));
