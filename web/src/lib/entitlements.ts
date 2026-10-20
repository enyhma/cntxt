import { supabase } from "../supabase";

// Mirrors extension/utils/entitlements.ts exactly — no cache here (unlike
// the extension, which caches to storage.local for advisory use while
// offline): web has nothing else to invalidate, so it just refetches on
// mount/session change instead.
export type Entitlements = {
  maxWorkspaces: number;
  accessExpiresAt: string | null;
  hasBasicLicense: boolean;
  // True only while a Pro subscription is currently active — gates Sync/
  // Timeline/Shortcuts in the extension, and the same update-class RLS
  // policies (has_sync_access) here. hasBasicLicense does NOT satisfy this.
  proActive: boolean;
};

function isProActive(accessExpiresAt: string | null): boolean {
  return accessExpiresAt !== null && new Date(accessExpiresAt) > new Date();
}

export async function fetchEntitlements(): Promise<Entitlements | undefined> {
  const { data, error } = await supabase!
    .from("entitlements")
    .select("max_workspaces, access_expires_at, has_basic_license")
    .single();
  if (error || !data) return undefined;
  return {
    maxWorkspaces: data.max_workspaces,
    accessExpiresAt: data.access_expires_at,
    hasBasicLicense: data.has_basic_license,
    proActive: isProActive(data.access_expires_at),
  };
}
