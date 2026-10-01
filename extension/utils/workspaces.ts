import { supabase } from "./supabase";

export type WorkspaceTab = { url: string; title: string };

// See docs/workspace-sync-semantics.md for what each state means and how
// the dashboard should render it. Undefined (legacy workspaces predating
// this field) is treated the same as "syncing" — unknown, pending a check.
export type SyncStatus =
  "synced" | "syncing" | "offline" | "signed-out" | "limit-reached" | "expired";

export type Workspace = {
  id: string;
  name: string;
  tabs: WorkspaceTab[];
  createdAt: number;
  updatedAt: number;
  // Explicit picks from the dashboard's customize dialog; a workspace
  // without either falls back to a hash-derived color and the default
  // cntxt mark (see App.tsx's colorFor/faviconHrefFor).
  color?: string;
  icon?: string;
  syncStatus?: SyncStatus;
  // Set by deleteWorkspace, cleared by restoreWorkspace — a workspace in
  // the trash, not actually removed from storage.local yet. Kept so the
  // dashboard can show a Trash view and so this soft-delete propagates
  // through the same push/pull path as any other edit (see
  // supabase/migrations' trash_and_purge migration and
  // purgeExpiredLocalTrash below).
  deletedAt?: number;
};

// Mirrors purge_trashed_workspaces()'s retention window in the trash_and_purge
// migration — keep both in sync if either changes. "Paid" is the same
// access_expires_at-in-the-future check create_workspace's RPC uses.
const FREE_TRASH_RETENTION_DAYS = 7;
const PAID_TRASH_RETENTION_DAYS = 30;

export function trashRetentionDays(
  accessExpiresAt: string | null | undefined,
): number {
  const isPaid = !!accessExpiresAt && Date.parse(accessExpiresAt) > Date.now();
  return isPaid ? PAID_TRASH_RETENTION_DAYS : FREE_TRASH_RETENTION_DAYS;
}

const STORAGE_KEY = "workspaces";

export async function getWorkspaces(): Promise<Workspace[]> {
  const result = await browser.storage.local.get(STORAGE_KEY);
  return (result[STORAGE_KEY] as Workspace[] | undefined) ?? [];
}

async function setWorkspaces(workspaces: Workspace[]) {
  await browser.storage.local.set({ [STORAGE_KEY]: workspaces });
}

export async function createWorkspace(
  name: string,
  tabs: WorkspaceTab[],
): Promise<Workspace> {
  const workspace: Workspace = {
    id: crypto.randomUUID(),
    name,
    tabs,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  const workspaces = await getWorkspaces();
  await setWorkspaces([...workspaces, workspace]);
  registerWorkspace(workspace);
  return workspace;
}

async function setSyncStatus(id: string, syncStatus: SyncStatus) {
  const workspaces = await getWorkspaces();
  await setWorkspaces(
    workspaces.map((w) => (w.id === id ? { ...w, syncStatus } : w)),
  );
}

// Best-effort: registers the workspace under the account's entitlement
// limit so it counts as synced. Never awaited by callers and never blocks
// or fails loudly — offline, signed out, or already at the plan's limit
// all just mean this workspace stays local-only, exactly as it does today,
// so opening a browser window (ensureWorkspaceForWindow calls this too)
// can never break because of an entitlement or network check. See
// docs/architecture-sync.md's "open question" about entitlement checks
// with no click to intercept. The result is recorded as `syncStatus` (see
// docs/workspace-sync-semantics.md) purely so the dashboard can show it —
// it's still never awaited or surfaced as an error by callers.
async function registerWorkspace(workspace: Workspace) {
  if (!supabase) return;
  await setSyncStatus(workspace.id, "syncing");
  const { error } = await supabase.rpc("create_workspace", {
    p_name: workspace.name,
    p_tabs: workspace.tabs,
    p_id: workspace.id,
  });
  if (!error) {
    await setSyncStatus(workspace.id, "synced");
    return;
  }
  console.debug("workspace not synced:", error.message);
  // 23505 = unique_violation: this id already made it to the server from an
  // earlier call whose response was never seen (e.g. the extension closed
  // mid-request) — that's a success, not a failure.
  if (error.code === "23505") {
    await setSyncStatus(workspace.id, "synced");
  } else if (error.message === "not authenticated") {
    await setSyncStatus(workspace.id, "signed-out");
  } else if (error.message === "access expired") {
    await setSyncStatus(workspace.id, "expired");
  } else if (error.message === "workspace limit reached") {
    await setSyncStatus(workspace.id, "limit-reached");
  } else {
    await setSyncStatus(workspace.id, "offline");
  }
}

// Re-checks every workspace that isn't confirmed `synced` — turns a
// stuck "syncing" (extension closed mid-request) or a stale "limit-reached"
// (user just upgraded) into an accurate status, and backfills a real status
// onto workspaces created before this field existed. Call on dashboard
// mount and whenever the session refreshes, alongside refreshEntitlements.
export async function reconcileSyncStatus() {
  const workspaces = await getWorkspaces();
  for (const w of workspaces) {
    if (w.syncStatus !== "synced") await registerWorkspace(w);
  }
}

// Fetches this account's workspaces from Supabase and merges them into
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
export async function pullRemoteWorkspaces(): Promise<number> {
  if (!supabase) return 0;
  const { data, error } = await supabase
    .from("workspaces")
    .select("id, name, tabs, created_at, updated_at, deleted_at");
  if (error) throw new Error(error.message);
  if (!data) return 0;

  const local = await getWorkspaces();
  const localById = new Map(local.map((w) => [w.id, w]));
  let applied = 0;
  const next = [...local];

  for (const row of data) {
    const existing = localById.get(row.id);
    const remote: Workspace = {
      id: row.id,
      name: row.name,
      tabs: (row.tabs as WorkspaceTab[] | null) ?? [],
      createdAt: Date.parse(row.created_at),
      updatedAt: Date.parse(row.updated_at),
      deletedAt: row.deleted_at ? Date.parse(row.deleted_at) : undefined,
      syncStatus: "synced",
    };
    if (!existing) {
      next.push(remote);
      applied++;
    } else if (remote.updatedAt > existing.updatedAt) {
      const idx = next.findIndex((w) => w.id === row.id);
      next[idx] = { ...remote, color: existing.color, icon: existing.icon };
      applied++;
    }
  }

  if (applied > 0) await setWorkspaces(next);
  return applied;
}

// Mirrors the server's purge_trashed_workspaces() locally, so a trashed
// workspace's countdown hitting zero removes it from the dashboard
// immediately rather than lagging behind the next hourly cron tick. Purely
// a local-storage cleanup — the actual server row (and the guarantee that
// it's gone even if this device never reconnects) is the migration's job,
// not this function's. Call after every pull (see utils/sync.ts), since
// that's also when the entitlements cache this depends on is freshest.
export async function purgeExpiredLocalTrash(
  accessExpiresAt: string | null | undefined,
): Promise<void> {
  const cutoffMs = trashRetentionDays(accessExpiresAt) * 24 * 60 * 60 * 1000;
  const local = await getWorkspaces();
  const kept = local.filter(
    (w) => !w.deletedAt || Date.now() - w.deletedAt < cutoffMs,
  );
  if (kept.length !== local.length) await setWorkspaces(kept);
}

// Pushes every locally-edited, already-synced workspace up to Supabase —
// M6's push half (docs/architecture-sync.md → "Push: local change →
// Supabase"). Only `syncStatus === "synced"` workspaces are eligible: a
// brand-new workspace reaches the server via create_workspace
// (registerWorkspace above), not this path, since that RPC is what enforces
// the entitlement limit; this only ever runs `update`, never `insert`.
// `lastPushedAt` (kept in utils/sync.ts's machine context, not persisted) is
// how a caller avoids re-pushing a workspace whose local updatedAt hasn't
// moved since the last successful push — without it, the "write the
// server's updatedAt back to local storage" step below would itself trigger
// another storage.onChanged, pushing the same content forever. Uses
// `.update().eq("id", ...)` rather than `.upsert()`: workspaces.user_id has
// no column default, so an upsert's (unused but still validated) insert
// branch would fail a not-null check on a row that already exists.
export async function pushDirtyWorkspaces(
  lastPushedAt: Record<string, number>,
): Promise<Record<string, number>> {
  if (!supabase) return lastPushedAt;
  const next = { ...lastPushedAt };

  for (const w of await getWorkspaces()) {
    if (w.syncStatus !== "synced") continue;
    if (w.updatedAt <= (next[w.id] ?? 0)) continue;

    const { data, error } = await supabase
      .from("workspaces")
      .update({
        name: w.name,
        tabs: w.tabs,
        deleted_at: w.deletedAt ? new Date(w.deletedAt).toISOString() : null,
      })
      .eq("id", w.id)
      .select("updated_at")
      .single();
    if (error) throw new Error(error.message);

    const serverUpdatedAt = Date.parse(data.updated_at);
    next[w.id] = serverUpdatedAt;
    const fresh = await getWorkspaces();
    await setWorkspaces(
      fresh.map((x) =>
        x.id === w.id ? { ...x, updatedAt: serverUpdatedAt } : x,
      ),
    );
  }

  return next;
}

export async function updateWorkspace(
  id: string,
  patch: Partial<Pick<Workspace, "name" | "tabs" | "color" | "icon">>,
) {
  const workspaces = await getWorkspaces();
  await setWorkspaces(
    workspaces.map((w) =>
      w.id === id ? { ...w, ...patch, updatedAt: Date.now() } : w,
    ),
  );
}

// Soft delete: moves the workspace to the Trash instead of removing it,
// local-first like every other write here — it never blocks on a server
// round-trip. `updatedAt` bumps too, so pushDirtyWorkspaces picks this up
// like any other edit and propagates deletedAt to the server.
export async function deleteWorkspace(id: string) {
  const workspaces = await getWorkspaces();
  await setWorkspaces(
    workspaces.map((w) =>
      w.id === id ? { ...w, deletedAt: Date.now(), updatedAt: Date.now() } : w,
    ),
  );
}

export async function restoreWorkspace(id: string) {
  const workspaces = await getWorkspaces();
  await setWorkspaces(
    workspaces.map((w) =>
      w.id === id ? { ...w, deletedAt: undefined, updatedAt: Date.now() } : w,
    ),
  );
}

// The Trash view's explicit, irreversible "Delete forever" — unlike every
// other mutation here, this doesn't wait for the next push cycle: it fires
// a real delete at Supabase immediately (best-effort, same fire-and-forget
// style as registerWorkspace — offline or signed out just means the
// server-side row is left for purge_trashed_workspaces to catch later).
export async function permanentlyDeleteWorkspace(id: string) {
  const workspaces = await getWorkspaces();
  await setWorkspaces(workspaces.filter((w) => w.id !== id));
  await supabase?.from("workspaces").delete().eq("id", id);
}
