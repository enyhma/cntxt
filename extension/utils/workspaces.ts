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
};

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

// Fetches this account's workspaces from Supabase and adds any that aren't
// already in storage.local — covers a fresh/empty local profile (reinstall,
// new device, or storage cleared) where the account already has workspaces
// synced from another session. Additive only: never overwrites or removes a
// local workspace, even if the server's copy has since changed — that half
// of M6's pull (docs/architecture-sync.md → "Pull + conflict resolution",
// comparing updated_at) isn't built yet, so an existing local edit always
// wins over its own server row. Call once per sign-in, alongside
// reconcileSyncStatus (see docs/implementation-plan-sync.md M6). Returns
// how many workspaces it added, so a manual "Pull now" trigger (App.tsx)
// can report something more useful than silence. Throws on a fetch error
// instead of swallowing it — a caller that only sees "0 added" otherwise
// can't tell "already up to date" from "the request failed," which is
// exactly the ambiguity that made a real RLS/network failure look like a
// no-op during testing.
export async function pullRemoteWorkspaces(): Promise<number> {
  if (!supabase) return 0;
  const { data, error } = await supabase
    .from("workspaces")
    .select("id, name, tabs, created_at, updated_at");
  if (error) throw new Error(error.message);
  if (!data) return 0;

  const local = await getWorkspaces();
  const localIds = new Set(local.map((w) => w.id));
  const missing: Workspace[] = data
    .filter((row) => !localIds.has(row.id))
    .map((row) => ({
      id: row.id,
      name: row.name,
      tabs: (row.tabs as WorkspaceTab[] | null) ?? [],
      createdAt: Date.parse(row.created_at),
      updatedAt: Date.parse(row.updated_at),
      syncStatus: "synced",
    }));

  if (missing.length > 0) await setWorkspaces([...local, ...missing]);
  return missing.length;
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

export async function deleteWorkspace(id: string) {
  const workspaces = await getWorkspaces();
  await setWorkspaces(workspaces.filter((w) => w.id !== id));
}
