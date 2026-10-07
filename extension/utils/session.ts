// Kept as "windowWorkspaceMap" — this is a storage.session key, and renaming
// it has no user-facing benefit (session storage is wiped on browser
// restart anyway); the concept it maps to is Quest everywhere else.
const STORAGE_KEY = "windowWorkspaceMap";

type WindowQuestMap = Record<number, string>;

export async function getWindowQuestMap(): Promise<WindowQuestMap> {
  const result = await browser.storage.session.get(STORAGE_KEY);
  return (result[STORAGE_KEY] as WindowQuestMap | undefined) ?? {};
}

export async function setWindowQuest(windowId: number, questId: string) {
  const map = await getWindowQuestMap();
  map[windowId] = questId;
  await browser.storage.session.set({ [STORAGE_KEY]: map });
}

export async function removeWindowQuest(windowId: number) {
  const map = await getWindowQuestMap();
  delete map[windowId];
  await browser.storage.session.set({ [STORAGE_KEY]: map });
}
