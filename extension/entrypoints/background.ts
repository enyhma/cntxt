import { type ActorRefFrom, createActor } from "xstate";
import { ensureMissionForWindow } from "@/utils/attach";
import { getWindowMissionMap, removeWindowMission } from "@/utils/session";
import { updateSettings } from "@/utils/settings";
import { DASHBOARD_URL, ensureDashboardTab } from "@/utils/tabs";
import { missionWindowMachine } from "@/utils/missionWindowMachine";

export default defineBackground(() => {
  const windowActors = new Map<
    number,
    ActorRefFrom<typeof missionWindowMachine>
  >();

  function trackWindow(windowId: number) {
    if (windowActors.has(windowId)) return;
    const actor = createActor(missionWindowMachine, {
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
  // the in-memory actor registry from the persisted window->mission map
  // every time this callback runs so tab-sync survives a restart.
  (async () => {
    const map = await getWindowMissionMap();
    for (const windowId of Object.keys(map).map(Number)) {
      trackWindow(windowId);
    }
  })();

  browser.runtime.onStartup.addListener(async () => {
    const windows = await browser.windows.getAll({ windowTypes: ["normal"] });
    for (const win of windows) {
      if (win.id === undefined) continue;
      await ensureMissionForWindow(win.id);
      await ensureDashboardTab(win.id);
      trackWindow(win.id);
    }
  });

  browser.windows.onRemoved.addListener((windowId) => {
    untrackWindow(windowId);
    removeWindowMission(windowId);
  });

  browser.windows.onFocusChanged.addListener(async (windowId) => {
    if (windowId === browser.windows.WINDOW_ID_NONE) return;
    const map = await getWindowMissionMap();
    const missionId = map[windowId];
    if (missionId) await updateSettings({ lastActiveWorkspaceId: missionId });
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
    await ensureMissionForWindow(tab.windowId);
    await ensureDashboardTab(tab.windowId);
    trackWindow(tab.windowId);
  });
});
