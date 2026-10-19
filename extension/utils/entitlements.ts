import { supabase } from "./supabase";

export type Entitlements = {
  maxMissions: number;
  accessExpiresAt: string | null;
  hasBasicLicense: boolean;
  // Mirrors the server's has_sync_access(): true only while a Pro
  // subscription is currently active — the gate for Sync, Timeline, and
  // Shortcuts (see extension/utils/sync.ts, sessions.ts,
  // automationEngine.ts). Basic's hasBasicLicense does NOT satisfy this.
  proActive: boolean;
};

function isProActive(accessExpiresAt: string | null): boolean {
  return accessExpiresAt !== null && new Date(accessExpiresAt) > new Date();
}

const STORAGE_KEY = "entitlementsCache";

export async function getCachedEntitlements(): Promise<
  Entitlements | undefined
> {
  const result = await browser.storage.local.get(STORAGE_KEY);
  return result[STORAGE_KEY] as Entitlements | undefined;
}

// A plain RLS-protected select, not the create_group/create_project RPCs — reading
// isn't the operation that needs atomicity, only the write is (see
// docs/architecture-sync.md → "Entitlements"). Advisory only: this cache is
// what the dashboard reads to gray out UI ahead of a round-trip, it's never
// what actually authorizes a write.
export async function refreshEntitlements(): Promise<Entitlements | undefined> {
  const { data, error } = await supabase!
    .from("entitlements")
    .select("max_workspaces, access_expires_at, has_basic_license")
    .single();
  if (error || !data) return undefined;

  const entitlements: Entitlements = {
    maxMissions: data.max_workspaces,
    accessExpiresAt: data.access_expires_at,
    hasBasicLicense: data.has_basic_license,
    proActive: isProActive(data.access_expires_at),
  };
  await browser.storage.local.set({ [STORAGE_KEY]: entitlements });
  return entitlements;
}
