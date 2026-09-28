# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

cntxt: a Workona-style browser workspace manager (save a window's tabs as a named workspace, close it, restore it later). See `ROADMAP.md` for the phased plan and explicit non-goals — Phase 1 (local-only extension) is where almost all current work lives; Phase 2 (sync via Supabase) and Phase 3 (team) are not built yet.

This is a pnpm workspace (`pnpm-workspace.yaml` lists only `extension`). Three directories exist at the root:

- **`extension/`** — the WXT/SolidJS browser extension. This is the real, actively-developed codebase; everything below describes it.
- **`marketing/`** — an unmodified Astro "minimal" starter, not part of the pnpm workspace (own lockfile/dependencies). Nothing project-specific in it yet.
- **`supabase/`** — a fresh `supabase init` scaffold for the not-yet-started Phase 2 sync backend.

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
- **Every window is a workspace.** `utils/attach.ts`'s `ensureWorkspaceForWindow` maps a window to a workspace id — creating an "Untitled" one from its current tabs if it has none yet, or reattaching to `settings.lastActiveWorkspaceId` when `settings.startupBehavior === "lastUsed"` and that workspace isn't already open in another window. The window→workspace mapping lives in `browser.storage.session` (`utils/session.ts`), deliberately session-scoped since window ids aren't stable across browser restarts.
- **Background is a registry of per-window xstate actors.** `entrypoints/background.ts` spawns one `utils/workspaceWindowMachine.ts` actor per open window (on `runtime.onStartup` and on icon-click), stopping it on `windows.onRemoved`. Each actor re-syncs its window's tabs into its mapped workspace on every `tabs.onCreated/onRemoved/onUpdated/onMoved`. The actor registry is in-memory but MV3 service workers restart often (idle unload, etc.), so `background.ts` rehydrates it from the persisted session map every time the worker callback runs — that rehydration is load-bearing, not incidental.
- `workspaceWindowMachine` deliberately does **not** cache `workspaceId` in its context: `syncTabs` re-reads the window→workspace mapping from session storage on every sync, because the dashboard can reassign a window to a different workspace (Restore) independently of the background script, and a cached id would go stale.
- **`utils/restoreMachine.ts`** is a second xstate machine, used from the dashboard, that gates the two window-mutating actions — "Close all tabs" and "Restore" — through shared `closingTabs`/`openingTabs` states so a double-click can't overlap them. Restoring into the current window detaches the outgoing workspace (`removeWindowWorkspace`) _before_ closing its tabs — closing tabs while still mapped to a workspace is exactly what live-sync should do for a plain close (it correctly records that workspace as now empty), but during a _switch_ it would incorrectly zero out the workspace being left behind. This ordering is covered by `utils/restoreMachine.test.ts`.
- **Persisted stores:** `utils/workspaces.ts` (CRUD over `storage.local["workspaces"]`) and `utils/settings.ts` (`storage.local["settings"]`: `startupBehavior`, `lastActiveWorkspaceId`). `utils/tabs.ts` holds the shared `DASHBOARD_URL` constant plus `snapshotTabs`/`ensureDashboardTab`, used by both `background.ts` and the dashboard.
- The dashboard subscribes to `browser.storage.onChanged` and just re-fetches everything on any change — there's no per-key diffing, so any write to the stores above will refresh the UI.

## Testing

- Vitest with WXT's official setup: `WxtVitest()` (from `wxt/testing/vitest-plugin`) in `vitest.config.ts`, `fakeBrowser` (from `wxt/testing/fake-browser`) reset in `beforeEach`.
- `extension/test/setup.ts` patches a real bug in `@webext-core/fake-browser@2.0.1` (latest published version at the time this was written): its `tabs.remove()` resolves the removed tab's window via the tab's _own_ id instead of `tab.windowId`, which throws as soon as a window has more than one tab. The patch removes ids one at a time, capturing the real `windowId` first and re-firing `onRemoved` correctly. If tab-removal tests start throwing `Cannot read properties of undefined (reading 'id')`, look here first (and check whether upstream has since fixed it).
- Tests covering the tab-sync/restore logic spawn a real `workspaceWindowMachine` actor and wire it to `tabs.onCreated`/`onRemoved` (see `restoreMachine.test.ts`), mirroring what `background.ts` does in production. Without that, such tests can pass vacuously — nothing else in an isolated test is live-syncing tabs back onto a workspace, so a broken ordering fix wouldn't actually be caught.
- Only unit tests (above) exist so far. WXT's other documented testing methods, not yet set up here:
  - [E2E testing](https://wxt.dev/guide/essentials/e2e-testing.html) — Playwright driving the built extension from `.output/chrome-mv3`; no fake-browser involved.
  - [Testing updates](https://wxt.dev/guide/essentials/testing-updates.html) — covers `runtime.onInstalled` (`reason === "update"`) logic and permission-change behavior on updates via each browser's extension-update tooling. Not applicable yet: there's no `onInstalled` listener in this codebase.
  - [Unit testing](https://wxt.dev/guide/essentials/unit-testing.html) — the guide the current Vitest setup follows.
