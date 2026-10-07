import { supabase } from "./supabase";

// "Manually-added links/notes as workspace resources" — see
// docs/capabilities.md. The resources table (and its RLS) has existed since
// the very first migration, unused until now: no new schema needed here.
// Unlike workspaces/folders, a resource is never edited after creation —
// just added or removed — so there's no updated_at column and no
// pushDirtyResources: creation registers itself immediately (like
// registerWorkspace/registerFolder), and there's nothing left to push later.
//
// A resource is parented to exactly one of a Quest (questId — the
// original "save this open tab" flow) or a Section (folderId — a depth-2
// folder, "save this permanently" flow added later). Both optional rather
// than a tagged union so the Supabase row shape maps straight across:
// exactly one column is ever non-null, enforced at the call site
// (addResource), not the type.
export type Resource = {
  id: string;
  questId?: string;
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
    quest_id: resource.questId ?? null,
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
  parent: { questId?: string; folderId?: string },
  fields: { url?: string; note?: string },
): Promise<Resource> {
  const resource: Resource = {
    id: crypto.randomUUID(),
    questId: parent.questId,
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
    .select("id, quest_id, folder_id, type, url, note, created_at");
  if (error) throw new Error(error.message);
  if (!data) return 0;

  const local = await getResources();
  const localIds = new Set(local.map((r) => r.id));
  const missing = data
    .filter((row) => !localIds.has(row.id))
    .map((row): Resource => ({
      id: row.id,
      questId: row.quest_id ?? undefined,
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
