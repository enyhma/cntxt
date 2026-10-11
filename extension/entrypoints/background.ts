import { type ActorRefFrom, createActor } from "xstate";
import { ensureBindingForWindow } from "@/utils/attach";
import { getWindowBindingMap, removeWindowBinding } from "@/utils/session";
import { updateSettings } from "@/utils/settings";
import { DASHBOARD_URL, ensureDashboardTab } from "@/utils/tabs";
import { windowSyncMachine } from "@/utils/windowSyncMachine";
import { scheduleCaptureCheck } from "@/utils/captureGroups";

export default defineBackground(() => {
  const windowActors = new Map<
    number,
    ActorRefFrom<typeof windowSyncMachine>
  >();

  function trackWindow(windowId: number) {
    if (windowActors.has(windowId)) return;
    const actor = createActor(windowSyncMachine, {
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
  // the in-memory actor registry from the persisted window->binding map
  // every time this callback runs so tab-sync survives a restart.
  (async () => {
    const map = await getWindowBindingMap();
    for (const windowId of Object.keys(map).map(Number)) {
      trackWindow(windowId);
    }
  })();

  browser.runtime.onStartup.addListener(async () => {
    const windows = await browser.windows.getAll({ windowTypes: ["normal"] });
    for (const win of windows) {
      if (win.id === undefined) continue;
      await ensureBindingForWindow(win.id);
      await ensureDashboardTab(win.id);
      trackWindow(win.id);
    }
  });

  browser.windows.onRemoved.addListener((windowId) => {
    untrackWindow(windowId);
    removeWindowBinding(windowId);
  });

  browser.windows.onFocusChanged.addListener(async (windowId) => {
    if (windowId === browser.windows.WINDOW_ID_NONE) return;
    const map = await getWindowBindingMap();
    const binding = map[windowId];
    if (binding) await updateSettings({ lastActiveBinding: binding });
  });

  browser.tabs.onCreated.addListener((tab) => notifyTabsChanged(tab.windowId));
  browser.tabs.onRemoved.addListener((_tabId, info) =>
    notifyTabsChanged(info.windowId),
  );
  browser.tabs.onUpdated.addListener((_tabId, changeInfo, tab) => {
    if (changeInfo.url !== undefined || changeInfo.title !== undefined) {
      notifyTabsChanged(tab.windowId);
    }
    // A tab joining a real group (not TAB_GROUP_ID_NONE) is the native
    // tab-groups "silent capture" trigger — see utils/captureGroups.ts.
    // Independent of the url/title check above: both can fire off one event.
    if (
      changeInfo.groupId !== undefined &&
      changeInfo.groupId !== -1 &&
      tab.windowId !== undefined
    ) {
      scheduleCaptureCheck(tab.windowId, changeInfo.groupId);
    }
  });
  browser.tabs.onMoved.addListener((_tabId, info) =>
    notifyTabsChanged(info.windowId),
  );

  // A dashboard-side rename/recolor of a Quest/Project fires no tab event,
  // so without this the mirrored native group (utils/tabGroups.ts) would
  // only catch up whenever some unrelated tab event happens to occur next.
  // ponytail: rescans every tracked window rather than indexing which one
  // owns the changed entity — fine at expected scale, add a reverse index
  // if this gets measurably expensive.
  browser.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (!("quests" in changes) && !("folders" in changes)) return;
    for (const windowId of windowActors.keys()) notifyTabsChanged(windowId);
  });

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
    await ensureBindingForWindow(tab.windowId);
    await ensureDashboardTab(tab.windowId);
    trackWindow(tab.windowId);
  });
});
