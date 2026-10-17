import { supabase } from "./supabase";
import { getGroups, updateGroup } from "./groups";
import type { GroupTab } from "./groups";
import { withStorageLock } from "./storageLock";

// Area/Project hierarchy, one self-referencing table instead of two fixed
// tiers — see supabase/migrations/20261005130000_folders.sql. `kind` is the
// explicit tier marker: depth-based inference (parentId === null => Area)
// broke once a Project can be created unparented (an ad-hoc, window-created
// Project — see attach.ts), which looks identical to an Area by nesting
// alone. A third tier, Section, existed briefly for resources to outlive
// their originating Group; removed once Project itself took over that role
// (see supabase/migrations/20261007180000_remove_sections.sql) — a
// Resource now attaches directly to a Project instead.
export type FolderKind = "area" | "project";

export type Folder = {
  id: string;
  name: string;
  parentId: string | null;
  kind: FolderKind;
  color?: string;
  createdAt: number;
  updatedAt: number;
  // Project-only: this Project's own live tab list, and which child Group
  // (if any) currently has its tabs swapped into this Project's window in
  // place of its own. Area rows never populate these, same as `color`
  // being a field not every tier uses.
  tabs?: GroupTab[];
  activeGroupId?: string;
  // "Hidden but kept" — same shape and meaning as Group.archivedAt (see
  // that field's own comment). Archiving a Project cascades to archive its
  // child Groups too (see archiveFolder below); Areas have no cascade.
  archivedAt?: number;
  // "limit-reached"/"expired" now apply to a Project-kind folder (it's
  // quota-gated via create_project, see registerProject below) — an Area
  // row will just never hit them.
  syncStatus?:
    | "synced"
    | "syncing"
    | "offline"
    | "signed-out"
    | "limit-reached"
    | "expired";
};

const STORAGE_KEY = "folders";

export async function getFolders(): Promise<Folder[]> {
  const result = await browser.storage.local.get(STORAGE_KEY);
  return (result[STORAGE_KEY] as Folder[] | undefined) ?? [];
}

async function setFolders(folders: Folder[]) {
  await browser.storage.local.set({ [STORAGE_KEY]: folders });
}

// Mirrors utils/groups.ts's mutateGroups — see its own comment for why
// every mutation below goes through this instead of its own
// getFolders()+setFolders() pair.
async function mutateFolders(
  mutator: (folders: Folder[]) => Folder[] | undefined,
): Promise<Folder[]> {
  return withStorageLock(STORAGE_KEY, async () => {
    const current = await getFolders();
    const next = mutator(current);
    if (next === undefined) return current;
    await setFolders(next);
    return next;
  });
}

async function setSyncStatus(id: string, syncStatus: Folder["syncStatus"]) {
  await mutateFolders((folders) =>
    folders.map((f) => (f.id === id ? { ...f, syncStatus } : f)),
  );
}

// Best-effort, fire-and-forget — same contract as registerGroup: never
// awaited by createFolder, so a creation can never block on network/auth.
// Area only — Project goes through registerProject below instead, since
// it's quota-gated and a plain Area insert isn't.
async function registerFolder(folder: Folder) {
  if (!supabase) return;
  await setSyncStatus(folder.id, "syncing");
  const { error } = await supabase.from("folders").insert({
    id: folder.id,
    name: folder.name,
    parent_id: folder.parentId,
    kind: folder.kind,
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

// Project's counterpart to registerFolder: goes through the create_project
// RPC instead of a plain insert, since ad-hoc window-created Projects (and
// the dashboard's explicit "+ Project" button) must stay quota-gated the
// same way Group creation always has been — see
// supabase/migrations/20261007170000_project_quest_restructure.sql's
// count_group_like (Projects and Groups share one max_workspaces pool).
// Same fire-and-forget contract and error-mapping as registerGroup.
async function registerProject(folder: Folder) {
  if (!supabase) return;
  await setSyncStatus(folder.id, "syncing");
  const { error } = await supabase.rpc("create_project", {
    p_name: folder.name,
    p_parent_id: folder.parentId,
    p_id: folder.id,
  });
  if (!error) {
    await setSyncStatus(folder.id, "synced");
    return;
  }
  console.debug("project not synced:", error.message);
  if (error.code === "23505") {
    await setSyncStatus(folder.id, "synced");
  } else if (error.message === "not authenticated") {
    await setSyncStatus(folder.id, "signed-out");
  } else if (error.message === "access expired") {
    await setSyncStatus(folder.id, "expired");
  } else if (error.message === "workspace limit reached") {
    await setSyncStatus(folder.id, "limit-reached");
  } else {
    await setSyncStatus(folder.id, "offline");
  }
}

export async function createFolder(
  name: string,
  parentId: string | null,
  kind: FolderKind,
): Promise<Folder> {
  const folder: Folder = {
    id: crypto.randomUUID(),
    name,
    parentId,
    kind,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...(kind === "project" ? { tabs: [] } : {}),
  };
  await mutateFolders((folders) => [...folders, folder]);
  if (kind === "project") registerProject(folder);
  else registerFolder(folder);
  return folder;
}

// Mirrors reconcileGroupSyncStatus in utils/groups.ts.
export async function reconcileFolderSyncStatus() {
  const folders = await getFolders();
  for (const f of folders) {
    if (f.syncStatus !== "synced") await registerFolder(f);
  }
}

// Mirrors pullRemoteGroups: last-write-wins merge by updated_at.
export async function pullRemoteFolders(): Promise<number> {
  if (!supabase) return 0;
  const { data, error } = await supabase
    .from("folders")
    .select(
      "id, name, parent_id, kind, color, created_at, updated_at, tabs, active_group_id, archived_at",
    );
  if (error) throw new Error(error.message);
  if (!data) return 0;

  let applied = 0;
  await mutateFolders((local) => {
    const localById = new Map(local.map((f) => [f.id, f]));
    const next = [...local];

    for (const row of data) {
      const existing = localById.get(row.id);
      const remote: Folder = {
        id: row.id,
        name: row.name,
        parentId: row.parent_id,
        kind: row.kind,
        color: row.color ?? undefined,
        createdAt: Date.parse(row.created_at),
        updatedAt: Date.parse(row.updated_at),
        tabs: (row.tabs as GroupTab[] | null) ?? [],
        activeGroupId: row.active_group_id ?? undefined,
        archivedAt: row.archived_at ? Date.parse(row.archived_at) : undefined,
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

    return applied > 0 ? next : undefined;
  });
  return applied;
}

// Mirrors pushDirtyGroups, including the same lastPushedAt dedup
// contract — shares its map with groups since ids are UUIDs from two
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
      .update({
        name: f.name,
        parent_id: f.parentId,
        color: f.color,
        tabs: f.tabs ?? [],
        active_group_id: f.activeGroupId ?? null,
        archived_at: f.archivedAt ? new Date(f.archivedAt).toISOString() : null,
      })
      .eq("id", f.id)
      .select("updated_at")
      .single();
    if (error) throw new Error(error.message);

    const serverUpdatedAt = Date.parse(data.updated_at);
    next[f.id] = serverUpdatedAt;
    await mutateFolders((fresh) =>
      fresh.map((x) =>
        x.id === f.id ? { ...x, updatedAt: serverUpdatedAt } : x,
      ),
    );
  }

  return next;
}

export async function updateFolder(
  id: string,
  patch: Partial<
    Pick<
      Folder,
      "name" | "parentId" | "color" | "tabs" | "activeGroupId" | "archivedAt"
    >
  >,
) {
  await mutateFolders((folders) =>
    folders.map((f) =>
      f.id === id ? { ...f, ...patch, updatedAt: Date.now() } : f,
    ),
  );
}

// "Hidden but kept" — unlike deleteFolder, never removes anything. When
// `id` is a Project, also archives every group directly nested under it
// (one level, same as deleteFolder's folderId reparenting walk below) —
// cascading down matches how a Project visually "contains" its groups
// everywhere else in the UI. Does NOT recurse into child folders (an Area
// archiving its child Projects was never asked for) and unarchiveFolder
// deliberately does NOT cascade back (see that function's own comment).
export async function archiveFolder(id: string) {
  let folder: Folder | undefined;
  await mutateFolders((folders) => {
    folder = folders.find((f) => f.id === id);
    return folders.map((f) =>
      f.id === id ? { ...f, archivedAt: Date.now(), updatedAt: Date.now() } : f,
    );
  });
  if (folder?.kind === "project") {
    const groups = await getGroups();
    for (const q of groups) {
      if (q.folderId === id)
        await updateGroup(q.id, { archivedAt: Date.now() });
    }
  }
}

// Deliberately asymmetric with archiveFolder's cascade: un-hiding a Project
// shouldn't drag back into view a Group that was separately, manually
// archived for its own reason.
export async function unarchiveFolder(id: string) {
  await mutateFolders((folders) =>
    folders.map((f) =>
      f.id === id ? { ...f, archivedAt: undefined, updatedAt: Date.now() } : f,
    ),
  );
}

// Hard delete — no trash tier for folders (unlike groups), nothing in
// the PRD asks for one yet. Mirrors the server's "on delete cascade"
// (descendant folders) and "on delete set null" (workspaces.folder_id)
// locally so the UI doesn't show stale nesting until the next pull
// reconciles it.
export async function deleteFolder(id: string) {
  let toRemove = new Set<string>();
  await mutateFolders((folders) => {
    toRemove = new Set([id]);
    // Folders only ever nest one level deep in practice, but this walks
    // any depth rather than assuming it, since nothing in the schema
    // enforces two.
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
    return folders.filter((f) => !toRemove.has(f.id));
  });

  const groups = await getGroups();
  for (const m of groups) {
    if (m.folderId && toRemove.has(m.folderId)) {
      await updateGroup(m.id, { folderId: null });
    }
  }

  await supabase?.from("folders").delete().eq("id", id);
}
