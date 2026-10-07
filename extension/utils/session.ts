// Kept as "windowWorkspaceMap" — this is a storage.session key, and renaming
// it has no user-facing benefit (session storage is wiped on browser
// restart anyway); the concept it maps to is Mission everywhere else.
const STORAGE_KEY = "windowWorkspaceMap";

type WindowMissionMap = Record<number, string>;

export async function getWindowMissionMap(): Promise<WindowMissionMap> {
  const result = await browser.storage.session.get(STORAGE_KEY);
  return (result[STORAGE_KEY] as WindowMissionMap | undefined) ?? {};
}

export async function setWindowMission(windowId: number, missionId: string) {
  const map = await getWindowMissionMap();
  map[windowId] = missionId;
  await browser.storage.session.set({ [STORAGE_KEY]: map });
}

export async function removeWindowMission(windowId: number) {
  const map = await getWindowMissionMap();
  delete map[windowId];
  await browser.storage.session.set({ [STORAGE_KEY]: map });
}
