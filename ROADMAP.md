# Roadmap: Workona-style workspace manager

Personal first, team second. No deep third-party integrations (Drive, Trello, Slack, etc.) — keeps backend surface small and avoids per-integration OAuth maintenance.

## Phase 1 — Personal (MVP)

- Browser extension (Manifest V3): save current window/tabs as a named workspace, close it, restore it later.
- Local storage only (chrome.storage / IndexedDB) — no backend yet.
- Resources: workspace can hold manually-added links/notes, not just live tabs.
- Skip tab suspension — Chrome's built-in memory saver already covers this.
- Ship as a standalone usable free tool before touching sync.

## Phase 2 — Personal + Sync

- Auth (email or OAuth) + backend (Postgres/Supabase-style) so workspaces sync across devices.
- Keep server dumb: `workspaces` table, `resources` table, tabs stored as JSON blob per workspace.
- Web dashboard for viewing/editing workspaces outside the browser — management only, not a second full UI.

## Phase 3 — Team

- Shared workspaces: `owner` / `shared_with` model, real-time updates (websockets or polling) so teammates see the same tab set.
- Seats/billing (Stripe) — this is the point it becomes a paying product.
- No Drive/Trello/Slack connectors, by design.

## Explicit non-goals

- Deep integrations with Google Drive, Trello, Slack, etc.
- Tab suspension / memory management (native browser features cover it).

## Open risk

Skipping integrations removes Workona's main lock-in mechanism (all your tools in one place). Retention has to come from the extension being genuinely faster than native tab management, not from ecosystem lock-in.
