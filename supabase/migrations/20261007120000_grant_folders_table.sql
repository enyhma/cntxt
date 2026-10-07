-- Same gap as 20260930190000_grant_table_privileges.sql, on a table that
-- didn't exist yet when that migration landed: `folders`
-- (20261005130000_folders.sql) never got a table-level GRANT either, so
-- pullRemoteFolders/pushDirtyFolders (utils/folders.ts) — plain
-- client-side reads/writes, not security-definer RPCs — hit "permission
-- denied for table folders" exactly like workspaces/resources/entitlements
-- did before. createFolder's insert silently fell into its own "offline"
-- syncStatus fallback instead of surfacing this, which is how it went
-- unnoticed until sync (utils/sync.ts) tried to pull.
grant select, insert, update, delete on table folders to authenticated;
