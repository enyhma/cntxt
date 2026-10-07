# Capabilities

What cntxt can do today, what it can't yet, and why each capability matters.
Sourced from the current `extension/` code, `ROADMAP.md`, and the
`Workspace Dashboard v2` UI design. Update this alongside the roadmap as
things ship — it's a snapshot, not a contract.

Legend: ✅ Implemented · 🚧 Partially implemented · ❌ Not implemented

See [`workflows.md`](./workflows.md) for how each ✅ capability actually
works step by step (sequence diagrams traced from the code), and rough
usage scenarios for the ❌ ones.

## Capture & restore (core loop)

| Capability                                                                                                                                         | Status | Value                                                                                                                                                                                                             |
| -------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Save a window's tabs as a Project                                                                                                                  | ✅     | The whole product's job in one feature — turns an ephemeral browser window into something you can put down and pick back up.                                                                                      |
| Live tab sync (a Project/Quest mirrors its window automatically)                                                                                   | ✅     | No manual "save" step to remember — you can't lose a session mid-work because it was never in an unsaved state.                                                                                                   |
| Close all tabs, keep the Project/Quest                                                                                                             | ✅     | Lets you reclaim screen/memory without a save dialog or a fear of losing what you were doing.                                                                                                                     |
| Restore a Project or Quest into the current window                                                                                                 | ✅     | One click back into a saved context — the payoff for having saved it.                                                                                                                                             |
| Rename a Project or Quest                                                                                                                          | ✅     | Saved sets accumulate; a name is what makes picking the right one later fast instead of guesswork.                                                                                                                |
| Delete a Quest (soft-delete, with a Trash view and retention window)                                                                               | ✅     | Keeps the list from becoming permanent clutter, without an accidental delete being unrecoverable.                                                                                                                 |
| Multiple windows, each its own Project or Quest, tracked concurrently                                                                              | ✅     | Matches how people actually work (several projects open at once) instead of forcing one active workspace globally.                                                                                                |
| Resume last-used Project/Quest on browser startup                                                                                                  | ✅     | Removes a manual "reopen where I left off" step after every restart.                                                                                                                                              |
| A Quest nested under a Project: swap its tabs into the Project's window, complete it (closed but reopenable), auto-advance to the next pending one | ✅     | A short-lived side task (a "side quest") that belongs to a Project without needing its own window, and without losing its tab list once you're done with it for now.                                              |
| "Open all" into a _new_ window (Restore without replacing current tabs)                                                                            | ❌     | Today Restore always replaces the current window's tabs; there's no way to pull a saved Project/Quest up alongside what's already open.                                                                           |
| Manually-added links/notes as resources                                                                                                            | ✅     | Lets a Quest or a Section hold reference material that was never an open tab (a doc link, a note), not just live-tab snapshots.                                                                                   |
| Archive (put a Quest aside without deleting it)                                                                                                    | ❌     | Present as a sidebar link in the design, unbuilt — separates "not right now" from "gone for good" without the list growing forever. Completing a Project-nested Quest (above) covers a related but narrower case. |

## Organization

| Capability                                                   | Status | Value                                                                                                                                                                                                                                                                                                |
| ------------------------------------------------------------ | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Area / Project / Quest hierarchy, explicit `kind` per Folder | ✅     | Groups Projects under an Area, and lets a Quest nest under a Project (or an Area, or stay ungrouped) — the structural answer to "a flat workspace list doesn't scale."                                                                                                                               |
| Section (a Project's sub-folder holding resources, not tabs) | ✅     | Lets a link/note outlive the Quest it was saved from — a different thing from the row below, which was a separate, never-built proposal (see note).                                                                                                                                                  |
| ~~Sections/groups within a workspace (tab grouping)~~        | ❌     | **Superseded, not just unbuilt.** This row originally meant grouping _tabs_ within one flat workspace (e.g. "Specs" vs "Staging"); what shipped instead is the Section above — a resource-holding Folder tier, not a tab grouping. Tab-level grouping within a single Quest/Project remains unbuilt. |
| Color-coding (a Project, Quest, or Area)                     | ✅     | Fast visual scanning in a sidebar/list once there are more than 3-4 — color, not just text, is what you recognize at a glance.                                                                                                                                                                       |
| Drag-and-drop tabs between sections/workspaces               | ❌     | Reorganizing currently requires no UI at all (not supported) — this is the difference between tidying as you go vs. never tidying.                                                                                                                                                                   |
| Multi-select + bulk move tabs                                | ✅     | Select several of a Quest's tabs and move them to another Quest in one action, instead of one at a time.                                                                                                                                                                                             |

## Navigation & search

| Capability                                                              | Status | Value                                                                                                                                                                 |
| ----------------------------------------------------------------------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sidebar / quick workspace switcher                                      | ✅     | A persistent, collapsible rail tree (Areas → Projects → Sections/Quests) plus a collapsed-rail quick-switcher dropdown — switching is a click, not a scroll-and-read. |
| Command palette (⌘K) across workspaces/sections/tabs                    | ✅     | At any real scale (dozens of workspaces, hundreds of tabs), typing beats browsing — this is the "I know what I'm looking for" path the sidebar doesn't serve.         |
| Display preferences (show domains, section grid vs. list, search scope) | ❌     | Small, but each is a real per-user preference in the design (e.g. scoping search to "this workspace" avoids noise once there are many workspaces).                    |

## Live-open-tabs panel

| Capability                                               | Status | Value                                                                                                                                                                                                                                                                         |
| -------------------------------------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Per-tab manual "Save" from a list of currently-open tabs | ❌     | **Conflicts with the current model**: a Project/Quest auto-syncs from its window, so there's nothing "unsaved" to save. Building this as designed would mean deciding whether some windows should _stop_ auto-attaching to a Project — a product decision, not just a UI gap. |

## Sync & collaboration

See [`architecture-sync.md`](./architecture-sync.md) for the local-first
sync design (diagrams included) behind the two shipped rows below.

| Capability                   | Status       | Value                                                                                                                                                        |
| ---------------------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Account/auth                 | ✅ (Phase 2) | Prerequisite for anything cross-device — without an identity, "your Quests/Projects" can only ever mean "this browser profile."                              |
| Cross-device sync (Supabase) | ✅ (Phase 2) | The extension was single-machine originally; sync is what makes a saved Quest/Project follow you to a laptop, not just survive a restart.                    |
| Shared/team workspaces       | ❌ (Phase 3) | Turns cntxt from a personal tool into one a team can use to hand off or co-own a set of tabs — the point at which it becomes a paid product per the roadmap. |
