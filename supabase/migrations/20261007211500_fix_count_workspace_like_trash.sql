-- Regression fix: create_workspace (20260930200000_trash_and_purge.sql)
-- explicitly excluded trashed rows from its quota count ("deleting a
-- workspace never actually freed up the account's quota until a cron tick
-- happened to purge it" — that migration's own comment). count_workspace_like
-- (20261007170000_project_quest_restructure.sql), written to replace that
-- count for both Quest and Project creation, dropped that filter — every
-- trashed Quest silently went back to counting against the limit, so an
-- account could get "limit reached" on new creates despite having room
-- among its active items. Folders have no trash tier (deleteFolder is a
-- hard delete), so only the quests half needs the filter.
create or replace function count_workspace_like(p_uid uuid)
returns int
language sql
stable
security definer
set search_path = public
as $$
  select (select count(*) from quests where user_id = p_uid and deleted_at is null)
       + (select count(*) from folders where user_id = p_uid and kind = 'project');
$$;
