import { supabase } from "./supabase";

export type Resource = {
  id: string;
  workspace_id: string;
  type: string;
  url: string | null;
  note: string | null;
  created_at: string;
};

export async function listResources(workspaceId: string) {
  return supabase!
    .from("resources")
    .select("*")
    .eq("workspace_id", workspaceId)
    .order("created_at")
    .returns<Resource[]>();
}

// `type` is hardcoded to "link" for every row in v1 — a separate
// pure-note type (no url) is a deliberately deferred cut, not a gap.
export async function addResource(
  workspaceId: string,
  url: string,
  note: string,
) {
  return supabase!.from("resources").insert({
    workspace_id: workspaceId,
    type: "link",
    url,
    note: note || null,
  });
}

export async function deleteResource(id: string) {
  return supabase!.from("resources").delete().eq("id", id);
}
