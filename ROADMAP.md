# Roadmap: Workona-style workspace manager

Personal first, team second. No deep third-party integrations (Drive, Trello, Slack, etc.) — keeps backend surface small and avoids per-integration OAuth maintenance.

## Phase 1 — Personal (MVP)

- Browser extension (Manifest V3): save current window/tabs as a named workspace, close it, restore it later.
- Account required from first use (Supabase Auth: email magic link + Google OAuth) — moved up from Phase 2, so the server can enforce plan limits (entitlements) from day one. See `docs/architecture-sync.md`.
- Local-first data: once signed in, `storage.local` stays authoritative for day-to-day reads/writes — instant, offline-friendly. Only entitlement-gated actions (e.g. creating a workspace) need a server round-trip.
- Resources: workspace can hold manually-added links/notes, not just live tabs.
- Skip tab suspension — Chrome's built-in memory saver already covers this.
- Ship as a free tool before building cross-device sync of workspace data (Phase 2).

## Phase 2 — Sync across devices (Supabase)

- Builds on Phase 1's account + entitlements — no separate auth step here.
- No custom API layer: extension and web dashboard talk to Supabase directly via `supabase-js`, using its auto-generated PostgREST API. "Keep server dumb" becomes "no server."
- Schema (Postgres, via Supabase):
  - `workspaces (id, user_id, name, tabs jsonb, created_at, updated_at)`
  - `resources (id, workspace_id, type, url, note, created_at)`
- Authorization: Row-Level Security policies (`auth.uid() = user_id`) instead of app-level access checks — the DB enforces isolation, extension code doesn't have to.
- Sync: last-write-wins via `updated_at` — good enough for one user on multiple devices, no CRDT/merge logic.
- Web dashboard: thin SPA using `supabase-js` against the same tables — still management-only, not a second full UI.

## Phase 3 — Team

- Shared workspaces: add a `workspace_members (workspace_id, user_id, role)` join table; extend RLS policies to check membership instead of just `user_id`.
- Real-time updates: Supabase Realtime (Postgres change subscriptions) — skip building a websocket layer.
- Seats/billing (Stripe) — this is the point it becomes a paying product. Supabase has no billing primitive, so this stays custom regardless.
- No Drive/Trello/Slack connectors, by design.

## Explicit non-goals

- Deep integrations with Google Drive, Trello, Slack, etc.
- Tab suspension / memory management (native browser features cover it).

## Open risk

Skipping integrations removes Workona's main lock-in mechanism (all your tools in one place). Retention has to come from the extension being genuinely faster than native tab management, not from ecosystem lock-in.
