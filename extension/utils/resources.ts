import { supabase } from "./supabase";

// "Manually-added links/notes as workspace resources" — see
// docs/capabilities.md. The resources table (and its RLS) has existed since
// the very first migration, unused until now: no new schema needed here.
// Unlike workspaces/folders, a resource is never edited after creation —
// just added or removed — so there's no updated_at column and no
// pushDirtyResources: creation registers itself immediately (like
// registerWorkspace/registerFolder), and there's nothing left to push later.
//
// A resource ("bookmark" in the UI) is parented to a Folder — a Project or
// an Area, folderId pointing at either — never a Group: bookmarking was
// originally also available per-Group (groupId, "save this open tab"), but
// that flow was removed as part of gating bookmarks behind the
// experimental-features toggle (see App.tsx), leaving only the Project/Area
// paths. groupId stays on the type for old synced rows created before that
// change; addResource no longer has a call site that sets it. Both fields
// optional rather than a tagged union so the Supabase row shape maps
// straight across: at most one column is ever non-null, enforced at the
// (current) call sites, not the type.
export type Resource = {
  id: string;
  groupId?: string;
  folderId?: string;
  type: "link";
  url?: string;
  note?: string;
  createdAt: number;
  syncStatus?: "synced" | "syncing" | "offline" | "signed-out";
};

const STORAGE_KEY = "resources";

export async function getResources(): Promise<Resource[]> {
  const result = await browser.storage.local.get(STORAGE_KEY);
  return (result[STORAGE_KEY] as Resource[] | undefined) ?? [];
}

async function setResources(resources: Resource[]) {
  await browser.storage.local.set({ [STORAGE_KEY]: resources });
}

async function setSyncStatus(id: string, syncStatus: Resource["syncStatus"]) {
  const resources = await getResources();
  await setResources(
    resources.map((r) => (r.id === id ? { ...r, syncStatus } : r)),
  );
}

// Best-effort, fire-and-forget — same contract as registerWorkspace/
// registerFolder.
async function registerResource(resource: Resource) {
  if (!supabase) return;
  await setSyncStatus(resource.id, "syncing");
  const { error } = await supabase.from("resources").insert({
    id: resource.id,
    group_id: resource.groupId ?? null,
    folder_id: resource.folderId ?? null,
    type: resource.type,
    url: resource.url,
    note: resource.note,
  });
  if (!error) {
    await setSyncStatus(resource.id, "synced");
    return;
  }
  console.debug("resource not synced:", error.message);
  if (error.code === "23505") {
    await setSyncStatus(resource.id, "synced");
  } else if (error.message === "not authenticated") {
    await setSyncStatus(resource.id, "signed-out");
  } else {
    await setSyncStatus(resource.id, "offline");
  }
}

export async function addResource(
  parent: { groupId?: string; folderId?: string },
  fields: { url?: string; note?: string },
): Promise<Resource> {
  const resource: Resource = {
    id: crypto.randomUUID(),
    groupId: parent.groupId,
    folderId: parent.folderId,
    type: "link",
    url: fields.url,
    note: fields.note,
    createdAt: Date.now(),
  };
  const resources = await getResources();
  await setResources([...resources, resource]);
  registerResource(resource);
  return resource;
}

// Mirrors reconcileSyncStatus/reconcileFolderSyncStatus.
export async function reconcileResourceSyncStatus() {
  const resources = await getResources();
  for (const r of resources) {
    if (r.syncStatus !== "synced") await registerResource(r);
  }
}

// No last-write-wins merge needed (nothing to conflict with — resources are
// immutable after creation): just add whatever's missing locally.
export async function pullRemoteResources(): Promise<number> {
  if (!supabase) return 0;
  const { data, error } = await supabase
    .from("resources")
    .select("id, group_id, folder_id, type, url, note, created_at");
  if (error) throw new Error(error.message);
  if (!data) return 0;

  const local = await getResources();
  const localIds = new Set(local.map((r) => r.id));
  const missing = data
    .filter((row) => !localIds.has(row.id))
    .map((row): Resource => ({
      id: row.id,
      groupId: row.group_id ?? undefined,
      folderId: row.folder_id ?? undefined,
      type: row.type as Resource["type"],
      url: row.url ?? undefined,
      note: row.note ?? undefined,
      createdAt: Date.parse(row.created_at),
      syncStatus: "synced",
    }));

  if (missing.length > 0) await setResources([...local, ...missing]);
  return missing.length;
}

export async function deleteResource(id: string) {
  const resources = await getResources();
  await setResources(resources.filter((r) => r.id !== id));
  await supabase?.from("resources").delete().eq("id", id);
}
