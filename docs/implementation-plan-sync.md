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
- Supabase Edge Functions, beyond the one M9 needs to receive Polar
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

Postgres only.

- [ ] New migration: an `entitlements` table, one row per `user_id`, e.g.
      `max_workspaces int not null default 10`, plus
      `access_expires_at timestamptz` (null until a purchase sets it — see
      M8/M9). Start with exactly the columns needed for what's actually
      enforced (M2's limit, M9's expiry) — _(ponytail: skip a `plans` table
      entirely until there's a second tier to differentiate; a flat
      per-user row with hardcoded free-tier defaults is the whole schema
      until then.)_
- [ ] RLS: the owning user can `select` their row; nobody can `insert`/
      `update`/`delete` it via PostgREST. (Changing someone's limits — e.g.
      after a Stripe webhook in Phase 3 — is a privileged write path, not in
      scope here.)
- [ ] Seed a row per new user. Simplest dumb option: a trigger on
      `auth.users` insert that creates the default `entitlements` row — one
      more small, boring SQL trigger, not application code.

## M2 — The one exception: `create_workspace`

- [ ] One `plpgsql` function, `security invoker` (not `definer` — runs as
      the calling user, so the existing `workspaces` RLS policy still
      applies inside it; no re-implementing "owner-only" logic in SQL).
      Body: count the caller's workspaces, compare to their `entitlements`
      row, insert-and-return on success, raise an exception otherwise — all
      in one transaction, closing the two-devices-race problem from
      `architecture-sync.md`.
- [ ] Exposed automatically as `supabase.rpc('create_workspace', {...})` —
      PostgREST does this for free once the function exists; no extra
      server-side wiring.
- [ ] Write the test for this in SQL against a local Supabase instance
      (`supabase test db` / pgTAP, or a plain script) before wiring the
      extension to it: two concurrent calls at the limit, exactly one
      should succeed.

## M3 — Extension: auth gate

- [ ] Add `@supabase/supabase-js` to `extension/package.json`.
- [ ] `utils/supabase.ts`: one client instance. Extensions can't use
      `window.localStorage` the way `supabase-js` expects by default —
      give it a storage adapter backed by `browser.storage.local`.
- [ ] `App.tsx`: render a sign-in screen when there's no session (per the
      Auth diagram in `architecture-sync.md`); nothing else in the
      dashboard renders until it resolves.
- [ ] Nothing here is custom backend work — Supabase Auth's hosted flows
      (magic-link email, OAuth redirect) already do the sign-in UI and
      verification.

## M4 — Extension: entitlements cache

- [ ] `utils/entitlements.ts`: a plain `select` of the caller's own
      `entitlements` row (a normal RLS-protected read, not an RPC — reading
      isn't the operation that needs atomicity), cached into
      `storage.local`.
- [ ] Trigger the fetch from `supabase.auth.onAuthStateChange` on
      `SIGNED_IN` and `TOKEN_REFRESHED` — no separate polling timer, per
      architecture-sync.md.
- [ ] Dashboard reads the cache to gray out "New workspace" when at the
      limit. Advisory only — M5 still goes through the real check.

## M5 — Workspace creation goes through the RPC

- [ ] `createWorkspace` (`utils/workspaces.ts`) and
      `ensureWorkspaceForWindow` (`utils/attach.ts`) call
      `supabase.rpc('create_workspace', ...)` first; write to
      `storage.local` only on success.
- [ ] On rejection (at the limit) or a network error (offline), fail
      loudly — no local-only fallback creation. Matches the decision
      flagged as needed in `architecture-sync.md`'s open questions; revisit
      here if that decision changes.

## M6 — Sync engine: push and pull

- [ ] `utils/sync.ts`, listening to `storage.onChanged`: debounce, then
      `upsert` to the `workspaces` table via a plain `supabase-js` call.
      Not an RPC — updates to an existing, already-owned workspace aren't
      entitlement-gated.
- [ ] Pull tick on dashboard mount and on a periodic interval (no realtime
      — that's Phase 3 per `ROADMAP.md`).
- [ ] Conflict resolution exactly as diagrammed in
      `architecture-sync.md` → "Pull + conflict resolution": compare the
      server's `updated_at`, server wins ties.

## M7 — Delete propagation

- [ ] Resolve `architecture-sync.md`'s open question up front, since M6
      needs an answer to be correct: add `deleted_at timestamptz` to
      `workspaces` (soft delete). `deleteWorkspace` becomes an `update`,
      not a `delete`.
- [ ] Every existing read of the `workspaces` table adds
      `.is("deleted_at", null)` — a query filter, not new server logic.

## M8 — Polar product setup

Infra only, no product code.

- [ ] Create the Monthly, Annual, Supporter (3-year), and Believer (5-year)
      products in Polar as designed — the two passes as **one-time
      purchases**, per the pricing plan.
- [ ] Confirm Polar's checkout supports attaching our internal `user_id` as
      metadata on the session, and that the metadata round-trips onto the
      webhook payload — this is what M9 uses to know which row to update.
      If it doesn't round-trip cleanly, this milestone blocks M9.
- [ ] Note the exact event names Polar sends for a completed one-time order
      vs. a subscription renewal/cancellation — M9's mapping depends on
      getting these right, not guessing at them.

## M9 — The second exception: Polar webhook receiver

- [ ] One Supabase Edge Function, registered as the webhook URL in Polar's
      dashboard. Verifies the Polar signature header before touching
      anything else — an unverified payload is not a trusted input.
- [ ] A small hardcoded map, `polar_product_id -> duration`, inside the
      function — _(ponytail: four products, a literal object is simpler
      than a lookup table; promote it to a Postgres table only once there
      are enough SKUs that shipping a new one without a code change
      actually matters.)_
- [ ] On a one-time order event: `access_expires_at = purchased_at +
duration` (or `greatest(current access_expires_at, ...) + duration`
      if stacking multiple passes should extend rather than overwrite —
      product decision, not resolved here).
- [ ] On a subscription renewal: extend to the next renewal date. On
      cancellation: do nothing to `access_expires_at` — per
      `architecture-sync.md`, already-paid-for time isn't clawed back.
- [ ] Update the `workspaces` (and any other user-scoped) RLS policies to
      require `access_expires_at > now()` for writes. Without this step,
      M9 updates a column nothing else reads, and expiry has no actual
      effect — see `architecture-sync.md` → "Payments" for why the cache
      alone isn't enough here.
- [ ] The "what happens to data at expiry" open question
      (`architecture-sync.md` → "Payments") needs an answer before this
      milestone can be called done, not after.

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
