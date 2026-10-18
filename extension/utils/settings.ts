import type { WindowBinding } from "./session";

export type StartupBehavior = "none" | "lastUsed";
export type Theme = "baseline" | "indigo" | "brass";

export type Settings = {
  startupBehavior: StartupBehavior;
  // The window/binding this was last attached to — a Project or a
  // standalone Group — so "resume last used" (startupBehavior ===
  // "lastUsed") can reattach to whichever kind it was.
  lastActiveBinding?: WindowBinding;
  theme: Theme;
  // Gates the "Pull groups now" control in the account menu (see
  // App.tsx) behind an opt-in toggle in Settings — pullRemoteGroups
  // only runs automatically on sign-in/token refresh today (see
  // docs/implementation-plan-sync.md M6), so this is an escape hatch for
  // forcing a check rather than a fully-designed manual-sync feature.
  manualPullEnabled: boolean;
  // How many days a "done" group can go unreferenced by a Session (see
  // utils/sessions.ts/utils/autoArchive.ts) before it's auto-archived.
  // Distinct from both Trash's hardcoded 7/30-day retention and
  // sessions.ts's own 7-day *local cache* bound — this is the one
  // user-facing, Settings-configurable "N days" in the app.
  autoArchiveDays: number;
  // Master opt-in gate for features still under active development —
  // currently just Shortcuts. Off by default so half-finished features
  // don't surface to users who haven't asked for them.
  experimentalFeaturesEnabled: boolean;
};

const STORAGE_KEY = "settings";
const DEFAULT_SETTINGS: Settings = {
  startupBehavior: "none",
  theme: "baseline",
  manualPullEnabled: false,
  autoArchiveDays: 30,
  experimentalFeaturesEnabled: false,
};

export async function getSettings(): Promise<Settings> {
  const result = await browser.storage.local.get(STORAGE_KEY);
  return {
    ...DEFAULT_SETTINGS,
    ...(result[STORAGE_KEY] as Partial<Settings> | undefined),
  };
}

export async function updateSettings(patch: Partial<Settings>) {
  const settings = await getSettings();
  await browser.storage.local.set({ [STORAGE_KEY]: { ...settings, ...patch } });
}
