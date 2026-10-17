# Capabilities

What cntxt can do today, what it can't yet, and what's planned for each gap.
Sourced from the current `extension/` code, `ROADMAP.md`, and recent product
discussion. Update this alongside the roadmap as things ship — it's a
snapshot, not a contract.

Legend: ✅ Implemented · 🚧 Partially implemented · ❌ Not implemented

See [`workflows.md`](./workflows.md) for how each ✅ capability actually
works step by step (sequence diagrams traced from the code), and
[`architecture-sync.md`](./architecture-sync.md) for the sync design behind
every cross-device row below.

## Capture & restore (core loop)

| Capability                                                                                                                                         | Status | Value                                                                                                                                                                                                                                                           |
| -------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Save a window's tabs as a Project                                                                                                                  | ✅     | The whole product's job in one feature — turns an ephemeral browser window into something you can put down and pick back up.                                                                                                                                    |
| Live tab sync (a Project/Group mirrors its window automatically)                                                                                   | ✅     | No manual "save" step to remember — you can't lose a session mid-work because it was never in an unsaved state.                                                                                                                                                 |
| Close all tabs, keep the Project/Group                                                                                                             | ✅     | Lets you reclaim screen/memory without a save dialog or a fear of losing what you were doing.                                                                                                                                                                   |
| Restore a Project or Group into the current window                                                                                                 | ✅     | One click back into a saved context — the payoff for having saved it.                                                                                                                                                                                           |
| Rename a Project or Group                                                                                                                          | ✅     | Saved sets accumulate; a name is what makes picking the right one later fast instead of guesswork.                                                                                                                                                              |
| Delete a Group (soft-delete, Trash view, retention window)                                                                                         | ✅     | Keeps the list from becoming permanent clutter, without an accidental delete being unrecoverable.                                                                                                                                                               |
| Delete a Project or Area (soft-delete, with Trash)                                                                                                 | ❌     | `deleteFolder` is a hard delete today — a Project/Area has no retention window at all, unlike a Group. An accidental delete of a Project is unrecoverable.                                                                                                      |
| Multiple windows, each its own Project or Group, tracked concurrently                                                                              | ✅     | Matches how people actually work (several projects open at once) instead of forcing one active workspace globally.                                                                                                                                              |
| Resume last-used Project/Group on browser startup                                                                                                  | ✅     | Removes a manual "reopen where I left off" step after every restart.                                                                                                                                                                                            |
| A Group nested under a Project: swap its tabs into the Project's window, complete it (closed but reopenable), auto-advance to the next pending one | ✅     | A short-lived side task that belongs to a Project without needing its own window, and without losing its tab list once you're done with it for now.                                                                                                             |
| "Open all" into a _new_ window (Restore without replacing current tabs)                                                                            | ❌     | Restore always replaces the current window's tabs; no way to pull a saved Project/Group up alongside what's already open. Session restore (below) covers a related but different case — reopening a whole past session's windows, not one ad-hoc Project/Group. |
| Manually-added links/notes as resources, attached directly to a Project or Group                                                                   | ✅     | Lets a Project or Group hold reference material that was never an open tab. The old intermediate "Section" tier was removed once Project itself became persistent enough to hold these directly.                                                                |
| Archive a Group, Project, or Area (put it aside without deleting it)                                                                               | ✅     | Separates "not right now" from "gone for good" without the list growing forever. Archiving a Project cascades to archive its child Groups; unarchiving does not cascade back.                                                                                   |
| Auto-archive a "done" Group after a configurable stretch of inactivity                                                                             | ✅     | The passive, Timing.app-style version of the row above — you don't have to remember to tidy up finished work yourself.                                                                                                                                          |

**Roadmap**

- Folder (Project/Area) soft-delete + Trash: no concrete design yet: needs
  its own retention column (`folders` has no `deleted_at`) and a decision on
  whether a trashed Project's child Groups trash along with it.
- "Open all into a new window" for a single Project/Group: no concrete plan;
  would need `restoreMachine` to stop assuming "always the current window"
  (see the Sessions section below — Session restore already solved this for
  _whole sessions_ by bypassing `restoreMachine` entirely with a plain loop,
  which is the template a single-target version would follow).
- Auto-archive is Group-only (Folders have no `status`, so "done + inactive"
  doesn't apply to a Project) — a Project is archived manually only; no plan
  to add an automatic Project-level rule.

## Organization

| Capability                                                   | Status | Value                                                                                                                                                                                                          |
| ------------------------------------------------------------ | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Area / Project / Group hierarchy, explicit `kind` per Folder | ✅     | Groups Projects under an Area, and lets a Group nest under a Project (or an Area, or stay ungrouped) — the structural answer to "a flat workspace list doesn't scale."                                         |
| Color-coding (a Project, Group, or Area)                     | ✅     | Fast visual scanning in a sidebar/list once there are more than 3-4 — color, not just text, is what you recognize at a glance. Also now mirrored into native browser tab-group colors (see Tab Groups, below). |
| Drag-and-drop tabs between Groups/Projects                   | ❌     | Reorganizing currently has no UI for it at all — this is the difference between tidying as you go vs. never tidying.                                                                                           |
| Multi-select + bulk move tabs                                | ✅     | Select several of a Group's tabs and move them to another Group in one action, instead of one at a time.                                                                                                       |

**Roadmap**

- Drag-and-drop: no concrete plan or design yet.

## Navigation & search

| Capability                                                                            | Status | Value                                                                                                                                                                                                                                                                 |
| ------------------------------------------------------------------------------------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sidebar / quick workspace switcher (Areas → Projects → Groups)                        | ✅     | A persistent, collapsible rail tree plus a collapsed-rail quick-switcher dropdown — switching is a click, not a scroll-and-read.                                                                                                                                      |
| Double-click to switch to a Project/Group, with a hover tooltip hint                  | ✅     | Replaces per-row icon buttons that cluttered every row — the gesture is discoverable on hover, and the row stays visually clean until you need it.                                                                                                                    |
| Right-click context menu (Rename, Archive, Disconnect, Delete) on a Project/Group row | ✅     | Same row-cleanliness motivation as above — secondary actions live one gesture away instead of as permanent icon clutter.                                                                                                                                              |
| Command palette (⌘K) across Groups/Projects/Areas and their tabs                      | ✅     | At any real scale (dozens of workspaces, hundreds of tabs), typing beats browsing — this is the "I know what I'm looking for" path the sidebar doesn't serve.                                                                                                         |
| Command palette search across Session history                                         | 🚧     | Searches only the local 7-day Session cache — a session older than that exists in Supabase but won't surface in search today. The whole motivation for Sessions ("never afraid of losing something") isn't fully delivered until this works against the full archive. |
| Display preferences (show domains, grid vs. list, search scope)                       | ❌     | Small, but each is a real per-user preference — e.g. scoping search to "this workspace" avoids noise once there are many workspaces.                                                                                                                                  |

**Roadmap**

- Full-history session search is the next concrete piece of work: a
  debounced, online-only Supabase query against the `sessions` table
  (`ilike`/`tsvector` match against `windows`), triggered from the palette
  when a query doesn't resolve against the local cache, with a visible
  loading state and a silent fallback to "local results only" when offline.
  This was explicitly scoped out of the initial Sessions build, not
  forgotten — see the Sessions section below.
- Display preferences: no concrete plan yet.

## Native tab groups

Mirrors cntxt's workspace model onto the browser's own native tab-groups
feature (Chrome/Edge since Chrome 89; Firefox since 138/139+) — both
directions: cntxt state shows up as a real browser tab group, and a
manually-created browser tab group becomes cntxt state.

| Capability                                                                                                | Status | Value                                                                                                                                                                         |
| --------------------------------------------------------------------------------------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Mirror a Group's or Project's live tabs into a native browser tab group (title + color)                   | ✅     | The browser's own UI (tab strip, window switcher) shows the same organization cntxt already tracks — no second mental model to hold.                                          |
| Silent capture: a new native tab group inside a Project-bound window becomes a nested Group automatically | ✅     | The "silent hero" UX — grouping tabs the normal, native way is itself the organizing action; no cntxt-specific step required to get a real, synced, reopenable Group from it. |
| Rules: teach a native group's title/color to always file into a specific Project                          | ✅     | Saves re-filing a recurring kind of group (e.g. always-grey "Research" groups) under the right Project every time it reappears, without re-deciding each time.                |
| Reverse name sync (a user-typed native group rename updates the Group's stored name)                      | ✅     | Renaming is as natural to do from the tab strip as from the dashboard — either one should stick, not just get silently reverted on the next sync.                             |
| Reverse color sync (a user-picked native group color updates the Group's stored color)                    | ❌     | Mirroring is one-directional (cntxt → native) once a group is owned; a native recolor gets silently overwritten back to the Group's own color on the next sync.               |
| Capture inside a standalone Group-bound window (not nested under a Project)                               | ❌     | A standalone Group's whole window is already one native group via mirroring; a second group appearing inside it has no defined meaning yet.                                   |
| Rule management UI (list, edit, delete existing rules)                                                    | ❌     | Rules can only be created (via a group's right-click menu); there's no way to see or remove one once taught, short of clearing extension storage.                             |

**Roadmap**

- Reverse color sync: deliberately deferred — would need a 9→5 lossy
  mapping back from the browser's native color enum onto cntxt's 5 semantic
  colors; not planned unless it becomes a real complaint.
- Standalone-Group capture: no clean semantic defined yet for "a second
  group inside a window that's already entirely one group" — needs a
  product decision before it's buildable.
- Rule management UI: natural next step if the teach-a-rule flow sees real
  use; not started.

## History: Sessions

An automatic, periodic, append-only record of what was open — "never
afraid of losing something," the Timing.app-style passive-capture idea
applied to browser state rather than Group/Project status.

| Capability                                                                                        | Status         | Value                                                                                                                                                                            |
| ------------------------------------------------------------------------------------------------- | -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Automatic capture of every open, cntxt-bound window into one history record, every ~15 minutes    | ✅             | No manual "save a session" step — it just accumulates in the background, deduplicated against the last capture so idling doesn't spam history.                                   |
| A Session survives the Group/Project it references being deleted or purged                        | ✅             | History stays a true record even after the thing it was about is gone — the entity's name is snapshotted onto the session, not looked up live.                                   |
| Restore a past Session (reopen all of its windows at once)                                        | ✅             | The payoff for the record existing at all — not just a log you can read, but one you can act on.                                                                                 |
| Full-text search across _all_ session history (not just the recent local cache)                   | 🚧             | See the Navigation & search section above — this is the one piece that would make the "never lose it" promise actually true at any time horizon.                                 |
| Session browsing beyond a flat recent-first list (filter by date, by Project, group by day, etc.) | ❌             | Today's History view is a flat list of the local cache; nothing beyond "newest first" exists yet.                                                                                |
| Any retention/deletion of Session history, ever                                                   | ❌ (by design) | Explicit non-goal — unlike Trash, a Session is never auto-purged server-side. Only the _local_ cache is bounded (7 days), purely as a storage-size measure, not a data-loss one. |

**Roadmap**

- Full-history search: see Navigation & search above — this is the next
  concrete piece of work on Sessions.
- Session browsing/filtering: no concrete plan yet; low priority until
  search (above) makes finding a specific session actually practical.
- Not yet manually verified end-to-end in a real browser (Chrome/Edge/
  Firefox) — the implementation is unit-tested and builds clean on all
  three targets, but the manual checklist in the Sessions+Archive
  implementation plan hasn't been run yet.

## Sync & collaboration

See [`architecture-sync.md`](./architecture-sync.md) for the local-first
sync design (diagrams included) behind the rows below.

| Capability                                                                 | Status       | Value                                                                                                                                                                                                                                                                                                                    |
| -------------------------------------------------------------------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Account/auth                                                               | ✅ (Phase 2) | Prerequisite for anything cross-device — without an identity, "your Groups/Projects" can only ever mean "this browser profile."                                                                                                                                                                                          |
| Cross-device sync of Groups/Projects/Resources (Supabase, last-write-wins) | ✅ (Phase 2) | The extension was single-machine originally; sync is what makes a saved Group/Project follow you to a laptop, not just survive a restart.                                                                                                                                                                                |
| Cross-device sync of Session history (Supabase, insert-only, no conflicts) | ✅           | Deliberately a different, simpler sync shape than Groups/Folders — a Session is immutable after capture, so there's no last-write-wins merge logic to write.                                                                                                                                                             |
| Background-driven periodic sync (works with the dashboard closed)          | 🚧           | Session capture itself already runs fully in the background via a `browser.alarms` timer. Group/Folder/Resource pull-sync is still tied to the dashboard page being open (a 5-minute in-page timer) — the permission needed to fix this (`"alarms"`) now exists (added for Sessions) but the migration hasn't been done. |
| Shared/team workspaces                                                     | ❌ (Phase 3) | Turns cntxt from a personal tool into one a team can use to hand off or co-own a set of tabs — the point at which it becomes a paid product per the roadmap.                                                                                                                                                             |

**Roadmap**

- Move `sync.ts`'s periodic pull from an in-dashboard timer to a
  `browser.alarms`-driven background one now that the permission exists —
  explicitly scoped out of the Sessions work as a separate, larger refactor
  (the pull target changes from "whatever the dashboard's hook is doing" to
  a background path with nowhere to report `lastPullCount`/`lastError`).
  No other blocker; this is ready to pick up.
- Shared/team workspaces: Phase 3, unstarted — see `ROADMAP.md`.
