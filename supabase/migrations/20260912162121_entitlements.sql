-- Entitlements: server-enforced plan limits, one row per user.
-- See docs/architecture-sync.md "Entitlements" and
-- docs/implementation-plan-sync.md M1/M2.

create table entitlements (
  user_id uuid primary key references auth.users (id) on delete cascade,
  max_workspaces int not null default 10,
  access_expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger entitlements_set_updated_at
  before update on entitlements
  for each row execute procedure extensions.moddatetime (updated_at);

alter table entitlements enable row level security;

-- Read-only from the client's perspective: no insert/update/delete policy
-- exists, so RLS default-denies every write via PostgREST. Only a
-- service-role connection (this migration's own trigger, or a future
-- billing webhook) can change a user's limits.
create policy "entitlements: owner can read own row"
  on entitlements for select
  using (auth.uid() = user_id);

-- Seed a default entitlements row the moment a user signs up, so
-- create_workspace always has a limit to check against.
create function handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.entitlements (user_id) values (new.id);
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure handle_new_user();

-- The one deliberate exception to "server is just tables and RLS" (see
-- docs/implementation-plan-sync.md's ground rule): an atomic check-and-write
-- for the one thing a bare client-side insert can't safely do.
--
-- `security definer`, not invoker: `entitlements` deliberately has no
-- UPDATE policy (it's read-only to clients), but `for update` below needs
-- one — Postgres requires a matching UPDATE-policy USING clause for
-- SELECT ... FOR UPDATE under RLS, not just a SELECT policy, since locking
-- a row implies a potential update to it. Running as the function's owner
-- (which bypasses RLS, same as any table owner) sidesteps that, so
-- ownership is enforced explicitly via `auth.uid()` below instead of
-- through the `workspaces` RLS policy.
--
-- `for update` locks the caller's entitlements row for the rest of this
-- transaction, so two concurrent calls from the same user serialize on this
-- line instead of both reading the same pre-insert count — this is what
-- closes the race described in docs/architecture-sync.md.
create function create_workspace(p_name text, p_tabs jsonb default '[]'::jsonb)
returns workspaces
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_limit int;
  v_count int;
  v_row workspaces;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;

  select max_workspaces into v_limit
  from entitlements
  where user_id = v_uid
  for update;

  select count(*) into v_count from workspaces where user_id = v_uid;

  if v_count >= v_limit then
    raise exception 'workspace limit reached';
  end if;

  insert into workspaces (user_id, name, tabs)
  values (v_uid, p_name, p_tabs)
  returning * into v_row;

  return v_row;
end;
$$;
