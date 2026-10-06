import { supabase } from "./supabase";
import { getWorkspaces, updateWorkspace } from "./workspaces";

// Area/Project hierarchy: an Area is a folder with parentId null, a Project
// is a folder whose parent is an Area. See
// supabase/migrations/20261005130000_folders.sql for why this is one
// self-referencing table instead of two fixed tiers.
export type Folder = {
  id: string;
  name: string;
  parentId: string | null;
  color?: string;
  createdAt: number;
  updatedAt: number;
  // Unlike Workspace, there's no entitlement RPC here (folders aren't
  // quota-gated), so there's no "limit-reached"/"expired" status to map to
  // — an RLS rejection (e.g. lapsed access) just falls into "offline" like
  // any other write failure. See the same gap noted for pushDirtyWorkspaces.
  syncStatus?: "synced" | "syncing" | "offline" | "signed-out";
};

const STORAGE_KEY = "folders";

export async function getFolders(): Promise<Folder[]> {
  const result = await browser.storage.local.get(STORAGE_KEY);
  return (result[STORAGE_KEY] as Folder[] | undefined) ?? [];
}

async function setFolders(folders: Folder[]) {
  await browser.storage.local.set({ [STORAGE_KEY]: folders });
}

async function setSyncStatus(id: string, syncStatus: Folder["syncStatus"]) {
  const folders = await getFolders();
  await setFolders(
    folders.map((f) => (f.id === id ? { ...f, syncStatus } : f)),
  );
}

// Best-effort, fire-and-forget — same contract as registerWorkspace: never
// awaited by createFolder, so a creation can never block on network/auth.
async function registerFolder(folder: Folder) {
  if (!supabase) return;
  await setSyncStatus(folder.id, "syncing");
  const { error } = await supabase.from("folders").insert({
    id: folder.id,
    name: folder.name,
    parent_id: folder.parentId,
    color: folder.color,
  });
  if (!error) {
    await setSyncStatus(folder.id, "synced");
    return;
  }
  console.debug("folder not synced:", error.message);
  if (error.code === "23505") {
    await setSyncStatus(folder.id, "synced");
  } else if (error.message === "not authenticated") {
    await setSyncStatus(folder.id, "signed-out");
  } else {
    await setSyncStatus(folder.id, "offline");
  }
}

export async function createFolder(
  name: string,
  parentId: string | null = null,
): Promise<Folder> {
  const folder: Folder = {
    id: crypto.randomUUID(),
    name,
    parentId,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  const folders = await getFolders();
  await setFolders([...folders, folder]);
  registerFolder(folder);
  return folder;
}

// Mirrors reconcileSyncStatus in utils/workspaces.ts.
export async function reconcileFolderSyncStatus() {
  const folders = await getFolders();
  for (const f of folders) {
    if (f.syncStatus !== "synced") await registerFolder(f);
  }
}

// Mirrors pullRemoteWorkspaces: last-write-wins merge by updated_at.
export async function pullRemoteFolders(): Promise<number> {
  if (!supabase) return 0;
  const { data, error } = await supabase
    .from("folders")
    .select("id, name, parent_id, color, created_at, updated_at");
  if (error) throw new Error(error.message);
  if (!data) return 0;

  const local = await getFolders();
  const localById = new Map(local.map((f) => [f.id, f]));
  let applied = 0;
  const next = [...local];

  for (const row of data) {
    const existing = localById.get(row.id);
    const remote: Folder = {
      id: row.id,
      name: row.name,
      parentId: row.parent_id,
      color: row.color ?? undefined,
      createdAt: Date.parse(row.created_at),
      updatedAt: Date.parse(row.updated_at),
      syncStatus: "synced",
    };
    if (!existing) {
      next.push(remote);
      applied++;
    } else if (remote.updatedAt > existing.updatedAt) {
      next[next.findIndex((f) => f.id === row.id)] = remote;
      applied++;
    }
  }

  if (applied > 0) await setFolders(next);
  return applied;
}

// Mirrors pushDirtyWorkspaces, including the same lastPushedAt dedup
// contract — shares its map with workspaces since ids are UUIDs from two
// different tables and can't collide.
export async function pushDirtyFolders(
  lastPushedAt: Record<string, number>,
): Promise<Record<string, number>> {
  if (!supabase) return lastPushedAt;
  const next = { ...lastPushedAt };

  for (const f of await getFolders()) {
    if (f.syncStatus !== "synced") continue;
    if (f.updatedAt <= (next[f.id] ?? 0)) continue;

    const { data, error } = await supabase
      .from("folders")
      .update({ name: f.name, parent_id: f.parentId, color: f.color })
      .eq("id", f.id)
      .select("updated_at")
      .single();
    if (error) throw new Error(error.message);

    const serverUpdatedAt = Date.parse(data.updated_at);
    next[f.id] = serverUpdatedAt;
    const fresh = await getFolders();
    await setFolders(
      fresh.map((x) =>
        x.id === f.id ? { ...x, updatedAt: serverUpdatedAt } : x,
      ),
    );
  }

  return next;
}

export async function updateFolder(
  id: string,
  patch: Partial<Pick<Folder, "name" | "parentId" | "color">>,
) {
  const folders = await getFolders();
  await setFolders(
    folders.map((f) =>
      f.id === id ? { ...f, ...patch, updatedAt: Date.now() } : f,
    ),
  );
}

// Hard delete — no trash tier for folders (unlike workspaces), nothing in
// the PRD asks for one yet. Mirrors the server's "on delete cascade"
// (descendant folders) and "on delete set null" (workspaces.folder_id)
// locally so the UI doesn't show stale nesting until the next pull
// reconciles it.
export async function deleteFolder(id: string) {
  const folders = await getFolders();
  const toRemove = new Set([id]);
  // Folders only ever nest one level deep in practice, but this walks any
  // depth rather than assuming it, since nothing in the schema enforces two.
  let grew = true;
  while (grew) {
    grew = false;
    for (const f of folders) {
      if (f.parentId && toRemove.has(f.parentId) && !toRemove.has(f.id)) {
        toRemove.add(f.id);
        grew = true;
      }
    }
  }

  await setFolders(folders.filter((f) => !toRemove.has(f.id)));

  const workspaces = await getWorkspaces();
  for (const w of workspaces) {
    if (w.folderId && toRemove.has(w.folderId)) {
      await updateWorkspace(w.id, { folderId: null });
    }
  }

  await supabase?.from("folders").delete().eq("id", id);
}
