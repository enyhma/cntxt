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

| Capability                                                              | Status | Value                                                                                                                                         |
| ----------------------------------------------------------------------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Save a window's tabs as a named workspace                               | ✅     | The whole product's job in one feature — turns an ephemeral browser window into something you can put down and pick back up.                  |
| Live tab sync (workspace mirrors its window automatically)              | ✅     | No manual "save" step to remember — you can't lose a session mid-work because it was never in an unsaved state.                               |
| Close all tabs, keep the workspace                                      | ✅     | Lets you reclaim screen/memory without a save dialog or a fear of losing what you were doing.                                                 |
| Restore a workspace into the current window                             | ✅     | One click back into a saved context — the payoff for having saved it.                                                                         |
| Rename a workspace                                                      | ✅     | Saved sets accumulate; a name is what makes picking the right one later fast instead of guesswork.                                            |
| Delete a workspace                                                      | ✅     | Keeps the list from becoming permanent clutter.                                                                                               |
| Multiple windows, each its own workspace, tracked concurrently          | ✅     | Matches how people actually work (several projects open at once) instead of forcing one active workspace globally.                            |
| Resume last-used workspace on browser startup                           | ✅     | Removes a manual "reopen where I left off" step after every restart.                                                                          |
| "Open all" into a _new_ window (Restore without replacing current tabs) | ❌     | Today Restore always replaces the current window's tabs; there's no way to pull a saved workspace up alongside what's already open.           |
| Manually-added links/notes as workspace resources                       | ❌     | Roadmap Phase 1 item — lets a workspace hold reference material that was never an open tab (a doc link, a note), not just live-tab snapshots. |
| Archive (put a workspace aside without deleting it)                     | ❌     | Present as a sidebar link in the design, unbuilt — separates "not right now" from "gone for good" without the list growing forever.           |

## Organization

| Capability                                     | Status | Value                                                                                                                                                                           |
| ---------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sections/groups within a workspace             | ❌     | Biggest structural gap vs. the design — right now a workspace is a flat tab list; grouping (e.g. "Specs" vs "Staging") is how a workspace stays legible past a handful of tabs. |
| Color-coding (workspace or section)            | ❌     | Fast visual scanning in a sidebar/list once there are more than 3-4 workspaces — color, not just text, is what you recognize at a glance.                                       |
| Drag-and-drop tabs between sections/workspaces | ❌     | Reorganizing currently requires no UI at all (not supported) — this is the difference between tidying as you go vs. never tidying.                                              |
| Multi-select + bulk move tabs                  | ❌     | Moving 5 tabs to another workspace one at a time is the kind of friction that makes people give up on organizing altogether.                                                    |

## Navigation & search

| Capability                                                              | Status | Value                                                                                                                                                                |
| ----------------------------------------------------------------------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sidebar / quick workspace switcher                                      | ❌     | Current UI is a single flat page (current workspace card + a list below); a persistent rail is what makes switching workspaces a click instead of a scroll-and-read. |
| Command palette (⌘K) across workspaces/sections/tabs                    | ❌     | At any real scale (dozens of workspaces, hundreds of tabs), typing beats browsing — this is the "I know what I'm looking for" path the sidebar doesn't serve.        |
| Display preferences (show domains, section grid vs. list, search scope) | ❌     | Small, but each is a real per-user preference in the design (e.g. scoping search to "this workspace" avoids noise once there are many workspaces).                   |

## Live-open-tabs panel

| Capability                                               | Status | Value                                                                                                                                                                                                                                                                       |
| -------------------------------------------------------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Per-tab manual "Save" from a list of currently-open tabs | ❌     | **Conflicts with the current model**: workspaces auto-sync from their window, so there's nothing "unsaved" to save. Building this as designed would mean deciding whether some windows should _stop_ auto-attaching to a workspace — a product decision, not just a UI gap. |

## Sync & collaboration (future phases, per `ROADMAP.md`)

See [`architecture-sync.md`](./architecture-sync.md) for the local-first
sync design (diagrams included) behind the two Phase 2 rows below.

| Capability                   | Status       | Value                                                                                                                                                        |
| ---------------------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Account/auth                 | ❌ (Phase 2) | Prerequisite for anything cross-device — without an identity, "your workspaces" can only ever mean "this browser profile."                                   |
| Cross-device sync (Supabase) | ❌ (Phase 2) | The extension is single-machine today; sync is what makes a saved workspace follow you to a laptop, not just survive a restart.                              |
| Shared/team workspaces       | ❌ (Phase 3) | Turns cntxt from a personal tool into one a team can use to hand off or co-own a set of tabs — the point at which it becomes a paid product per the roadmap. |
