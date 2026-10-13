import { supabase } from "./supabase";

// Identity across a resync is by URL (see windowSyncMachine.ts's syncTabs),
// matching how the rest of this codebase already treats tab identity; a
// known, pre-existing weak spot is a duplicate open tab with the same URL,
// not something this adds.
export type GroupTab = { url: string; title: string };

export type GroupStatus = "pending" | "active" | "done";

// See docs/group-sync-semantics.md for what each state means and how
// the dashboard should render it. Undefined (legacy groups predating
// this field) is treated the same as "syncing" — unknown, pending a check.
export type SyncStatus =
  "synced" | "syncing" | "offline" | "signed-out" | "limit-reached" | "expired";

export type Group = {
  id: string;
  name: string;
  tabs: GroupTab[];
  createdAt: number;
  updatedAt: number;
  // Explicit picks from the dashboard's customize dialog; a group
  // without either falls back to a hash-derived color and the default
  // cntxt mark (see App.tsx's colorFor/faviconHrefFor).
  color?: string;
  icon?: string;
  syncStatus?: SyncStatus;
  // Null/undefined = ungrouped, exactly like every group today. Set via
  // utils/folders.ts, never required — "every window is a group" stays
  // true with no folder involved at all.
  folderId?: string | null;
  // Set by deleteGroup, cleared by restoreGroup — a group in
  // the trash, not actually removed from storage.local yet. Kept so the
  // dashboard can show a Trash view and so this soft-delete propagates
  // through the same push/pull path as any other edit (see
  // supabase/migrations' trash_and_purge migration and
  // purgeExpiredLocalTrash below).
  deletedAt?: number;
  // Project-nested swap lifecycle (unused by a standalone group, which
  // stays undefined forever): "pending"/"active"/"done" tracking whether
  // this group is currently swapped into its parent Project's window —
  // see groupSwapMachine.ts. A former Mission "phase" is now just another
  // sibling Group sharing the same parent Project's folderId.
  status?: GroupStatus;
  // Explicit ordinal among sibling groups sharing the same folderId, used
  // to pick the next group to auto-activate when one completes.
  order: number;
  // "Hidden but kept" — distinct from both `status === "done"` and Trash's
  // `deletedAt`: never auto-deleted, just excluded from the main sidebar.
  // Set manually (dashboard context menu) or by utils/autoArchive.ts's rule
  // (done + inactive for a Settings-configurable stretch). See
  // utils/sessions.ts for lastSeenAt below.
  archivedAt?: number;
  // Stamped by utils/sessions.ts's captureSession() every time this group's
  // tabs are live in a window at a periodic capture tick — NOT derived from
  // updatedAt, which also bumps on an unrelated rename/recolor. Drives the
  // auto-archive inactivity check.
  lastSeenAt?: number;
};

// Mirrors purge_trashed_groups()'s retention window in the trash_and_purge
// migration — keep both in sync if either changes. "Paid" is the same
// access_expires_at-in-the-future check create_group's RPC uses.
const FREE_TRASH_RETENTION_DAYS = 7;
const PAID_TRASH_RETENTION_DAYS = 30;

export function trashRetentionDays(
  accessExpiresAt: string | null | undefined,
): number {
  const isPaid = !!accessExpiresAt && Date.parse(accessExpiresAt) > Date.now();
  return isPaid ? PAID_TRASH_RETENTION_DAYS : FREE_TRASH_RETENTION_DAYS;
}

const STORAGE_KEY = "groups";

export async function getGroups(): Promise<Group[]> {
  const result = await browser.storage.local.get(STORAGE_KEY);
  return (result[STORAGE_KEY] as Group[] | undefined) ?? [];
}

async function setGroups(groups: Group[]) {
  await browser.storage.local.set({ [STORAGE_KEY]: groups });
}

export async function createGroup(
  name: string,
  tabs: GroupTab[],
): Promise<Group> {
  const group: Group = {
    id: crypto.randomUUID(),
    name,
    tabs,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    order: 0,
  };
  const groups = await getGroups();
  await setGroups([...groups, group]);
  registerGroup(group);
  return group;
}

async function setSyncStatus(id: string, syncStatus: SyncStatus) {
  const groups = await getGroups();
  await setGroups(groups.map((m) => (m.id === id ? { ...m, syncStatus } : m)));
}

// Best-effort: registers the group under the account's entitlement
// limit so it counts as synced. Never awaited by callers and never blocks
// or fails loudly — offline, signed out, or already at the plan's limit
// all just mean this group stays local-only, exactly as it does today,
// so opening a browser window (ensureBindingForWindow calls this too)
// can never break because of an entitlement or network check. See
// docs/architecture-sync.md's "open question" about entitlement checks
// with no click to intercept. The result is recorded as `syncStatus` (see
// docs/group-sync-semantics.md) purely so the dashboard can show it —
// it's still never awaited or surfaced as an error by callers.
async function registerGroup(group: Group) {
  if (!supabase) return;
  await setSyncStatus(group.id, "syncing");
  const { error } = await supabase.rpc("create_group", {
    p_name: group.name,
    p_tabs: group.tabs,
    p_id: group.id,
  });
  if (!error) {
    await setSyncStatus(group.id, "synced");
    return;
  }
  console.debug("group not synced:", error.message);
  // 23505 = unique_violation: this id already made it to the server from an
  // earlier call whose response was never seen (e.g. the extension closed
  // mid-request) — that's a success, not a failure.
  if (error.code === "23505") {
    await setSyncStatus(group.id, "synced");
  } else if (error.message === "not authenticated") {
    await setSyncStatus(group.id, "signed-out");
  } else if (error.message === "access expired") {
    await setSyncStatus(group.id, "expired");
  } else if (error.message === "workspace limit reached") {
    await setSyncStatus(group.id, "limit-reached");
  } else {
    await setSyncStatus(group.id, "offline");
  }
}

// Re-checks every group that isn't confirmed `synced` — turns a
// stuck "syncing" (extension closed mid-request) or a stale "limit-reached"
// (user just upgraded) into an accurate status, and backfills a real status
// onto groups created before this field existed. Call on dashboard
// mount and whenever the session refreshes, alongside refreshEntitlements.
export async function reconcileGroupSyncStatus() {
  const groups = await getGroups();
  for (const m of groups) {
    if (m.syncStatus !== "synced") await registerGroup(m);
  }
}

// Fetches this account's groups from Supabase and merges them into
// storage.local: a row missing locally (fresh/empty profile, new device) is
// added; a row that exists locally is overwritten only if the server's
// updated_at is strictly newer than the local copy's — last-write-wins per
// docs/architecture-sync.md → "Pull + conflict resolution". A local edit
// that hasn't been pushed yet necessarily has a newer local updatedAt than
// its still-stale server row, so it survives untouched here and reaches the
// server on the next push instead of being clobbered. Call on sign-in,
// token refresh, and periodically (see utils/sync.ts). Throws on a fetch
// error instead of swallowing it — a caller that only sees "0 applied"
// otherwise can't tell "already up to date" from "the request failed."
export async function pullRemoteGroups(): Promise<number> {
  if (!supabase) return 0;
  const { data, error } = await supabase
    .from("groups")
    .select(
      "id, name, tabs, created_at, updated_at, deleted_at, folder_id, status, order_index, archived_at, last_seen_at",
    );
  if (error) throw new Error(error.message);
  if (!data) return 0;

  const local = await getGroups();
  const localById = new Map(local.map((m) => [m.id, m]));
  let applied = 0;
  const next = [...local];

  for (const row of data) {
    const existing = localById.get(row.id);
    const remote: Group = {
      id: row.id,
      name: row.name,
      tabs: (row.tabs as GroupTab[] | null) ?? [],
      createdAt: Date.parse(row.created_at),
      updatedAt: Date.parse(row.updated_at),
      deletedAt: row.deleted_at ? Date.parse(row.deleted_at) : undefined,
      folderId: row.folder_id,
      status: row.status ?? undefined,
      order: row.order_index ?? 0,
      archivedAt: row.archived_at ? Date.parse(row.archived_at) : undefined,
      lastSeenAt: row.last_seen_at ? Date.parse(row.last_seen_at) : undefined,
      syncStatus: "synced",
    };
    if (!existing) {
      next.push(remote);
      applied++;
    } else if (remote.updatedAt > existing.updatedAt) {
      const idx = next.findIndex((m) => m.id === row.id);
      next[idx] = { ...remote, color: existing.color, icon: existing.icon };
      applied++;
    }
  }

  if (applied > 0) await setGroups(next);
  return applied;
}

// Mirrors the server's purge_trashed_groups() locally, so a trashed
// group's countdown hitting zero removes it from the dashboard
// immediately rather than lagging behind the next hourly cron tick. Purely
// a local-storage cleanup — the actual server row (and the guarantee that
// it's gone even if this device never reconnects) is the migration's job,
// not this function's. Call after every pull (see utils/sync.ts), since
// that's also when the entitlements cache this depends on is freshest.
export async function purgeExpiredLocalTrash(
  accessExpiresAt: string | null | undefined,
): Promise<void> {
  const cutoffMs = trashRetentionDays(accessExpiresAt) * 24 * 60 * 60 * 1000;
  const local = await getGroups();
  const kept = local.filter(
    (m) => !m.deletedAt || Date.now() - m.deletedAt < cutoffMs,
  );
  if (kept.length !== local.length) await setGroups(kept);
}

// Pushes every locally-edited, already-synced group up to Supabase —
// M6's push half (docs/architecture-sync.md → "Push: local change →
// Supabase"). Only `syncStatus === "synced"` groups are eligible: a
// brand-new group reaches the server via create_group (registerGroup
// above), not this path, since that RPC is what enforces the entitlement
// limit; this only ever runs `update`, never `insert`.
// `lastPushedAt` (kept in utils/sync.ts's machine context, not persisted) is
// how a caller avoids re-pushing a group whose local updatedAt hasn't
// moved since the last successful push — without it, the "write the
// server's updatedAt back to local storage" step below would itself trigger
// another storage.onChanged, pushing the same content forever. Uses
// `.update().eq("id", ...)` rather than `.upsert()`: groups.user_id has
// no column default, so an upsert's (unused but still validated) insert
// branch would fail a not-null check on a row that already exists.
export async function pushDirtyGroups(
  lastPushedAt: Record<string, number>,
): Promise<Record<string, number>> {
  if (!supabase) return lastPushedAt;
  const next = { ...lastPushedAt };

  for (const m of await getGroups()) {
    if (m.syncStatus !== "synced") continue;
    if (m.updatedAt <= (next[m.id] ?? 0)) continue;

    const { data, error } = await supabase
      .from("groups")
      .update({
        name: m.name,
        tabs: m.tabs,
        deleted_at: m.deletedAt ? new Date(m.deletedAt).toISOString() : null,
        folder_id: m.folderId ?? null,
        status: m.status ?? "pending",
        order_index: m.order ?? 0,
        archived_at: m.archivedAt ? new Date(m.archivedAt).toISOString() : null,
        last_seen_at: m.lastSeenAt
          ? new Date(m.lastSeenAt).toISOString()
          : null,
      })
      .eq("id", m.id)
      .select("updated_at")
      .single();
    if (error) throw new Error(error.message);

    const serverUpdatedAt = Date.parse(data.updated_at);
    next[m.id] = serverUpdatedAt;
    const fresh = await getGroups();
    await setGroups(
      fresh.map((x) =>
        x.id === m.id ? { ...x, updatedAt: serverUpdatedAt } : x,
      ),
    );
  }

  return next;
}

export async function updateGroup(
  id: string,
  patch: Partial<
    Pick<
      Group,
      | "name"
      | "tabs"
      | "color"
      | "icon"
      | "folderId"
      | "status"
      | "order"
      | "archivedAt"
      | "lastSeenAt"
    >
  >,
) {
  const groups = await getGroups();
  await setGroups(
    groups.map((m) =>
      m.id === id ? { ...m, ...patch, updatedAt: Date.now() } : m,
    ),
  );
}

// Soft delete: moves the group to the Trash instead of removing it,
// local-first like every other write here — it never blocks on a server
// round-trip. `updatedAt` bumps too, so pushDirtyGroups picks this up
// like any other edit and propagates deletedAt to the server.
export async function deleteGroup(id: string) {
  const groups = await getGroups();
  await setGroups(
    groups.map((m) =>
      m.id === id ? { ...m, deletedAt: Date.now(), updatedAt: Date.now() } : m,
    ),
  );
}

export async function restoreGroup(id: string) {
  const groups = await getGroups();
  await setGroups(
    groups.map((m) =>
      m.id === id ? { ...m, deletedAt: undefined, updatedAt: Date.now() } : m,
    ),
  );
}

// "Hidden but kept" — unlike deleteGroup, never schedules removal and has
// no retention countdown. See Group.archivedAt's own comment.
export async function archiveGroup(id: string) {
  const groups = await getGroups();
  await setGroups(
    groups.map((m) =>
      m.id === id ? { ...m, archivedAt: Date.now(), updatedAt: Date.now() } : m,
    ),
  );
}

export async function unarchiveGroup(id: string) {
  const groups = await getGroups();
  await setGroups(
    groups.map((m) =>
      m.id === id ? { ...m, archivedAt: undefined, updatedAt: Date.now() } : m,
    ),
  );
}

// The Trash view's explicit, irreversible "Delete forever" — unlike every
// other mutation here, this doesn't wait for the next push cycle: it fires
// a real delete at Supabase immediately (best-effort, same fire-and-forget
// style as registerGroup — offline or signed out just means the
// server-side row is left for purge_trashed_groups to catch later).
export async function permanentlyDeleteGroup(id: string) {
  const groups = await getGroups();
  await setGroups(groups.filter((m) => m.id !== id));
  await supabase?.from("groups").delete().eq("id", id);
}
