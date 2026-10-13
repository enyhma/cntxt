// Renamed from "windowWorkspaceMap" — this is a storage.session key, and
// renaming it has no user-facing benefit (session storage is wiped on
// browser restart anyway), but there's no wire-compat reason not to either.
const STORAGE_KEY = "windowBindingMap";

// A window can be bound to either a Project (the window-bound workspace
// role Mission/Group used to have alone) or a standalone Group (one not
// nested under a Project — see groupSwapMachine.ts for the nested case,
// which never changes a window's binding at all).
export type WindowBinding =
  { kind: "project"; projectId: string } | { kind: "group"; groupId: string };

export function sameBinding(a: WindowBinding, b: WindowBinding): boolean {
  return a.kind === "group" && b.kind === "group"
    ? a.groupId === b.groupId
    : a.kind === "project" && b.kind === "project"
      ? a.projectId === b.projectId
      : false;
}

type WindowBindingMap = Record<number, WindowBinding>;

export async function getWindowBindingMap(): Promise<WindowBindingMap> {
  const result = await browser.storage.session.get(STORAGE_KEY);
  return (result[STORAGE_KEY] as WindowBindingMap | undefined) ?? {};
}

export async function setWindowBinding(
  windowId: number,
  binding: WindowBinding,
) {
  const map = await getWindowBindingMap();
  map[windowId] = binding;
  await browser.storage.session.set({ [STORAGE_KEY]: map });
}

export async function removeWindowBinding(windowId: number) {
  const map = await getWindowBindingMap();
  delete map[windowId];
  await browser.storage.session.set({ [STORAGE_KEY]: map });
}
