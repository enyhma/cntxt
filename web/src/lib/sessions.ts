import { supabase } from "../supabase";

export type SessionLeg = {
  entityTable: "groups" | "folders";
  entityId: string;
  entityName: string;
  tabs: { url: string; title: string }[];
};

export type Session = {
  id: string;
  capturedAt: number;
  windows: SessionLeg[];
};

// Read-only — a session row has no update/delete RLS policy at all, by
// design (see supabase/migrations/20261012000000_sessions_and_archive.sql).
// Gated by has_sync_access server-side (same migration this session added)
// — a Free/Basic caller's select here just returns empty, not an error.
export async function listSessions() {
  const { data, error } = await supabase!
    .from("sessions")
    .select("id, captured_at, windows")
    .order("captured_at", { ascending: false });
  if (error || !data) return { data, error };
  return {
    data: data.map((row): Session => ({
      id: row.id,
      capturedAt: new Date(row.captured_at).getTime(),
      windows: row.windows as SessionLeg[],
    })),
    error: null,
  };
}

// The extension's restoreSession opens real browser windows
// (browser.windows.create) — no such API in a plain web page, so this
// opens every tab url instead. Loses the "one window per leg" grouping,
// but gets every tab back open, which is the part that actually matters.
export function restoreSession(session: Session): void {
  for (const leg of session.windows) {
    for (const tab of leg.tabs) {
      window.open(tab.url, "_blank");
    }
  }
}
