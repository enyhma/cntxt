import { supabase } from "./supabase";

// Unset on a tab = not part of any phase's roadmap — always shown,
// regardless of which phase is active. Identity across a resync is by URL
// (see missionWindowMachine.ts's syncTabs), matching how the rest of this
// codebase already treats tab identity; a known, pre-existing weak spot is
// a duplicate open tab with the same URL, not something this adds.
export type MissionTab = { url: string; title: string; phaseId?: string };

export type PhaseStatus = "pending" | "active" | "done";
export type Phase = { id: string; name: string; status: PhaseStatus };

// See docs/workspace-sync-semantics.md for what each state means and how
// the dashboard should render it. Undefined (legacy missions predating
// this field) is treated the same as "syncing" — unknown, pending a check.
export type SyncStatus =
  "synced" | "syncing" | "offline" | "signed-out" | "limit-reached" | "expired";

export type Mission = {
  id: string;
  name: string;
  tabs: MissionTab[];
  createdAt: number;
  updatedAt: number;
  // Explicit picks from the dashboard's customize dialog; a mission
  // without either falls back to a hash-derived color and the default
  // cntxt mark (see App.tsx's colorFor/faviconHrefFor).
  color?: string;
  icon?: string;
  syncStatus?: SyncStatus;
  // Null/undefined = ungrouped, exactly like every mission today. Set via
  // utils/folders.ts, never required — "every window is a mission" stays
  // true with no folder involved at all.
  folderId?: string | null;
  // Set by deleteMission, cleared by restoreMission — a mission in
  // the trash, not actually removed from storage.local yet. Kept so the
  // dashboard can show a Trash view and so this soft-delete propagates
  // through the same push/pull path as any other edit (see
  // supabase/migrations' trash_and_purge migration and
  // purgeExpiredLocalTrash below).
  deletedAt?: number;
  // Absent/empty = no roadmap — the mission behaves exactly as it does
  // today, a flat tab list. Set via phaseMachine.ts (utils/phaseMachine.ts),
  // never required.
  phases?: Phase[];
  activePhaseId?: string;
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

// Kept as "workspaces" — this is the storage.local key for already-installed
// users' data. Renaming it would silently orphan every existing local
// mission with no user-facing benefit; the concept is Mission everywhere
// else, this string is just storage wire-compat.
const STORAGE_KEY = "workspaces";

export async function getMissions(): Promise<Mission[]> {
  const result = await browser.storage.local.get(STORAGE_KEY);
  return (result[STORAGE_KEY] as Mission[] | undefined) ?? [];
}

async function setMissions(missions: Mission[]) {
  await browser.storage.local.set({ [STORAGE_KEY]: missions });
}

export async function createMission(
  name: string,
  tabs: MissionTab[],
): Promise<Mission> {
  const mission: Mission = {
    id: crypto.randomUUID(),
    name,
    tabs,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  const missions = await getMissions();
  await setMissions([...missions, mission]);
  registerMission(mission);
  return mission;
}

async function setSyncStatus(id: string, syncStatus: SyncStatus) {
  const missions = await getMissions();
  await setMissions(
    missions.map((m) => (m.id === id ? { ...m, syncStatus } : m)),
  );
}

// Best-effort: registers the mission under the account's entitlement
// limit so it counts as synced. Never awaited by callers and never blocks
// or fails loudly — offline, signed out, or already at the plan's limit
// all just mean this mission stays local-only, exactly as it does today,
// so opening a browser window (ensureMissionForWindow calls this too)
// can never break because of an entitlement or network check. See
// docs/architecture-sync.md's "open question" about entitlement checks
// with no click to intercept. The result is recorded as `syncStatus` (see
// docs/workspace-sync-semantics.md) purely so the dashboard can show it —
// it's still never awaited or surfaced as an error by callers.
async function registerMission(mission: Mission) {
  if (!supabase) return;
  await setSyncStatus(mission.id, "syncing");
  // Table/RPC/param names are the Supabase schema's own identifiers — still
  // literally "workspace" there on purpose (see the rename plan: renaming
  // the backend is a separate, riskier migration).
  const { error } = await supabase.rpc("create_workspace", {
    p_name: mission.name,
    p_tabs: mission.tabs,
    p_id: mission.id,
  });
  if (!error) {
    await setSyncStatus(mission.id, "synced");
    return;
  }
  console.debug("mission not synced:", error.message);
  // 23505 = unique_violation: this id already made it to the server from an
  // earlier call whose response was never seen (e.g. the extension closed
  // mid-request) — that's a success, not a failure.
  if (error.code === "23505") {
    await setSyncStatus(mission.id, "synced");
  } else if (error.message === "not authenticated") {
    await setSyncStatus(mission.id, "signed-out");
  } else if (error.message === "access expired") {
    await setSyncStatus(mission.id, "expired");
  } else if (error.message === "workspace limit reached") {
    await setSyncStatus(mission.id, "limit-reached");
  } else {
    await setSyncStatus(mission.id, "offline");
  }
}

// Re-checks every mission that isn't confirmed `synced` — turns a
// stuck "syncing" (extension closed mid-request) or a stale "limit-reached"
// (user just upgraded) into an accurate status, and backfills a real status
// onto missions created before this field existed. Call on dashboard
// mount and whenever the session refreshes, alongside refreshEntitlements.
export async function reconcileMissionSyncStatus() {
  const missions = await getMissions();
  for (const m of missions) {
    if (m.syncStatus !== "synced") await registerMission(m);
  }
}

// Fetches this account's missions from Supabase and merges them into
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
export async function pullRemoteMissions(): Promise<number> {
  if (!supabase) return 0;
  const { data, error } = await supabase
    .from("workspaces")
    .select(
      "id, name, tabs, created_at, updated_at, deleted_at, folder_id, phases, active_phase_id",
    );
  if (error) throw new Error(error.message);
  if (!data) return 0;

  const local = await getMissions();
  const localById = new Map(local.map((m) => [m.id, m]));
  let applied = 0;
  const next = [...local];

  for (const row of data) {
    const existing = localById.get(row.id);
    const remote: Mission = {
      id: row.id,
      name: row.name,
      tabs: (row.tabs as MissionTab[] | null) ?? [],
      createdAt: Date.parse(row.created_at),
      updatedAt: Date.parse(row.updated_at),
      deletedAt: row.deleted_at ? Date.parse(row.deleted_at) : undefined,
      folderId: row.folder_id,
      phases: (row.phases as Phase[] | null) ?? undefined,
      activePhaseId: row.active_phase_id ?? undefined,
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

  if (applied > 0) await setMissions(next);
  return applied;
}

// Mirrors the server's purge_trashed_workspaces() locally, so a trashed
// mission's countdown hitting zero removes it from the dashboard
// immediately rather than lagging behind the next hourly cron tick. Purely
// a local-storage cleanup — the actual server row (and the guarantee that
// it's gone even if this device never reconnects) is the migration's job,
// not this function's. Call after every pull (see utils/sync.ts), since
// that's also when the entitlements cache this depends on is freshest.
export async function purgeExpiredLocalTrash(
  accessExpiresAt: string | null | undefined,
): Promise<void> {
  const cutoffMs = trashRetentionDays(accessExpiresAt) * 24 * 60 * 60 * 1000;
  const local = await getMissions();
  const kept = local.filter(
    (m) => !m.deletedAt || Date.now() - m.deletedAt < cutoffMs,
  );
  if (kept.length !== local.length) await setMissions(kept);
}

// Pushes every locally-edited, already-synced mission up to Supabase —
// M6's push half (docs/architecture-sync.md → "Push: local change →
// Supabase"). Only `syncStatus === "synced"` missions are eligible: a
// brand-new mission reaches the server via create_workspace
// (registerMission above), not this path, since that RPC is what enforces
// the entitlement limit; this only ever runs `update`, never `insert`.
// `lastPushedAt` (kept in utils/sync.ts's machine context, not persisted) is
// how a caller avoids re-pushing a mission whose local updatedAt hasn't
// moved since the last successful push — without it, the "write the
// server's updatedAt back to local storage" step below would itself trigger
// another storage.onChanged, pushing the same content forever. Uses
// `.update().eq("id", ...)` rather than `.upsert()`: workspaces.user_id has
// no column default, so an upsert's (unused but still validated) insert
// branch would fail a not-null check on a row that already exists.
export async function pushDirtyMissions(
  lastPushedAt: Record<string, number>,
): Promise<Record<string, number>> {
  if (!supabase) return lastPushedAt;
  const next = { ...lastPushedAt };

  for (const m of await getMissions()) {
    if (m.syncStatus !== "synced") continue;
    if (m.updatedAt <= (next[m.id] ?? 0)) continue;

    const { data, error } = await supabase
      .from("workspaces")
      .update({
        name: m.name,
        tabs: m.tabs,
        deleted_at: m.deletedAt ? new Date(m.deletedAt).toISOString() : null,
        folder_id: m.folderId ?? null,
        phases: m.phases ?? [],
        active_phase_id: m.activePhaseId ?? null,
      })
      .eq("id", m.id)
      .select("updated_at")
      .single();
    if (error) throw new Error(error.message);

    const serverUpdatedAt = Date.parse(data.updated_at);
    next[m.id] = serverUpdatedAt;
    const fresh = await getMissions();
    await setMissions(
      fresh.map((x) =>
        x.id === m.id ? { ...x, updatedAt: serverUpdatedAt } : x,
      ),
    );
  }

  return next;
}

export async function updateMission(
  id: string,
  patch: Partial<
    Pick<
      Mission,
      | "name"
      | "tabs"
      | "color"
      | "icon"
      | "folderId"
      | "phases"
      | "activePhaseId"
    >
  >,
) {
  const missions = await getMissions();
  await setMissions(
    missions.map((m) =>
      m.id === id ? { ...m, ...patch, updatedAt: Date.now() } : m,
    ),
  );
}

// Soft delete: moves the mission to the Trash instead of removing it,
// local-first like every other write here — it never blocks on a server
// round-trip. `updatedAt` bumps too, so pushDirtyMissions picks this up
// like any other edit and propagates deletedAt to the server.
export async function deleteMission(id: string) {
  const missions = await getMissions();
  await setMissions(
    missions.map((m) =>
      m.id === id ? { ...m, deletedAt: Date.now(), updatedAt: Date.now() } : m,
    ),
  );
}

export async function restoreMission(id: string) {
  const missions = await getMissions();
  await setMissions(
    missions.map((m) =>
      m.id === id ? { ...m, deletedAt: undefined, updatedAt: Date.now() } : m,
    ),
  );
}

// The Trash view's explicit, irreversible "Delete forever" — unlike every
// other mutation here, this doesn't wait for the next push cycle: it fires
// a real delete at Supabase immediately (best-effort, same fire-and-forget
// style as registerMission — offline or signed out just means the
// server-side row is left for purge_trashed_workspaces to catch later).
export async function permanentlyDeleteMission(id: string) {
  const missions = await getMissions();
  await setMissions(missions.filter((m) => m.id !== id));
  await supabase?.from("workspaces").delete().eq("id", id);
}
