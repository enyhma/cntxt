import { supabase } from "../supabase";

export type Folder = {
  id: string;
  name: string;
  parent_id: string | null;
  kind: "area" | "project";
  color: string | null;
  tabs: { url: string; title: string }[] | null;
  active_group_id: string | null;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
};

export async function listFolders() {
  return supabase!
    .from("folders")
    .select("*")
    .order("name")
    .returns<Folder[]>();
}

// Areas aren't quota-gated (count_group_like only counts Groups and
// kind:"project" Folders), so — unlike createProject below — this is a
// plain insert through the ordinary "folders: owner write while active"
// RLS policy (has_active_access, satisfied by Free/Basic too), not a
// security-definer RPC. Matches extension/utils/folders.ts's registerFolder
// exactly (the RPC path there is reserved for kind:"project" only).
export async function createArea(name: string) {
  return supabase!
    .from("folders")
    .insert({ id: crypto.randomUUID(), name, parent_id: null, kind: "area" })
    .select()
    .single<Folder>();
}

export async function createProject(name: string, parentId?: string) {
  return supabase!
    .rpc("create_project", { p_name: name, p_parent_id: parentId ?? null })
    .select()
    .single<Folder>();
}

// Gated by has_sync_access (Pro-only), same as updateGroup — see its
// comment for why callers must check proActive themselves first.
export async function updateFolder(id: string, patch: Partial<Folder>) {
  return supabase!
    .from("folders")
    .update(patch)
    .eq("id", id)
    .select()
    .single<Folder>();
}

export async function deleteFolderForever(id: string) {
  return supabase!.from("folders").delete().eq("id", id);
}
