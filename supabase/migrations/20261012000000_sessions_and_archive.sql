-- Archive: a third, non-deleting visibility state on Quest/Folder, distinct
-- from Trash's deleted_at and from Quest's own "done" status. Mirrors
-- deleted_at's shape exactly (nullable timestamptz, null = not archived) but
-- has no retention/purge semantics attached to it at all — archiving only
-- ever hides something, never schedules its deletion.
alter table quests add column archived_at timestamptz;
alter table folders add column archived_at timestamptz;

-- Written during session capture (extension/utils/sessions.ts), not derived
-- from updated_at (which also bumps on an unrelated rename/recolor) — drives
-- the client-side auto-archive inactivity check (extension/utils/autoArchive.ts).
alter table quests add column last_seen_at timestamptz;

-- Sessions: an append-only history of "every open, cntxt-bound window at
-- this moment", captured automatically every ~15 minutes
-- (extension/entrypoints/background.ts's alarm). `windows` is a jsonb array
-- of legs — [{entityTable, entityId, entityName, tabs:[{url,title}]}, ...]
-- — the same camelCase-keys-inside-jsonb convention quests.tabs/
-- folders.tabs already use. Deliberately ONE table, not normalized into
-- child rows per window/tab: every other tab list in this schema
-- (quests.tabs, folders.tabs) is a single jsonb column, and nothing in v1
-- needs an indexed "sessions mentioning entity X" query to justify being
-- the one exception. No FK on entity_id (it lives inside the jsonb blob,
-- not a real column) — a later-deleted/purged Quest or Folder can never
-- retroactively corrupt a historical session row, by construction, and
-- entity_name is denormalized onto each leg so a vanished entity still
-- displays sensibly in history.
create table sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  captured_at timestamptz not null default now(),
  windows jsonb not null default '[]'
);

create index sessions_user_captured_idx on sessions (user_id, captured_at desc);

alter table sessions enable row level security;

-- Same split as every other table: reads always work (dashboard must
-- render even with expired access), writes require has_active_access.
create policy "sessions: owner read"
  on sessions for select
  using (auth.uid() = user_id);

create policy "sessions: owner insert while active"
  on sessions for insert
  with check (auth.uid() = user_id and has_active_access(user_id));

-- Deliberately NO update and NO delete policy: a Session is immutable and
-- (per product decision) never auto-purged — there is no code path, ever,
-- that's supposed to remove or edit a session row, so there's no policy
-- that would let one. Enforced at the DB layer, not just by omission in
-- the client.

-- Table-level grant for the plain client insert/select (quota isn't gated
-- here — no RPC needed, same reasoning as a plain Area folder's
-- registerFolder in extension/utils/folders.ts). Only select+insert: there's
-- no update/delete policy for update/delete privileges to ever exercise.
-- See 20260930190000_grant_table_privileges.sql / 20261007120000_grant_folders_table.sql
-- for why this step can't be skipped — RLS alone doesn't bypass Postgres's
-- base table GRANT check.
grant select, insert on table sessions to authenticated;

-- count_workspace_like() is deliberately untouched: no quota applies to
-- Sessions, and archiving doesn't free quota either (only deleted_at/Trash
-- does) — an archived Quest/Project still counts toward max_workspaces,
-- same as a "done" one does today.
