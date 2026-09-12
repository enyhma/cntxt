import { type ActorRefFrom, createActor } from "xstate";
import { ensureWorkspaceForWindow } from "@/utils/attach";
import { getWindowWorkspaceMap, removeWindowWorkspace } from "@/utils/session";
import { updateSettings } from "@/utils/settings";
import { DASHBOARD_URL, ensureDashboardTab } from "@/utils/tabs";
import { workspaceWindowMachine } from "@/utils/workspaceWindowMachine";

export default defineBackground(() => {
  const windowActors = new Map<
    number,
    ActorRefFrom<typeof workspaceWindowMachine>
  >();

  function trackWindow(windowId: number) {
    if (windowActors.has(windowId)) return;
    const actor = createActor(workspaceWindowMachine, {
      input: { windowId },
    });
    actor.start();
    windowActors.set(windowId, actor);
  }

  function untrackWindow(windowId: number) {
    const actor = windowActors.get(windowId);
    if (!actor) return;
    actor.send({ type: "WINDOW_CLOSED" });
    windowActors.delete(windowId);
  }

  function notifyTabsChanged(windowId: number | undefined) {
    if (windowId === undefined) return;
    windowActors.get(windowId)?.send({ type: "TABS_CHANGED" });
  }

  // Service workers restart often (idle unload, browser startup); rehydrate
  // the in-memory actor registry from the persisted window->workspace map
  // every time this callback runs so tab-sync survives a restart.
  (async () => {
    const map = await getWindowWorkspaceMap();
    for (const windowId of Object.keys(map).map(Number)) {
      trackWindow(windowId);
    }
  })();

  browser.runtime.onStartup.addListener(async () => {
    const windows = await browser.windows.getAll({ windowTypes: ["normal"] });
    for (const win of windows) {
      if (win.id === undefined) continue;
      await ensureWorkspaceForWindow(win.id);
      await ensureDashboardTab(win.id);
      trackWindow(win.id);
    }
  });

  browser.windows.onRemoved.addListener((windowId) => {
    untrackWindow(windowId);
    removeWindowWorkspace(windowId);
  });

  browser.windows.onFocusChanged.addListener(async (windowId) => {
    if (windowId === browser.windows.WINDOW_ID_NONE) return;
    const map = await getWindowWorkspaceMap();
    const workspaceId = map[windowId];
    if (workspaceId)
      await updateSettings({ lastActiveWorkspaceId: workspaceId });
  });

  browser.tabs.onCreated.addListener((tab) => notifyTabsChanged(tab.windowId));
  browser.tabs.onRemoved.addListener((_tabId, info) =>
    notifyTabsChanged(info.windowId),
  );
  browser.tabs.onUpdated.addListener((_tabId, changeInfo, tab) => {
    if (changeInfo.url === undefined && changeInfo.title === undefined) return;
    notifyTabsChanged(tab.windowId);
  });
  browser.tabs.onMoved.addListener((_tabId, info) =>
    notifyTabsChanged(info.windowId),
  );

  browser.action.onClicked.addListener(async (tab) => {
    if (tab.windowId === undefined) return;
    const [existing] = await browser.tabs.query({
      url: DASHBOARD_URL,
      windowId: tab.windowId,
    });
    if (existing?.id !== undefined) {
      await browser.tabs.update(existing.id, { active: true });
      return;
    }
    await ensureWorkspaceForWindow(tab.windowId);
    await ensureDashboardTab(tab.windowId);
    trackWindow(tab.windowId);
  });
});
