# Workspace sync semantics

Orthogonal to [`workspace-activation-semantics.md`](./workspace-activation-semantics.md)
— a workspace's sync status is about its relationship to the _account_
(does the server have a row for it), not to any particular window. A
workspace can be Active-here and Not-synced at the same time. This is the
fixed vocabulary for signaling that, driven by `Workspace.syncStatus`
(`extension/utils/workspaces.ts`) and rendered by `SyncBadge` in
`extension/entrypoints/dashboard/App.tsx`.

| State                               | Meaning                                                                | Color              | Icon               | Copy                                                    |
| ----------------------------------- | ---------------------------------------------------------------------- | ------------------ | ------------------ | ------------------------------------------------------- |
| **Synced (default)**                | `create_workspace` RPC confirmed a server-side row exists for this id. | none (baseline)    | none               | none                                                    |
| **Syncing**                         | The create-time RPC is in flight; result not known yet.                | `surface-txt-hint` | `RefreshCw` (spin) | "Syncing…"                                              |
| **Not synced — offline/signed out** | RPC failed with `not authenticated`, or any other network failure.     | `surface-txt-hint` | `CloudOff`         | "Not synced — offline" / "Not synced — sign in to sync" |
| **Not synced — plan limit reached** | RPC failed with `workspace limit reached`.                             | `warning`          | `CloudOff`         | "Not synced — plan limit reached"                       |
| **Not synced — plan expired**       | RPC failed with `access expired`.                                      | `warning`          | `CloudOff`         | "Not synced — plan expired"                             |

Same philosophy as the activation table's "Dormant" baseline: the common
case (synced) draws nothing at all — only an exception earns a badge, so the
row stays quiet unless there's actually something to notice.

A workspace with no `syncStatus` at all (created before this field existed)
is treated the same as "Syncing" until `reconcileSyncStatus()` (called on
dashboard mount and on every `SIGNED_IN`/`TOKEN_REFRESHED`) re-checks it.

## Account-level usage

The header's account-menu (the dropdown keyed to the signed-in email,
`extension/entrypoints/dashboard/App.tsx`) is the one surface for
plan/usage awareness — no separate settings page for it, since it's already
where the Upgrade links live.

- **Usage line** (top of the dropdown): `{synced} of {max} workspaces
synced` — `synced` counts workspaces whose `syncStatus` is `"synced"`,
  compared against `entitlements.maxWorkspaces`. Plain `surface-txt-hint`
  normally; `warning` once anything is actually blocked (see below).
- **Menu-trigger badge**: a small `warning`-colored pill showing the count
  of workspaces with `syncStatus` `"limit-reached"` or `"expired"` —
  visible without opening the menu, mirroring a notification-count badge.
  Only appears once something has actually failed to sync for a plan
  reason (not merely because a count crossed a threshold with nothing
  rejected yet).
- **Dismissible banner**: shown across the dashboard whenever that same
  blocked count is above zero, using the same `border-warning bg-warning/10`
  treatment as the existing "Supabase isn't configured" box. Copy reads
  "Your plan has expired" if any blocked workspace's reason is `"expired"`,
  otherwise "You've hit your plan's limit". Dismissing it is per-session
  (a plain signal, not persisted) and resets automatically if the blocked
  count changes — so a _new_ rejection, or an upgrade that clears and later
  regresses, brings it back rather than leaving it dismissed forever.

## Non-goals

- No retry/resync triggered by renaming a workspace, editing its tabs, or a
  periodic timer — only the mount/auth-event reconcile pass above. Extending
  resync to cover edits would need an `update_workspace` RPC that doesn't
  exist yet; out of scope here.
- Doesn't touch the tabs-per-workspace "open problem" in
  `docs/architecture-sync.md` — this vocabulary is only about whole-workspace
  sync status.
