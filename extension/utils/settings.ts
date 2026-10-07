import type { WindowBinding } from "./session";

export type StartupBehavior = "none" | "lastUsed";
export type Theme = "baseline" | "indigo" | "brass";

export type Settings = {
  startupBehavior: StartupBehavior;
  // The window/binding this was last attached to — a Project or a
  // standalone Quest — so "resume last used" (startupBehavior ===
  // "lastUsed") can reattach to whichever kind it was.
  lastActiveBinding?: WindowBinding;
  theme: Theme;
  // Gates the "Pull quests now" control in the account menu (see
  // App.tsx) behind an opt-in toggle in Settings — pullRemoteQuests
  // only runs automatically on sign-in/token refresh today (see
  // docs/implementation-plan-sync.md M6), so this is an escape hatch for
  // forcing a check rather than a fully-designed manual-sync feature.
  manualPullEnabled: boolean;
};

const STORAGE_KEY = "settings";
const DEFAULT_SETTINGS: Settings = {
  startupBehavior: "none",
  theme: "baseline",
  manualPullEnabled: false,
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
