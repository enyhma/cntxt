-- Free plan is advertised as "up to 3 workspaces" (marketing/src/pages/index.astro),
-- but new rows got the schema default of 10 (20260912162121_entitlements.sql),
-- so every new signup could create 10 workspaces before hitting the limit.

alter table entitlements alter column max_workspaces set default 3;

-- Backfill rows that are still sitting at the old default and haven't been
-- given a paid plan's higher limit (paid rows get max_workspaces set
-- explicitly by the Creem webhook, see docs/architecture-sync.md).
update entitlements set max_workspaces = 3
where max_workspaces = 10 and access_expires_at is null;
