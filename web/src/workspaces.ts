import { supabase } from "./supabase";

export type WorkspaceRow = {
  id: string;
  name: string;
  tabs: { url: string; title: string }[];
  updated_at: string;
  deleted_at: string | null;
};

export async function listWorkspaces() {
  return supabase!
    .from("workspaces")
    .select("*")
    .is("deleted_at", null)
    .order("updated_at", { ascending: false })
    .returns<WorkspaceRow[]>();
}

export async function getWorkspace(id: string) {
  return supabase!
    .from("workspaces")
    .select("*")
    .eq("id", id)
    .single<WorkspaceRow>();
}
