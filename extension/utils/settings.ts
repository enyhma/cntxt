export type StartupBehavior = "none" | "lastUsed";

export type Settings = {
  startupBehavior: StartupBehavior;
  lastActiveWorkspaceId?: string;
};

const STORAGE_KEY = "settings";
const DEFAULT_SETTINGS: Settings = { startupBehavior: "none" };

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
