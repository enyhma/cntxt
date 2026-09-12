const STORAGE_KEY = "windowWorkspaceMap";

type WindowWorkspaceMap = Record<number, string>;

export async function getWindowWorkspaceMap(): Promise<WindowWorkspaceMap> {
  const result = await browser.storage.session.get(STORAGE_KEY);
  return (result[STORAGE_KEY] as WindowWorkspaceMap | undefined) ?? {};
}

export async function setWindowWorkspace(
  windowId: number,
  workspaceId: string,
) {
  const map = await getWindowWorkspaceMap();
  map[windowId] = workspaceId;
  await browser.storage.session.set({ [STORAGE_KEY]: map });
}

export async function removeWindowWorkspace(windowId: number) {
  const map = await getWindowWorkspaceMap();
  delete map[windowId];
  await browser.storage.session.set({ [STORAGE_KEY]: map });
}
