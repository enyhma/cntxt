# Implementation plan: accounts, entitlements & sync

**Status: plan, nothing started.** Turns
[`architecture-sync.md`](./architecture-sync.md) into ordered, checkable
work. Read that doc first — this one assumes its diagrams and doesn't
re-argue them.

## Ground rule: the server stays dumb

Every milestone below defaults to a plain Postgres table + RLS policy read
or write through PostgREST, because that's what "dumb" means here — no
process of ours sits between the extension and the database. The plan
allows exactly **two** exceptions, named explicitly in M2 and M9, and
nowhere else. Both exist because an operation genuinely cannot be done as a
bare client-side table call (an atomic check-and-write; an inbound request
with no user session to run through RLS) — not because they were
convenient. If a later step is tempted to add a third, that's a sign the
step belongs in `architecture-sync.md`'s "Open design questions" for a
rethink, not a quiet exception.

Concretely, this plan never adds:

- A standalone API server (Node, or anything else) sitting in front of
  Supabase.
- Supabase Edge Functions, beyond the one M9 needs to receive Creem
  webhooks (Postgres has no notion of an inbound HTTP endpoint — this one
  isn't optional, unlike a "just in case" Edge Function would be).
- A "rules engine" or generalized entitlement-evaluation service — each
  entitlement that needs enforcing gets its own small SQL function, written
  when that entitlement is actually built, not speculatively.
- Application-level authorization checks duplicating what RLS already does.

## M0 — Supabase project wiring

Infra only, no product code.

- [ ] Reuse the already-linked project (`supabase/.temp/linked-project.json`)
      — don't create a second one.
- [ ] Enable email magic link + Google OAuth providers in Supabase Auth
      settings (dashboard config, not code).
- [ ] Apply the existing migration
      (`supabase/migrations/20260912040442_init_workspaces.sql`) — it's
      already dumb as written: one table, RLS policies, no functions.

## M1 — Entitlements schema

**Status: done.** Migration `20260912162121_entitlements.sql`, tested
locally via `supabase test db --local` (pgTAP,
`supabase/tests/entitlements_test.sql`).

- [x] `entitlements` table, one row per `user_id`: `max_workspaces int not
null default 10`, `access_expires_at timestamptz` (null until a
      purchase sets it — see M8/M9). _(ponytail: no `plans` table — a flat
      per-user row with hardcoded free-tier defaults, until there's a
      second tier to differentiate.)_
- [x] RLS: owner can `select` their row; no insert/update/delete policy
      exists, so PostgREST default-denies all writes. Verified by test, not
      just asserted: a direct `update` from the owning `authenticated` role
      silently affects 0 rows.
- [x] `on_auth_user_created` trigger (`security definer`) seeds the default
      row on signup. Verified: a fresh `auth.users` insert produces a
      matching `entitlements` row with the default limit.

## M2 — The one exception: `create_workspace`

**Status: done.** Migration `20260912162121_entitlements.sql`, tests in
`supabase/tests/`.

- [x] One `plpgsql` function, `security definer` — **not** `invoker` as
      originally planned here. `entitlements` deliberately has no UPDATE
      policy (read-only to clients), but the row lock this function needs
      (`select ... for update`) requires one anyway: under RLS, `SELECT ...
FOR UPDATE` checks the UPDATE policy's `USING` clause, not just
      SELECT's, since locking implies a potential update. TDD caught this
      directly — the first test run under `invoker` silently let a caller
      exceed their limit, because the lock matched zero rows and the limit
      check was skipped rather than erroring. `security definer` runs as
      the function's owner, which bypasses RLS the same way any table owner
      does, so ownership is enforced explicitly via `auth.uid()` inside the
      function instead of through the `workspaces` policy.
- [x] Body: lock the caller's `entitlements` row (`for update`), count
      their workspaces, compare to the limit, insert-and-return on success,
      raise otherwise.
- [x] Exposed automatically as `supabase.rpc('create_workspace', {...})` —
      PostgREST does this for free once the function exists; no extra
      server-side wiring.
- [x] pgTAP tests (`supabase/tests/create_workspace_test.sql`,
      `entitlements_test.sql`) written before the migration, red then
      green: under-limit success, ownership via `auth.uid()` not a
      client-supplied id, at-limit rejection, RLS read/write behavior on
      `entitlements`.
- [x] Concurrency check (`supabase/tests/concurrent_create_workspace.sh`) —
      pgTAP can't exercise two genuinely concurrent backends in one script,
      so this fires two real `psql` connections at a user with exactly one
      slot free. Confirmed: one succeeds, one is rejected, final count is
      exactly the limit — not limit+1.

## M3 — Extension: auth gate

**Status: done**, with one honest caveat below.

- [x] `@supabase/supabase-js` added to `extension/package.json`.
- [x] `utils/supabaseStorage.ts`: the `window.localStorage`-shaped adapter
      `supabase-js` needs, backed by `browser.storage.local`. Built TDD —
      `supabaseStorage.test.ts` written first (red: module didn't exist),
      5 assertions (round-trip, key independence, missing-key → null,
      removal, and that it's actually `browser.storage.local` underneath,
      not some other store) — green after the ~15-line implementation.
- [x] `utils/supabase.ts`: one client instance, reading
      `WXT_SUPABASE_URL`/`WXT_SUPABASE_ANON_KEY` from the environment
      (`.env.example` added) rather than hardcoding a project — throws
      clearly at load time if they're missing instead of failing silently
      later.
- [x] `App.tsx`: fetches the session on mount, subscribes to
      `supabase.auth.onAuthStateChange`, and renders a sign-in screen when
      there's no session — the rest of the existing dashboard is now nested
      inside that gate, unchanged otherwise.
- [x] **Revised after manual testing surfaced real cross-browser
      problems**: the first version used a plain redirect back to
      `DASHBOARD_URL` for both magic-link and Google OAuth. That broke in
      practice (`detectSessionInUrl: false`, no allowlisted redirect —
      fixed once), and further investigation for Edge/Firefox support
      surfaced worse structural problems: Chrome's id can be pinned
      (`manifest.key`, see `wxt.config.ts`), but Edge assigns its own id on
      publish with no way to pre-pin it, and Firefox randomizes
      `moz-extension://`'s uuid per browser profile specifically to prevent
      fingerprinting — no static redirect URL can ever work there. Replaced
      both flows to avoid extension-page redirects entirely:
  - Magic link → **typed OTP code** instead of a clicked link
    (`signInWithOtp` + `verifyOtp`) — completes the session inside the
    extension's own JS, identical on every browser, no redirect URL at all.
  - Google OAuth → `browser.identity.launchWebAuthFlow` +
    `getRedirectURL()` (the `identity` permission, added to
    `wxt.config.ts`) — the browser-native way to do OAuth in an extension;
    its redirect target is a reserved URL the browser intercepts before
    loading a page, so it never touches `chrome-extension://`/
    `moz-extension://` or their per-browser id problems.
  - `utils/oauthRedirect.ts` (the token-parsing logic for the
    `launchWebAuthFlow` result) built TDD — 6 assertions written first
    (red: module didn't exist), green after implementation.
  - `wxt.config.ts`'s `manifest` is now a per-browser function: Chrome gets
    the pinned `key`, Firefox gets a `browser_specific_settings.gecko.id`
    (fixes AMO identity/updates — does **not** fix the redirect problem,
    that's structural), Edge gets neither (rejects `key` per Microsoft's
    own support answer). Added `dev:edge`/`build:edge`/`zip:edge` scripts
    to match the existing chrome/firefox pattern.
- [x] Verified: `pnpm compile`, `pnpm test` (16/16), and `pnpm build` /
      `build:firefox` / `build:edge` all pass, each producing the expected
      per-browser manifest (checked `key`/`gecko.id`/`identity` presence
      directly in the built output).
- **Still not verified**: the actual sign-in round-trip end to end (does a
  real OTP email arrive with a usable code; does the Google consent screen
  actually hand back a valid session via `launchWebAuthFlow`) — needs a
  real linked Supabase project with providers configured (M0, still
  manual/undone) and a browser to click through.
- No new component-testing framework was introduced for `App.tsx`'s JSX
  itself — matches this codebase's existing convention (only
  `utils/*`/xstate machines have tests; `App.tsx` had zero before this
  milestone too). The testable unit (the storage adapter) got the TDD
  treatment; the thin UI wiring around it didn't, consistent with what was
  already here.

## M4 — Extension: entitlements cache

**Status: done.** `utils/entitlements.ts`.

- [x] `utils/entitlements.ts`: a plain `select` of the caller's own
      `entitlements` row (a normal RLS-protected read, not an RPC — reading
      isn't the operation that needs atomicity), cached into
      `storage.local`.
- [x] Triggered from `supabase.auth.onAuthStateChange` on `SIGNED_IN` and
      `TOKEN_REFRESHED` (plus once eagerly if a session already exists on
      mount) — no separate polling timer, per architecture-sync.md.
- [x] Dashboard reads the cache to warn on "New workspace" when at the
      limit — a tooltip, not a disabled button (see M5: creation itself is
      never blocked).

## M5 — Workspace creation: local-first always, sync is what's gated

**Status: done, resolved differently than originally planned** — see
`architecture-sync.md` → "The write-time check — resolved for workspace
creation". The original plan below (RPC-gates-creation, fail loudly
offline) was never implemented: `ensureWorkspaceForWindow` creates a
workspace on every window open with no click to intercept and no UI in
`background.ts` to show a rejection, so gating it on the server would break
window-opening itself while offline or at-limit. Built instead:

- [x] `createWorkspace` (`utils/workspaces.ts`) writes to `storage.local`
      first and unconditionally, exactly as before this milestone, then
      fires `registerWorkspace` — a non-blocking `create_workspace` RPC call
      (passing the local `p_id`) whose result nobody awaits or surfaces.
      `ensureWorkspaceForWindow` (`utils/attach.ts`) gets this for free,
      since it calls the same `createWorkspace`.
- [x] `create_workspace`'s SQL signature grew an optional `p_id uuid`
      (migration `20260928163000_create_workspace_client_id_and_expiry.sql`)
      so the server row lands under the same id the extension already
      generated — no id remapping needed once M6 exists to read it back.
      Backward compatible: existing 2-arg calls still work.
- [x] Same migration adds the `access_expires_at` check flagged as missing
      in M9 below: `create_workspace` now rejects once a caller's access has
      lapsed, _even though_ `max_workspaces` was left inflated (the Creem
      webhook only ever touches `access_expires_at` on expiry, never claws
      back `max_workspaces`). Free-tier accounts have a permanently-null
      `access_expires_at` and are unaffected — this deliberately corrects
      the original M9 text, which would have blocked free-tier accounts
      outright by requiring `access_expires_at > now()` unconditionally.
- [x] pgTAP coverage added to `create_workspace_test.sql`: caller-supplied
      id round-trips; a lapsed `access_expires_at` throws `'access expired'`
      regardless of `max_workspaces`. **Not yet run** — this sandbox has no
      Docker/Podman, so `supabase test db --local` couldn't actually be
      executed; treat these as reviewed-by-hand, not verified, until that
      run happens.
- [ ] This only updates the `create_workspace` RPC's own check — the
      broader "should `workspaces` RLS itself freeze reads/writes past
      expiry" question from `architecture-sync.md` → "Payments" is
      untouched and still open (creation is gated; nothing about existing
      synced rows is).

## M6 — Sync engine: push and pull

- [x] **Pull half only, additive merge** — `pullRemoteWorkspaces`
      (`utils/workspaces.ts`): a plain `select` of the caller's own
      `workspaces` rows (RLS-scoped, no RPC), adding any row whose id isn't
      already in `storage.local`. Called on sign-in and on every
      `TOKEN_REFRESHED`, alongside `reconcileSyncStatus` — piggybacking on
      the same timer as M4's entitlements refresh, so this doubles as the
      periodic pull tick below until a real one exists. Fixes the concrete
      symptom (a fresh/empty local profile can't see workspaces the account
      already has server-side, with no error surfaced) without the rest of
      M6's risk surface.
- [ ] `utils/sync.ts`, listening to `storage.onChanged`: debounce, then
      `upsert` to the `workspaces` table via a plain `supabase-js` call.
      Not an RPC — updates to an existing, already-owned workspace aren't
      entitlement-gated. **Still not built** — today, only workspace
      _creation_ ever reaches Supabase; renames and tab-sync edits don't
      sync at all yet.
- [ ] A true periodic pull tick independent of token refresh, and pull on
      dashboard mount specifically (today it only runs on sign-in/refresh
      events, not every mount of an already-signed-in session).
- [ ] Conflict resolution exactly as diagrammed in
      `architecture-sync.md` → "Pull + conflict resolution": compare the
      server's `updated_at`, server wins ties. **Not built** — the current
      pull is deliberately additive-only (never overwrites an id that
      already exists locally), so it can't yet reconcile a workspace that
      changed on both a local device and the server.

## M7 — Delete propagation

- [ ] Resolve `architecture-sync.md`'s open question up front, since M6
      needs an answer to be correct: add `deleted_at timestamptz` to
      `workspaces` (soft delete). `deleteWorkspace` becomes an `update`,
      not a `delete`.
- [ ] Every existing read of the `workspaces` table adds
      `.is("deleted_at", null)` — a query filter, not new server logic.

## M8 — Creem product setup

Infra only, no product code. **Status: done**, pre-existing — the Monthly
(`prod_1vEVfh4WUKbCPlPaoFLpS5`) and Yearly (`prod_7i6mdEk2fz7x5pdo3ZwHC3`)
products already exist in Creem and their hosted checkout links are live on
the marketing site (`marketing/src/pages/index.astro`). No one-time passes
(Supporter/Believer) — Creem's plan replaced those with a plain
monthly/yearly subscription, so M9 below only ever deals with subscription
events, not one-time orders.

- [x] Monthly + Yearly recurring products created in Creem.
- [x] Creem's hosted checkout link accepts `metadata[key]=value` as a query
      param directly — no API call (and no secret key on the client) needed
      to attach our internal `user_id`, unlike the API-driven checkout
      session this milestone originally assumed for Polar. See
      `extension/utils/creem.ts`.
- [x] Confirmed exact webhook event/field names from
      https://docs.creem.io/code/webhooks — `subscription.paid` (not
      `.active`, which the docs say is "only for synchronization") is what
      grants access; metadata round-trips onto `object.metadata` on the
      subscription payload; the renewal date is `object.current_period_end_date`.

## M9 — The second exception: Creem webhook receiver

**Status: done.** `supabase/functions/creem-webhook/`.

- [x] One Supabase Edge Function, registered as the webhook URL in Creem's
      dashboard (Developers > Webhooks). Verifies the `creem-signature`
      HMAC-SHA256 header (`verify.ts`, tested via `deno test`) before
      touching anything else — an unverified payload is not a trusted
      input.
- [x] No product-to-duration map needed: Creem's plan is a plain recurring
      subscription (not Polar's one-time passes), so there's only one event
      that matters (`subscription.paid`) and one thing it does — extend
      `access_expires_at` to `object.current_period_end_date` and bump
      `max_workspaces` for the plan. _(ponytail: one tier, so "pro" is a
      hardcoded ceiling on the existing column — promote to a real plans
      table once there's a second paid SKU.)_
- [x] `subscription.canceled` is a deliberate no-op — per
      `architecture-sync.md`, already-paid-for time isn't clawed back;
      `access_expires_at` just lapses on its own at the end of the current
      period. `subscription.expired`/`.paused`/`.unpaid`, by contrast, mean
      the _current_ period is no longer paid up — all three immediately set
      `access_expires_at = now()`, revoking access right away rather than
      waiting for a timestamp that may already be stale.
- [x] `create_workspace` now checks `access_expires_at` (M5,
      `20260928163000_create_workspace_client_id_and_expiry.sql`) — the one
      write path that existed to gate. Expiry has a real effect: a lapsed
      account can no longer create new workspaces (locally it still can —
      see M5 — but they won't sync).
- [ ] The broader ask — `workspaces` (and any other user-scoped) RLS
      requiring `access_expires_at > now()` on every read/write, not just
      creation — is still open. That's a different, bigger question than
      M5 answered: it's the "what happens to data at expiry" product
      decision below (freeze writes? drop to local-only? delete after a
      grace period?), and applies to a general sync engine (M6) that
      doesn't exist yet, not to `create_workspace` alone.
- [ ] The "what happens to data at expiry" open question
      (`architecture-sync.md` → "Payments") needs an answer before this
      milestone can be called fully done, not after.

## Deliberately not in this plan

- Edge Functions.
- A custom REST/GraphQL server.
- A generalized entitlement engine — only `create_workspace` exists until a
  second gated action is actually being built (tab-count/size limits are
  still an open product question per `architecture-sync.md`).
- Admin tooling for managing plans or entitlements — Phase 3/billing
  territory.
- Resource sync — blocked on the Phase 1 "manually-added links/notes"
  capability landing locally first (❌ in `capabilities.md`).
