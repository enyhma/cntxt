-- Closes the gap flagged in docs/architecture-sync.md ("Enforcement has to
-- live in RLS, not the entitlements cache"): create_workspace already
-- blocked creation past access_expires_at, but the blanket "owner full
-- access" policy let an expired user keep pushing updates/deletes straight
-- through supabase-js. Chosen answer to that doc's open question: freeze
-- writes, keep reads — reads stay owner-only with no expiry check so the
-- dashboard still renders; writes additionally require active access.
-- (ponytail: doesn't reclaim storage cost for a lapsed account forever —
-- upgrade to a grace-period delete job if that becomes the priority.)
create function has_active_access(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select access_expires_at is null or access_expires_at > now()
     from entitlements where user_id = p_user_id),
    false
  );
$$;

drop policy "workspaces: owner full access" on workspaces;

create policy "workspaces: owner read"
  on workspaces for select
  using (auth.uid() = user_id);

create policy "workspaces: owner write while active"
  on workspaces for insert
  with check (auth.uid() = user_id and has_active_access(user_id));

create policy "workspaces: owner update while active"
  on workspaces for update
  using (auth.uid() = user_id and has_active_access(user_id))
  with check (auth.uid() = user_id and has_active_access(user_id));

create policy "workspaces: owner delete while active"
  on workspaces for delete
  using (auth.uid() = user_id and has_active_access(user_id));

drop policy "resources: owner full access via workspace" on resources;

create policy "resources: owner read via workspace"
  on resources for select
  using (exists (
    select 1 from workspaces
    where workspaces.id = resources.workspace_id
    and workspaces.user_id = auth.uid()
  ));

create policy "resources: owner write via workspace while active"
  on resources for insert
  with check (exists (
    select 1 from workspaces
    where workspaces.id = resources.workspace_id
    and workspaces.user_id = auth.uid()
    and has_active_access(workspaces.user_id)
  ));

create policy "resources: owner update via workspace while active"
  on resources for update
  using (exists (
    select 1 from workspaces
    where workspaces.id = resources.workspace_id
    and workspaces.user_id = auth.uid()
    and has_active_access(workspaces.user_id)
  ))
  with check (exists (
    select 1 from workspaces
    where workspaces.id = resources.workspace_id
    and workspaces.user_id = auth.uid()
    and has_active_access(workspaces.user_id)
  ));

create policy "resources: owner delete via workspace while active"
  on resources for delete
  using (exists (
    select 1 from workspaces
    where workspaces.id = resources.workspace_id
    and workspaces.user_id = auth.uid()
    and has_active_access(workspaces.user_id)
  ));
