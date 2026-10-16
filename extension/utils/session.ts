// Renamed from "windowWorkspaceMap" — this is a storage.session key, and
// renaming it has no user-facing benefit (session storage is wiped on
// browser restart anyway), but there's no wire-compat reason not to either.
const STORAGE_KEY = "windowBindingMap";

// A plain storage.local mirror of the same map — session storage is also
// wiped by a mid-session extension reload (not just a real browser
// restart): a dev-server restart, a crashed service worker being
// reloaded, or a manual "Reload" in chrome://extensions. Window ids stay
// perfectly valid across all of those (the browser process itself never
// restarted), so background.ts's boot rehydration falls back to this
// backup instead of treating every open window as freshly unbound. See
// background.ts's `onStartup` handler for why a genuine browser restart
// still never trusts this backup.
const BACKUP_KEY = "windowBindingMapBackup";

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

export async function getWindowBindingBackup(): Promise<WindowBindingMap> {
  const result = await browser.storage.local.get(BACKUP_KEY);
  return (result[BACKUP_KEY] as WindowBindingMap | undefined) ?? {};
}

async function persist(map: WindowBindingMap) {
  await browser.storage.session.set({ [STORAGE_KEY]: map });
  await browser.storage.local.set({ [BACKUP_KEY]: map });
}

export async function setWindowBinding(
  windowId: number,
  binding: WindowBinding,
) {
  const map = await getWindowBindingMap();
  map[windowId] = binding;
  await persist(map);
}

export async function removeWindowBinding(windowId: number) {
  const map = await getWindowBindingMap();
  delete map[windowId];
  await persist(map);
}

// Called only on a genuine browser restart (background.ts's `onStartup`)
// so it always rebuilds every window's binding fresh, regardless of
// whatever the boot-time backup fallback already wrote to storage.session
// moments earlier — window ids are NOT stable across a real restart, so
// nothing restored from the storage.local backup can be trusted here.
export async function clearWindowBindingMap() {
  await browser.storage.session.set({ [STORAGE_KEY]: {} });
}
