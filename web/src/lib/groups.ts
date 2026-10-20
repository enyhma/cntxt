import { supabase } from "../supabase";

export type GroupTab = { url: string; title: string };

export type Group = {
  id: string;
  name: string;
  color: string | null;
  icon: string | null;
  tabs: GroupTab[];
  status: "pending" | "active" | "done";
  order_index: number;
  folder_id: string | null;
  archived_at: string | null;
  deleted_at: string | null;
  last_seen_at: string | null;
  created_at: string;
  updated_at: string;
};

export async function listGroups() {
  return supabase!
    .from("groups")
    .select("*")
    .is("deleted_at", null)
    .order("order_index")
    .returns<Group[]>();
}

export async function listTrashedGroups() {
  return supabase!
    .from("groups")
    .select("*")
    .not("deleted_at", "is", null)
    .order("deleted_at", { ascending: false })
    .returns<Group[]>();
}

// Unlike the extension's registerGroup (local-first, fire-and-forget — the
// local row already exists regardless of whether this succeeds, so quota/
// auth errors are never surfaced), web has no local row to fall back to:
// this IS the write, so its result must reach the caller directly.
//
// create_group has no parent-folder param — nesting a Group under a
// Project/Area is always a separate update, unlike create_project (which
// takes p_parent_id directly). That update requires Pro (see updateGroup);
// callers should check proActive before passing folderId for a Free/Basic
// session, since the group still gets created standalone either way, just
// silently un-nested if the second step 403s.
export async function createGroup(name: string, folderId?: string) {
  const { data, error } = await supabase!
    .rpc("create_group", { p_name: name, p_tabs: [] })
    .select()
    .single<Group>();
  if (error || !data || !folderId) return { data, error };
  return updateGroup(data.id, { folder_id: folderId });
}

// Gated by has_sync_access (Pro-only) server-side as of
// supabase/migrations/20261018140000_basic_plan_and_gating.sql — callers
// must check proActive themselves (see web/src/App.tsx) rather than
// relying on this to fail gracefully; it surfaces whatever Postgres error
// RLS produces, which isn't a friendly message on its own.
export async function updateGroup(id: string, patch: Partial<Group>) {
  return supabase!
    .from("groups")
    .update(patch)
    .eq("id", id)
    .select()
    .single<Group>();
}

// A real DELETE, not the soft-delete above — gated by has_active_access
// (Free/Basic included), matching the extension's own "always allow
// permanently freeing a quota slot" behavior.
export async function deleteGroupForever(id: string) {
  return supabase!.from("groups").delete().eq("id", id);
}
