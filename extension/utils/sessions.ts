import { supabase } from "./supabase";
import { getCachedEntitlements } from "./entitlements";
import { getWindowBindingMap, setWindowBinding } from "./session";
import { getGroups, updateGroup, type GroupTab } from "./groups";
import { getFolders } from "./folders";
import { liveChildGroups } from "./projectLiveTabs";
import { partitionProjectWindowTabs } from "./windowSyncMachine";
import { snapshotTabs } from "./tabs";
import { openMissingTabs } from "./tabOps";

// An append-only history record: "every open, cntxt-bound window at this
// moment" — captured automatically every ~15 minutes (see
// entrypoints/background.ts's alarm), never edited after creation and never
// auto-deleted (unlike Trash). One row per capture tick, one leg per window.
export type SessionLeg = {
  entityTable: "groups" | "folders";
  entityId: string;
  // Denormalized snapshot at capture time, not a live join — so a session
  // still displays sensibly even after the group/folder it refers to is
  // later deleted/purged.
  entityName: string;
  tabs: GroupTab[];
};

export type Session = {
  id: string;
  capturedAt: number;
  windows: SessionLeg[];
  syncStatus?: "synced" | "syncing" | "offline" | "signed-out";
};

const STORAGE_KEY = "sessions";

// Local storage keeps only a bounded recent cache (see
// pruneOldLocalSessions) — Supabase is the full, unbounded archive. This
// number is unrelated to Settings.autoArchiveDays (the user-facing
// auto-archive threshold) — don't conflate the two, they just happen to
// both be "N days".
const LOCAL_CACHE_DAYS = 7;

export async function getSessions(): Promise<Session[]> {
  const result = await browser.storage.local.get(STORAGE_KEY);
  return (result[STORAGE_KEY] as Session[] | undefined) ?? [];
}

async function setSessions(sessions: Session[]) {
  await browser.storage.local.set({ [STORAGE_KEY]: sessions });
}

async function setSyncStatus(id: string, syncStatus: Session["syncStatus"]) {
  const sessions = await getSessions();
  await setSessions(
    sessions.map((s) => (s.id === id ? { ...s, syncStatus } : s)),
  );
}

// Fire-and-forget, same contract as registerResource — a session is
// immutable after creation, so unlike registerGroup/registerFolder there's
// no pushDirtySessions: there's nothing to push later, only this one insert.
async function registerSession(session: Session) {
  if (!supabase) return;
  await setSyncStatus(session.id, "syncing");
  const { error } = await supabase.from("sessions").insert({
    id: session.id,
    captured_at: new Date(session.capturedAt).toISOString(),
    windows: session.windows,
  });
  if (!error) {
    await setSyncStatus(session.id, "synced");
    return;
  }
  console.debug("session not synced:", error.message);
  if (error.code === "23505") {
    await setSyncStatus(session.id, "synced");
  } else if (error.message === "not authenticated") {
    await setSyncStatus(session.id, "signed-out");
  } else {
    await setSyncStatus(session.id, "offline");
  }
}

function sortedLegs(legs: SessionLeg[]) {
  return [...legs].sort((a, b) => a.entityId.localeCompare(b.entityId));
}

function legsEqual(a: SessionLeg[], b: SessionLeg[]): boolean {
  return JSON.stringify(sortedLegs(a)) === JSON.stringify(sortedLegs(b));
}

// Snapshots every currently-open, cntxt-bound window and stitches them into
// one Session — skipping the write if nothing has changed since the most
// recent capture, so idling doesn't spam a new row every tick.
//
// Timeline is Pro-only (see supabase/migrations's has_sync_access and
// marketing/src/pages/pricing.astro) — this is a purely local feature, so
// unlike Sync there's no RLS layer beneath it, only this check. Advisory,
// same tradeoff as every other use of getCachedEntitlements(): good enough
// to stop Free/Basic from accumulating history, not meant to resist a
// deliberately modified client.
export async function captureSession(): Promise<void> {
  const entitlements = await getCachedEntitlements();
  if (!entitlements?.proActive) return;

  const bindingMap = await getWindowBindingMap();
  const [groups, folders] = await Promise.all([getGroups(), getFolders()]);
  const legs: SessionLeg[] = [];

  for (const [windowIdStr, binding] of Object.entries(bindingMap)) {
    const windowId = Number(windowIdStr);
    // A closed-but-not-yet-pruned window either rejects (real browsers) or
    // resolves undefined (this repo's test fake) — handle both rather than
    // assuming either.
    let win;
    try {
      win = await browser.windows.get(windowId);
    } catch {
      continue;
    }
    if (!win) continue;

    if (binding.kind === "group") {
      const group = groups.find((q) => q.id === binding.groupId);
      if (!group) continue;
      const tabs = await snapshotTabs(windowId);
      legs.push({
        entityTable: "groups",
        entityId: group.id,
        entityName: group.name,
        tabs,
      });
      await updateGroup(group.id, { lastSeenAt: Date.now() });
      continue;
    }

    const project = folders.find((f) => f.id === binding.projectId);
    if (!project) continue;

    // A Project window logs one leg for its own tabs, plus one leg per live
    // child Group that currently has tabs open — mirrors
    // windowSyncMachine.ts's own partition of the same window, reusing its
    // helper rather than re-deriving ownership another way.
    const { projectTabs, groupTabs } = await partitionProjectWindowTabs(
      windowId,
      project.id,
      groups,
    );
    legs.push({
      entityTable: "folders",
      entityId: project.id,
      entityName: project.name,
      tabs: projectTabs,
    });
    for (const group of liveChildGroups(project.id, groups)) {
      const entry = groupTabs.get(group.id);
      if (!entry || entry.tabs.length === 0) continue;
      legs.push({
        entityTable: "groups",
        entityId: group.id,
        entityName: group.name,
        tabs: entry.tabs,
      });
      await updateGroup(group.id, { lastSeenAt: Date.now() });
    }
  }

  if (legs.length === 0) return; // nothing bound/open — nothing to capture

  const local = await getSessions();
  const mostRecent = local[0];
  if (mostRecent && legsEqual(mostRecent.windows, legs)) return; // unchanged

  const session: Session = {
    id: crypto.randomUUID(),
    capturedAt: Date.now(),
    windows: legs,
  };
  await setSessions([session, ...local]);
  await registerSession(session);
}

// Local-cache-only cleanup — never touches the Supabase row, only the local
// mirror (see LOCAL_CACHE_DAYS's own comment on why this is a different
// number from the user-facing auto-archive threshold).
export async function pruneOldLocalSessions(
  days: number = LOCAL_CACHE_DAYS,
): Promise<void> {
  const cutoffMs = days * 24 * 60 * 60 * 1000;
  const local = await getSessions();
  const kept = local.filter((s) => Date.now() - s.capturedAt < cutoffMs);
  if (kept.length !== local.length) await setSessions(kept);
}

// Bounded pull matching the same local-cache window — immutable rows, so
// just add whatever's missing locally, no last-write-wins merge needed.
export async function pullRemoteSessions(): Promise<number> {
  if (!supabase) return 0;
  const cutoffIso = new Date(
    Date.now() - LOCAL_CACHE_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();
  const { data, error } = await supabase
    .from("sessions")
    .select("id, captured_at, windows")
    .gte("captured_at", cutoffIso)
    .order("captured_at", { ascending: false });
  if (error) throw new Error(error.message);
  if (!data) return 0;

  const local = await getSessions();
  const localIds = new Set(local.map((s) => s.id));
  const missing = data
    .filter((row) => !localIds.has(row.id))
    .map((row): Session => ({
      id: row.id,
      capturedAt: Date.parse(row.captured_at),
      windows: (row.windows as SessionLeg[] | null) ?? [],
      syncStatus: "synced",
    }));

  if (missing.length > 0) {
    const next = [...local, ...missing].sort(
      (a, b) => b.capturedAt - a.capturedAt,
    );
    await setSessions(next);
  }
  return missing.length;
}

// Opens one new window per leg, bound + populated the same way
// restoreMachine's openBindingTabs does for a single target — but this is a
// plain loop, not a state machine: restoreMachine is hardwired to replace
// browser.windows.getCurrent() (close-then-open on the SAME window), which
// doesn't fit "create N new windows" at all. Sequential by design (a
// handful of windows, no need to race windows.create calls). Relies on
// background.ts's windows.onCreated listener to keep each new window
// syncing afterward.
export async function restoreSession(session: Session): Promise<void> {
  for (const leg of session.windows) {
    const win = await browser.windows.create(
      leg.tabs[0] ? { url: leg.tabs[0].url } : {},
    );
    if (win?.id === undefined) continue;
    await setWindowBinding(
      win.id,
      leg.entityTable === "groups"
        ? { kind: "group", groupId: leg.entityId }
        : { kind: "project", projectId: leg.entityId },
    );
    await openMissingTabs(win.id, leg.tabs);
  }
}
