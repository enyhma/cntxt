-- RLS policies restrict which *rows* a query can see, but Postgres still
-- checks a base table-level GRANT before RLS ever runs — neither table
-- migration (20260912040442_init_workspaces.sql,
-- 20260912162121_entitlements.sql) ever issued one. create_workspace
-- never surfaced this because it's `security definer`, running as the
-- function's owner rather than the caller's `authenticated` role;
-- pullRemoteWorkspaces (utils/workspaces.ts) is the first plain
-- client-side table read this app has made, and "permission denied for
-- table workspaces" is what that gap looks like. refreshEntitlements
-- (utils/entitlements.ts) is a plain select too, so it's been hitting the
-- same wall silently (its error path just caches "undefined" and never
-- surfaces the failure) for every account, not only one missing an
-- entitlements row.
--
-- Table-level grants only open the door; RLS policies already in place
-- (`auth.uid() = user_id`, entitlements' read-only owner policy) are what
-- actually decide which rows are visible or writable — granting here
-- doesn't widen access beyond what those policies already intend.
grant select, insert, update, delete on table workspaces to authenticated;
grant select, insert, update, delete on table resources to authenticated;
grant select on table entitlements to authenticated;
