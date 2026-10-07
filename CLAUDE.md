# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

cntxt: a browser workspace manager built around two entity tiers. **Project** is the persistent, window-bound workspace — opening a window opens (or creates) a Project, same role "workspace"/"Mission" used to play alone. **Quest** is a short-lived sub-workspace: it can live standalone (its own window, same as a Project) or nest under a Project, in which case activating it swaps its own tabs into that Project's already-open window, and completing it closes those tabs (without ever clearing its saved tab list — it stays reopenable) and auto-advances to the next pending sibling. Area and Section are purely organizational: Area groups Projects, Section (nested under a Project) holds manually-saved resources (links/notes), not tabs. See `ROADMAP.md` for the phased plan and explicit non-goals — Phase 1 (local-only extension) is where almost all current work lives; Supabase sync (`supabase/`) exists and is wired up (entitlements/quota, Row-Level Security, push/pull), but the web dashboard (`web/`) is excluded from this workspace and not kept in sync with it (see below).

This is a pnpm workspace (`pnpm-workspace.yaml` lists only `extension` and `packages/*`). These directories exist at the root:

- **`extension/`** — the WXT/SolidJS browser extension. This is the real, actively-developed codebase; everything below describes it.
- **`packages/ui/`** — shared SolidJS components (`@cntxt/ui`) used by the extension's dashboard.
- **`marketing/`** — an unmodified Astro "minimal" starter, not part of the pnpm workspace (own lockfile/dependencies). Nothing project-specific in it yet.
- **`supabase/`** — the Phase 2 sync backend: Postgres schema + RLS policies + a couple of `security definer` RPCs (quota-checked creation), managed as timestamped SQL migrations under `supabase/migrations/`.
- **`web/`** — a separate, minimal standalone dashboard (SolidJS, its own `package.json`) that reads the same Supabase tables directly. Deliberately **excluded** from `pnpm-workspace.yaml`: it still uses pre-rename "Workspace" naming (`workspaces.ts`, `WorkspaceList.tsx`, queries against tables/columns that no longer exist post-restructuring) and was never updated alongside either the Mission rename or the Project/Quest restructuring. Treat it as out of sync until someone deliberately picks it back up.

## Commands

Root (tooling shared across the repo):

- `pnpm lint` — eslint over the whole repo
- `pnpm format` / `pnpm format:check` — prettier over the whole repo
- `pnpm release` / `pnpm release:dry` — semantic-release; `pkgRoot` is `extension`, so `extension/package.json`'s version is what actually gets bumped/published

Extension (`cd extension`):

- `pnpm dev` / `pnpm dev:firefox` — WXT dev server
- `pnpm build` / `pnpm build:firefox` — build to `.output/<target>` (e.g. `.output/chrome-mv3`)
- `pnpm zip` / `pnpm zip:firefox`
- `pnpm compile` — `tsc --noEmit`
- `pnpm test` — `vitest run`; single file: `pnpm exec vitest run utils/restoreMachine.test.ts`; watch mode: `pnpm exec vitest`

Commits are gated by lefthook (`lefthook.yml`): pre-commit runs `eslint .` and `prettier --check .` across the **entire repo**, not just staged files — a failure in `marketing/` or `supabase/` will block a commit that only touches `extension/`. Commit-msg runs commitlint (conventional commits required): every commit message must follow Conventional Commits (`type(scope): subject`, e.g. `feat(extension): ...`, `chore: ...`, `docs: ...`) since `pnpm release` (semantic-release) derives the version bump from these types. This doesn't require splitting unrelated work into separate commits, but when a change set spans genuinely different types (e.g. a `chore` alongside a `docs` change), commit them separately rather than picking one type to cover both.

## Architecture (`extension/`)

Manifest V3, built with WXT + SolidJS + Tailwind v4 (`@tailwindcss/vite` wired into `wxt.config.ts`).

- **No popup.** The UI lives at `entrypoints/dashboard/`, deliberately not named `popup/` so WXT treats it as a plain unlisted page instead of wiring it to `manifest.action.default_popup`. `wxt.config.ts` sets `manifest.action = {}` (icon, no popup), which lets `background.ts` handle `action.onClicked` itself: it opens/focuses a pinned dashboard tab in whichever window the icon was clicked in, rather than showing a popup.

### Entities

- **`Folder`** (`utils/folders.ts`) is one self-referencing type backing three organizational tiers, distinguished by an explicit `kind: "area" | "project" | "section"` (not nesting depth — a `kind:"project"` Folder can have `parentId: null`, an ad-hoc window-created Project, which depth alone couldn't tell apart from an Area). A `kind:"project"` Folder is also window-bound: it carries its own `tabs` and an `activeQuestId` (which child Quest, if any, currently has its tabs swapped into this Project's window in place of its own). Area and Section never populate those two fields.
- **`Quest`** (`utils/quests.ts`) is a short-lived sub-workspace: its own full `tabs` list, a `status` ("pending"|"active"|"done"), and an `order` among siblings sharing the same `folderId`. A Quest's `folderId` can point to a Project, an Area, or be unset (ungrouped) — nesting under a Project is what makes it swap into that Project's window instead of getting its own; otherwise it behaves like a standalone window-bound workspace, same as a Project. Completing a Quest (closing its tabs) never clears its `tabs` — it's a status, not a deletion, so it's reopenable later via the same activation path.
- **`Resource`** (`utils/resources.ts`) is a manually-saved link/note, parented to exactly one of a Quest (`questId`) or a Section (`folderId`) — never both, enforced at the call site, not the type.

### Window binding

- **Every window is a workspace, and an unbound workspace is a Project.** `utils/attach.ts`'s `ensureBindingForWindow` maps a window to a `WindowBinding` (`utils/session.ts`: `{kind:"project", projectId}` or `{kind:"quest", questId}`) — creating an "Untitled Project" from its current tabs if it has none yet, or reattaching to `settings.lastActiveBinding` when `settings.startupBehavior === "lastUsed"` and that binding isn't already open in another window. The window→binding map lives in `browser.storage.session`, deliberately session-scoped since window ids aren't stable across browser restarts.
- **Background is a registry of per-window xstate actors.** `entrypoints/background.ts` spawns one `utils/windowSyncMachine.ts` actor per open window (on `runtime.onStartup` and on icon-click), stopping it on `windows.onRemoved`. Each actor re-syncs its window's tabs on every `tabs.onCreated/onRemoved/onUpdated/onMoved` into whichever target its binding currently resolves to: a standalone Quest's `tabs`, a Project's own `tabs`, or — if the Project has an `activeQuestId` — that child Quest's `tabs` instead (`utils/projectLiveTabs.ts`'s `resolveProjectLiveTarget` is the shared resolution logic). The actor registry is in-memory but MV3 service workers restart often (idle unload, etc.), so `background.ts` rehydrates it from the persisted session map every time the worker callback runs — that rehydration is load-bearing, not incidental.
- `windowSyncMachine` deliberately does **not** cache the binding in its context: it re-reads the window→binding mapping (and a Project's `activeQuestId`) from storage on every sync, because the dashboard can reassign either independently of the background script, and a cached value would go stale.
- **`utils/restoreMachine.ts`** is a second xstate machine, used from the dashboard, that gates the window-mutating actions that change a window's _binding_ — "Close all tabs", "Restore" (to a `RestoreTarget`: `{kind:"project",...}` or `{kind:"quest",...}`), "Disconnect", and a standalone Quest's "Complete quest" — through shared `closingTabs`/`openingTabs` states so a double-click can't overlap them. Restoring into the current window detaches the outgoing binding (`removeWindowBinding`) _before_ closing its tabs — closing tabs while still bound is exactly what live-sync should do for a plain close (it correctly records that target as now empty), but during a _switch_ it would incorrectly zero out the one being left behind. This ordering is covered by `utils/restoreMachine.test.ts`.
- **`utils/questSwapMachine.ts`** is a third xstate machine, used only for a Quest nested under a Project: `ACTIVATE_QUEST`/`COMPLETE_QUEST` close whatever's currently open and swap in the target quest's own tab list, changing only that Project's `activeQuestId` — the window's `WindowBinding` never moves (unlike `restoreMachine`'s events), since the window stays bound to the Project throughout. Completing one auto-advances to the next `pending` sibling by `order`, if any.
- **Persisted stores:** `utils/quests.ts` (CRUD over `storage.local["quests"]`), `utils/folders.ts` (`storage.local["folders"]`), and `utils/settings.ts` (`storage.local["settings"]`: `startupBehavior`, `lastActiveBinding`). `utils/tabs.ts` holds the shared `DASHBOARD_URL` constant plus `snapshotTabs`/`ensureDashboardTab`, used by both `background.ts` and the dashboard.
- The dashboard subscribes to `browser.storage.onChanged` and just re-fetches everything on any change — there's no per-key diffing, so any write to the stores above will refresh the UI.

### Sync (Supabase)

Each local store has a Supabase-backed counterpart, pushed/pulled via `utils/sync.ts`'s xstate machine: `quests` and `folders` tables (self-registering on create via `registerQuest`/`registerFolder`, best-effort and never awaited — see each function's own comments), plus a `resources` table. Project and Quest creation both go through quota-gated `security definer` RPCs (`create_project`/`create_quest`) sharing one pool (`count_workspace_like()`) against `entitlements.max_workspaces`, so an ad-hoc window-created Project can't become a free, unlimited way around the plan's per-account limit. See `supabase/migrations/` for the schema history and each migration's own comments for the reasoning behind specific choices (e.g. why Folder is one table instead of three, why a Project's quota shares Quest's pool).

## Testing

- Vitest with WXT's official setup: `WxtVitest()` (from `wxt/testing/vitest-plugin`) in `vitest.config.ts`, `fakeBrowser` (from `wxt/testing/fake-browser`) reset in `beforeEach`.
- `extension/test/setup.ts` patches a real bug in `@webext-core/fake-browser@2.0.1` (latest published version at the time this was written): its `tabs.remove()` resolves the removed tab's window via the tab's _own_ id instead of `tab.windowId`, which throws as soon as a window has more than one tab. The patch removes ids one at a time, capturing the real `windowId` first and re-firing `onRemoved` correctly. If tab-removal tests start throwing `Cannot read properties of undefined (reading 'id')`, look here first (and check whether upstream has since fixed it).
- Tests covering the tab-sync/restore logic spawn a real `windowSyncMachine` actor and wire it to `tabs.onCreated`/`onRemoved` (see `restoreMachine.test.ts`, `questSwapMachine.test.ts`), mirroring what `background.ts` does in production. Without that, such tests can pass vacuously — nothing else in an isolated test is live-syncing tabs back onto a target, so a broken ordering fix wouldn't actually be caught.
- Only unit tests (above) exist so far. WXT's other documented testing methods, not yet set up here:
  - [E2E testing](https://wxt.dev/guide/essentials/e2e-testing.html) — Playwright driving the built extension from `.output/chrome-mv3`; no fake-browser involved.
  - [Testing updates](https://wxt.dev/guide/essentials/testing-updates.html) — covers `runtime.onInstalled` (`reason === "update"`) logic and permission-change behavior on updates via each browser's extension-update tooling. Not applicable yet: there's no `onInstalled` listener in this codebase.
  - [Unit testing](https://wxt.dev/guide/essentials/unit-testing.html) — the guide the current Vitest setup follows.
