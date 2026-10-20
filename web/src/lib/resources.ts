import { supabase } from "../supabase";

// A resource ("bookmark") is parented to exactly one of group_id/folder_id
// — matches extension/utils/resources.ts's Resource type. The old
// workspace_id this file used before didn't exist on the current table at
// all (it was renamed away before this app was last touched).
export type Resource = {
  id: string;
  group_id: string | null;
  folder_id: string | null;
  type: "link";
  url: string | null;
  note: string | null;
  created_at: string;
};

// Ungated — Bookmarks are free for every tier, by product decision (see
// marketing/src/pages/pricing.astro's compare table).
export async function listResources() {
  return supabase!
    .from("resources")
    .select("id, group_id, folder_id, type, url, note, created_at")
    .returns<Resource[]>();
}

export async function addResource(folderId: string, url: string, note: string) {
  return supabase!
    .from("resources")
    .insert({
      id: crypto.randomUUID(),
      folder_id: folderId,
      type: "link",
      url,
      note: note || null,
    })
    .select()
    .single<Resource>();
}

export async function deleteResource(id: string) {
  return supabase!.from("resources").delete().eq("id", id);
}
