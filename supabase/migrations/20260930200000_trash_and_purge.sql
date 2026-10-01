-- Soft delete + scheduled purge, per docs/implementation-plan-sync.md M7.
-- deleteWorkspace (extension/utils/workspaces.ts) now sets this instead of
-- removing the row; the extension's push path propagates it here on the
-- next sync. A null deleted_at is "active"; a timestamp is "in the Trash
-- since then". Existing RLS ("owner full access", for all) already covers
-- both this column's update and an explicit "Delete forever" hard delete,
-- so no policy changes are needed.
alter table workspaces add column deleted_at timestamptz;

-- Retention window matches extension/utils/workspaces.ts's
-- trashRetentionDays — keep both in sync if either changes. "Paid" is the
-- same access_expires_at-in-the-future check create_workspace's RPC uses.
-- security definer + explicit search_path: this runs on a schedule, not as
-- any particular request's authenticated role, so it has to bypass RLS to
-- see every account's trashed rows rather than just one.
create function purge_trashed_workspaces()
returns void
language sql
security definer
set search_path = public
as $$
  delete from workspaces w
  using entitlements e
  where w.user_id = e.user_id
    and w.deleted_at is not null
    and w.deleted_at < now() - (
      case
        when e.access_expires_at is not null and e.access_expires_at > now()
          then interval '30 days'
        else interval '7 days'
      end
    );
$$;

-- Postgres grants EXECUTE on a new function to PUBLIC by default, which
-- would let any authenticated client call this directly via PostgREST's
-- /rpc/purge_trashed_workspaces — harmless in effect (the WHERE clause
-- only ever matches rows already past their retention window, so calling
-- it early can't delete anything the policy wouldn't delete anyway) but
-- this is an internal maintenance op, not a client-facing one, so close
-- the hole rather than rely on that.
revoke execute on function purge_trashed_workspaces() from public;

-- Supabase projects ship pg_cron pre-installed but not necessarily enabled
-- on every project — `if not exists` makes this migration safe to run
-- regardless. Hourly is frequent enough that nothing sits past its
-- retention window for long, and cheap enough (a handful of trashed rows
-- at most) not to matter.
create extension if not exists pg_cron;

select cron.schedule(
  'purge-trashed-workspaces',
  '0 * * * *',
  'select purge_trashed_workspaces();'
);

-- create_workspace's limit check (20260930180000_backfill_missing_
-- entitlements_and_fail_closed.sql) counted every row regardless of
-- deleted_at, so deleting a workspace never actually freed up the
-- account's quota until a cron tick happened to purge it. Excluding
-- trashed rows from the count is the only change — everything else is
-- unchanged from the previous version.
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

  select count(*) into v_count from workspaces
  where user_id = v_uid and deleted_at is null;

  if v_count >= v_limit then
    raise exception 'workspace limit reached';
  end if;

  insert into workspaces (id, user_id, name, tabs)
  values (coalesce(p_id, gen_random_uuid()), v_uid, p_name, p_tabs)
  returning * into v_row;

  return v_row;
end;
$$;
