# Architecture: local-first, then sync

**Status: implemented.** `supabase/migrations/` has the shipped schema, and
the extension has sync + auth code built against it — see
[`implementation-plan-sync.md`](./implementation-plan-sync.md) for the
milestone-by-milestone build history this design turned into, and this
page's own sections for a few places where the implementation later resolved
an open question differently than originally drafted. Unlike the original
Phase 1/2 split in `ROADMAP.md` (local use now, accounts later), this
version requires an account **from first use**, so the server can enforce
plan limits — see "Accounts are mandatory" below for why that doesn't
collapse into a plain thin client.

## Two separate questions this doc keeps distinct

1. **Is an account required to use cntxt at all?** Yes — settled by this
   revision. The server needs to know who you are to enforce usage limits,
   so sign-in gates the product before anything else happens.
2. **Does every read/write block on a network round-trip once you're signed
   in?** No, for almost everything. These are independent questions — the
   first is about who's allowed in the door, the second is about how fast
   things are once you're inside. Conflating them (network-required-for-
   auth ⇒ network-required-for-everything) was a mistake in an earlier draft
   of this document.

## Principle: local-first is a data-flow property, not a no-account promise

For every Group/Project operation _except creating a new one_ (see below),
the extension still reads and writes `storage.local`/`storage.session`
directly and instantly, never blocked on a network call — every diagram in
`workflows.md` continues to describe exactly what happens, unmodified. Sync
is **additive**: a background layer that mirrors that local state to
Supabase and pulls remote changes back in, without the save/close/restore
loop ever waiting on it.

Consequences of taking that seriously:

- Once a Group or Project exists, every local write to it (`updateGroup`/
  `updateFolder`, tab sync, ...) commits to `storage.local` first, full stop.
  Sync is notified after the fact, not in the write path.
- The UI (`App.tsx`) never has a loading spinner for "syncing" ordinary
  changes — it already re-renders from `storage.onChanged`, which fires the
  instant the local write lands, regardless of whether that write has
  reached the server yet.
- Going offline _after_ signing in loses nothing except cross-device sync
  itself and the ability to create a new workspace (see below) — everything
  else keeps working exactly as in `workflows.md`.

## Accounts are mandatory — why that doesn't make this a thin client

Signing in is a hard gate: there's no anonymous local-only mode, and no
"claim your existing local Groups/Projects later" migration (an earlier draft
of this doc had one — deleted, since there's no pre-account period left for
orphans to exist in). That single gate is also where most server-dependency lives, but not the
only place — see "Entitlements" below for the general rule.

So "requires an account" and "local-first" aren't in tension; they apply to
different operations. The design goal is to keep the set of server-gated
operations small and explicit, driven by what the server actually needs to
protect (plan limits), not applied blanket to everything.

## Components

```mermaid
flowchart TB
    subgraph DeviceA["Device A (extension)"]
        BGA[background.ts]
        DashA[Dashboard UI]
        LocalA[(storage.local<br/>groups, folders, settings)]
        SyncA[Sync engine — new]
        BGA --> LocalA
        DashA --> LocalA
        LocalA -.->|storage.onChanged| SyncA
        SyncA -.->|applies remote changes| LocalA
    end

    subgraph DeviceB["Device B (extension)"]
        LocalB[(storage.local)]
        SyncB[Sync engine — new]
        LocalB -.->|storage.onChanged| SyncB
        SyncB -.->|applies remote changes| LocalB
    end

    subgraph Supabase
        Auth[Supabase Auth]
        PG[(Postgres<br/>groups, folders, resources<br/>RLS by user_id)]
    end

    SyncA <-->|supabase-js<br/>PostgREST| PG
    SyncB <-->|supabase-js<br/>PostgREST| PG
    SyncA -.->|sign-in| Auth
    SyncB -.->|sign-in| Auth
    Auth -.->|issues JWT, auth.uid| PG
```

No custom API layer, per `ROADMAP.md`: the sync engine on each device talks
to Supabase directly via `supabase-js`. Postgres Row-Level Security (`auth.uid()
= user_id`) is what makes that safe — the server enforces isolation, so the
extension never has to.

## Auth — required before the dashboard does anything else

Not an optional upgrade offered later: on first run, the dashboard shows a
sign-in screen and nothing else until it succeeds. There's no "skip for
now."

```mermaid
sequenceDiagram
    actor User
    participant Dashboard
    participant SupaAuth as Supabase Auth
    participant Session as storage.local<br/>(session)

    User->>Dashboard: opens the dashboard for the first time
    Dashboard-->>User: sign-in screen (nothing else is usable yet)
    User->>Dashboard: "Sign in" (magic link or Google OAuth)
    Dashboard->>SupaAuth: signInWithOtp / signInWithOAuth
    SupaAuth-->>User: email link, or OAuth consent screen
    User->>SupaAuth: completes the flow
    SupaAuth-->>Dashboard: session (JWT, refresh token)
    Dashboard->>Session: persist session
    Note over Session: supabase-js reads this on every request —<br/>RLS policies key off the JWT's auth.uid()
    Dashboard-->>User: dashboard unlocks — now usable
```

## Push: local change → Supabase

```mermaid
sequenceDiagram
    actor User
    participant Local as storage.local
    participant Sync as Sync engine
    participant PG as Supabase (groups)

    User->>Local: (via existing Phase 1 flow) updateGroup(id, patch)
    Note over Local: unchanged from workflows.md —<br/>this write already happened before sync exists
    Local-->>Sync: storage.onChanged
    Sync->>Sync: debounce (coalesce a burst of tab-sync writes)
    Sync->>PG: upsert groups (id, user_id, name, tabs)
    PG->>PG: trigger sets updated_at = now() — server clock, not the client's
    PG-->>Sync: returns the row, including the server's updated_at
    Sync->>Local: overwrite local updatedAt with the server's value
    Note over Sync,Local: local updatedAt must never be compared<br/>across devices — only the server's clock is authoritative
```

The write to `storage.local` is exactly today's Phase 1 write — sync
observes it after the fact via `storage.onChanged`, the same mechanism the
dashboard already uses to react to background-script writes. It doesn't
insert itself into the save/close/restore path at all. A `kind:"project"`
Folder follows the identical push pattern against the `folders` table
(`pushDirtyFolders`) — this diagram only shows the Group side for brevity.

## Pull + conflict resolution

Phase 2 has no realtime requirement (that's Phase 3, per `ROADMAP.md`), so a
pull is just: fetch rows the server has touched since the last sync, and for
each one, take the server's copy if the server's version is the one that
should win.

```mermaid
sequenceDiagram
    actor Trigger as dashboard mount / periodic tick / focus
    participant Sync as Sync engine
    participant PG as Supabase (groups)
    participant Local as storage.local

    Trigger->>Sync: run a sync tick
    Sync->>PG: select * where updated_at > lastSyncedAt
    PG-->>Sync: changed rows (possibly none)
    loop each changed row R
        Sync->>Local: read local group with id = R.id
        alt local has no pending (unpushed) change for this id
            Sync->>Local: overwrite with R — server is the only writer left
        else local has a pending change too
            alt R.updated_at > local.updatedAt
                Sync->>Local: server wins — overwrite, discard the local edit
            else
                Sync->>PG: push the local version instead (see Push)
            end
        end
    end
    Sync->>Sync: lastSyncedAt = max(seen updated_at)
```

This is genuinely last-write-wins with no merge: a true concurrent edit from
two devices loses one side's change entirely. `ROADMAP.md` accepts this
explicitly ("good enough for one user on multiple devices, no CRDT/merge
logic") — it's a real limitation, not an oversight, and it's the right
tradeoff for a product where one workspace is realistically driven by one
open browser window at a time.

## Offline handling

```mermaid
stateDiagram-v2
    [*] --> Idle
    Idle --> Pushing: local change observed
    Idle --> Pulling: sync tick fires
    Pushing --> Idle: 2xx from Supabase
    Pulling --> Idle: pull applied
    Pushing --> Offline: network error
    Pulling --> Offline: network error
    Offline --> Retrying: browser reports online again
    Retrying --> Pushing: flush queued local changes
    Retrying --> Offline: still unreachable
```

Nothing here blocks the local write itself — a queued/offline sync engine
just means "not synced yet," which is invisible to the save/close/restore
loop. `browser.storage.onChanged` already gives the dashboard live updates
regardless of network state, so there's no separate "offline banner" logic
needed for the core UI to stay correct.

## Local model vs. Postgres schema

|                       | Local (`utils/groups.ts`)                 | Postgres (`supabase/migrations/...`)                             | Note                                                                                                                                                                                                             |
| --------------------- | ----------------------------------------- | ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| id                    | `crypto.randomUUID()`, client-generated   | `uuid default gen_random_uuid()`                                 | Already compatible — locally-created ids need no remapping on first sync.                                                                                                                                        |
| name                  | `text`                                    | `text`                                                           | Direct.                                                                                                                                                                                                          |
| tabs                  | `GroupTab[]` (`{url, title}`)             | `jsonb`                                                          | Direct serialization.                                                                                                                                                                                            |
| status / order        | `GroupStatus`, `number`                   | `text` (check constraint), `order_index integer`                 | `order` → `order_index` is the one field-name mismatch (`order` is reserved in SQL), mapped explicitly in `pullRemoteGroups`/`pushDirtyGroups`.                                                                  |
| folderId              | `string \| null \| undefined`             | `folder_id uuid references folders(id) on delete set null`       | Which Area, Project, or (if null) ungrouped — never a Section. A Project-parented Group is also the one `groupSwapMachine` can swap (`Folder.active_group_id`).                                                  |
| createdAt / updatedAt | `number` (client `Date.now()`)            | `timestamptz`, `updated_at` server-set via `moddatetime` trigger | **Not the same clock.** See Push diagram — after any round-trip, local `updatedAt` must be replaced with the server's value, never compared as client-generated ms against another device's client-generated ms. |
| ownership             | none (single-profile, implicit)           | `user_id` (RLS: `auth.uid() = user_id`)                          | No claiming step needed — every Group/Project is created after sign-in (see "Entitlements"), so it always has an owner from the moment it exists locally.                                                        |
| resources             | `Resource.groupId` (`utils/resources.ts`) | `resources` table, FK to `groups` (nullable) or `folders`        | Built — a Resource is parented to exactly one of a Group or a Section, enforced at the call site, not the schema.                                                                                                |
| deletion              | `deletedAt` soft-delete, Trash view       | `deleted_at timestamptz`, `pg_cron`-purged past retention        | Resolved — see `implementation-plan-sync.md` M7: soft delete fits the existing poll (an update, not a disappearance); a scheduled purge hard-deletes past the retention window.                                  |

A `kind:"project"` Folder (`utils/folders.ts`) has its own, smaller local/
Postgres mapping for the fields a Group doesn't have: `kind`, `tabs` (its own
live tab list when no child Group is swapped in), and `active_group_id` — see
`CLAUDE.md`'s "Entities" section.

## Entitlements: what the server gates, and how the client stays fast

Limits aren't only about how many workspaces exist — a tabs-per-workspace
cap or a workspace size cap are just as plausible, and more will likely show
up over time. Rather than hardcode "workspace creation is special," the
server exposes a small set of **entitlements** for the account (a plan's
limits), the client caches them locally for instant UX, and any write that
could exceed one goes through a server-side atomic check. The cache makes
the UI fast; it never makes the decision.

(Schema-wise this implies some `plans` / `account_limits` table keyed by
`user_id` or `plan_id` — not designed here, just assumed to exist.)

### Keeping the client's copy fresh: piggyback on session refresh

`supabase-js` already refreshes the access token on a timer before it
expires, and once at initial sign-in. Pulling entitlements on that same
event means no separate polling loop.

```mermaid
sequenceDiagram
    actor User
    participant Dashboard
    participant SupaAuth as Supabase Auth
    participant PG as Supabase (entitlements)
    participant Local as storage.local<br/>(entitlements cache)

    Note over SupaAuth: fires at sign-in, and again automatically<br/>before each access token expires
    SupaAuth-->>Dashboard: TOKEN_REFRESHED
    Dashboard->>PG: select entitlements where user_id = auth.uid()
    PG-->>Dashboard: maxWorkspaces, maxTabsPerWorkspace, maxWorkspaceBytes, ...
    Dashboard->>Local: overwrite cached entitlements
```

> **The cache is advisory, never authoritative.** It exists so the UI can
> gray out "New group"/"New project" or show "approaching your tab limit"
> without a round-trip just to render that state. A stale or tampered local cache must
> never be what actually allows or blocks a write.

### The write-time check — resolved for Group/Project creation: local-first wins, sync is what's gated

An earlier draft of this doc had the entitlement check block creation
itself — reject the write, and the Group/Project simply doesn't exist yet.
That's wrong for this product specifically: `ensureBindingForWindow` creates
a Project automatically every time a browser window opens (see `CLAUDE.md`),
with no click to intercept and no UI in `background.ts` to show a rejection.
Blocking that on a server round-trip means opening a window while offline,
or while already at your plan's limit, would silently fail to create that
window's Project — breaking the "every window is a workspace" guarantee the
whole product is built on. Resolved: creation is **local-first,
unconditionally** — it never fails, online or off, at-limit or not. What the
entitlement actually gates is whether that Group/Project gets a server-side
counterpart at all.

Explicit Group creation (the dashboard's "+ Group" buttons) _does_ have a
click to intercept, unlike the automatic Project case — but it deliberately
uses the exact same local-first-always pattern anyway, for one reason:
consistency. A Group and a Project share one quota pool
(`count_group_like()`, see `supabase/migrations/20261007170000_project_quest_restructure.sql`),
so having one creation path fail loudly and the other not would mean the
same limit behaves differently depending on which button you clicked.

```mermaid
sequenceDiagram
    actor User
    participant Dashboard
    participant Local as storage.local
    participant PG as Supabase

    User->>Dashboard: a new Group (explicit click) or Project (explicit click, or a window just opened)
    Dashboard->>Local: create it — always succeeds, no check first
    Note over Dashboard,Local: same commit as every other local-first write;<br/>the UI never waits on this
    Dashboard-->>PG: create_group / create_project RPC, fire-and-forget (same local id, so no remapping)
    alt under the shared limit and access not expired
        PG-->>Dashboard: row created — this Group/Project now has a synced counterpart
    else at the limit, expired, or offline
        PG-->>Dashboard: rejected or unreachable — silently ignored
        Note over Dashboard: it stays exactly as usable, just unsynced —<br/>no error surfaced, no retry
    end
```

`extension/utils/groups.ts`'s `registerGroup` and `extension/utils/folders.ts`'s
`registerProject` are this — a non-blocking `.rpc('create_group'/'create_project', ...)`
call whose result nobody awaits or reports. The dashboard's cached entitlements
(`utils/entitlements.ts`) still gray out the "New group"/"New project" tooltip
as an early warning ("this won't sync"), but that's advisory framing only —
clicking through anyway still works, it just stays local-only, which is the
whole point of this design.

This resolves the offline question below for Group/Project creation
specifically; the equivalent question for a tab-count entitlement (no
click to intercept at all, not even an implicit one) is still open — see
below.

### Open problem: an entitlement with no click to intercept

Explicit Group/Project creation is a deliberate action — there's a moment to
say "no" (even though, per above, nothing actually does). A tabs-per-group
limit doesn't have that: tabs arrive via live sync
(`workflows.md` → "Live tab sync") as a side effect of ordinary browsing,
not a request the extension can reject. Undecided, and worth a product
call rather than an architectural default:

- Let the local workspace keep syncing past the limit, and only enforce it
  at push time — the local copy stays complete, but sync silently falls
  behind past the limit. "Fully backed up" quietly becomes false.
- Stop syncing new tabs into that workspace once the cached entitlement
  says it's full, and surface that in the dashboard. Keeps local and remote
  in agreement, but means cntxt visibly stops tracking tabs the user is
  still actively using.

## Payments (Creem)

Creem is the source of truth that _writes_ entitlements, not a separate
system alongside them: a purchase's only architectural job is to set
`entitlements.access_expires_at` (and, on this single-tier plan,
`max_workspaces`) for a user. Everything else in this document — the cache,
the write-time check, RLS — is unaware Creem exists; it only ever reads
those columns.

There's only one product shape, unlike the one-time-pass-plus-subscription
split an earlier draft of this doc assumed for Polar: Monthly and Yearly are
both plain recurring subscriptions. `subscription.paid` (not
`subscription.active`, which Creem's docs describe as "only for
synchronization") is the one event that grants access — extend
`access_expires_at` to the subscription's `current_period_end_date` on every
payment, and _don't_ retract it early on `subscription.canceled` (cancelling
stops future renewals, it doesn't claw back time already paid for).

Attaching our internal `user_id` to a purchase doesn't need a server-side
"create checkout session" API call at all: Creem's hosted checkout links
accept `metadata[key]=value` as a plain query parameter, and that metadata
round-trips onto the webhook payload untouched
(`extension/utils/creem.ts` builds this URL; see
`marketing/src/pages/index.astro` for the same product links used
unauthenticated on the marketing site).

```mermaid
sequenceDiagram
    actor User
    participant Dashboard
    participant Creem
    participant Hook as Edge Function<br/>(webhook receiver)
    participant PG as Supabase (entitlements)

    User->>Dashboard: "Upgrade to Pro"
    Dashboard->>Creem: open hosted checkout link, ?metadata[userId]=...
    User->>Creem: completes payment
    Creem-->>Hook: webhook (subscription.paid), signed
    Hook->>Hook: verify creem-signature header (HMAC-SHA256)
    Hook->>PG: update entitlements set access_expires_at = object.current_period_end_date, max_workspaces = ... where user_id = object.metadata.userId
    Note over Dashboard,PG: user sees the new expiry next time<br/>the entitlements cache refreshes (session refresh, or a manual "refresh" after checkout)
```

**Why the webhook needs an Edge Function, not just a table write.** Creem
calls _our_ server — there's no user session attached to that request, so
it can't go through `supabase-js`/RLS as a normal authenticated write the
way every other table access in this document does. Something has to sit at
a public HTTPS endpoint, verify the payload actually came from Creem
(signature check), and only then write. Postgres has no notion of an
inbound HTTP endpoint, so this is unavoidably a second exception to "the
server is just tables and RLS" — alongside `create_group`/`create_project`,
and for the same underlying reason: an operation exists that a bare
client-side insert cannot safely perform. Implemented: `supabase/functions/creem-webhook/`.

**Enforcement lives in RLS, not the entitlements cache — resolved.**
Everywhere else in this document, the client-side entitlements cache is
explicitly _advisory_ — a UX shortcut, never the actual gate. Expiry is the
one place that distinction really matters for the business model, and it's
now enforced where it needs to be: `has_active_access(user_id)`
(`supabase/migrations/20261005120000_freeze_writes_on_expiry.sql`) is
required by every write policy on `groups`, `folders`, and `resources` — an
expired user's `update`/`insert`/`delete` fails at the RLS layer itself, not
just at `create_group`/`create_project` time. Reads stay unrestricted so the
dashboard still renders.

**Resolved, not just an open question:** what happens to a user's synced
data the moment their pass lapses is the "freeze writes but keep serving
reads" option — chosen and implemented by the migration above, not the
"drop to local-only" or "delete after a grace period" alternatives this
section used to list as still-undecided.

- **Delete propagation — resolved.** `deletedAt`/`deleted_at` soft delete
  (delete becomes an update, fits the existing poll), with a `pg_cron`-driven
  purge past the plan's retention window. See `implementation-plan-sync.md`
  M7 and `group-sync-semantics.md`'s "Dormant" framing.
- **Push batching.** Live tab sync (`workflows.md` → "Live tab sync") can
  fire several `updateGroup`/`updateFolder` calls in quick succession while
  someone's actively browsing. The Push diagram above debounces before
  hitting Supabase — without that, a busy window would generate a write per
  tab event.
- **Resources sync — resolved, built.** `Resource.groupId`/`folderId`
  (`extension/utils/resources.ts`) sync against the `resources` table like
  everything else in this document.
- **What happens offline at the point of an entitlement-gated write?**
  Resolved for Group/Project creation — see "The write-time check" above:
  creation always succeeds locally, offline or not; the entitlement check
  only gates whether it gets a synced server-side counterpart. Still open
  for any future entitlement that isn't tied to a creation event at all
  (e.g. a tabs-per-group or size cap) — see the tab-count problem below.
- **The tab-count entitlement problem has no chosen answer** — see
  "Entitlements → Open problem" above.

## Explicit non-goals

- No CRDT or field-level merge — last-write-wins, whole-row.
- No custom API server — `supabase-js` talks to PostgREST/Auth directly,
  except the `create_group`/`create_project` RPCs (atomic limit enforcement,
  now sharing one quota pool) and the Creem webhook Edge Function (the only
  inbound request with no user session to authenticate it through RLS).
  Exceptions, all because an operation exists that a plain client-side table
  call cannot safely do — not a sign the rule is soft.
- No realtime subscriptions yet — see `ROADMAP.md` Phase 3 for the
  team-live-updates upgrade this schema is meant to support later.
- No anonymous or local-only mode — this supersedes `ROADMAP.md`'s original
  Phase 1 (local-only) / Phase 2 (add accounts) split; `ROADMAP.md` has
  since been reconciled with this (Phase 2 is marked shipped there).
