import { ensureWorkspaceForWindow } from "@/utils/attach";
import { getWindowWorkspaceMap, removeWindowWorkspace } from "@/utils/session";
import { updateSettings } from "@/utils/settings";
import { DASHBOARD_URL, ensureDashboardTab, snapshotTabs } from "@/utils/tabs";
import { updateWorkspace } from "@/utils/workspaces";

export default defineBackground(() => {
  async function syncWindow(windowId: number) {
    const map = await getWindowWorkspaceMap();
    const workspaceId = map[windowId];
    if (!workspaceId) return;
    await updateWorkspace(workspaceId, { tabs: await snapshotTabs(windowId) });
  }

  browser.runtime.onStartup.addListener(async () => {
    const windows = await browser.windows.getAll({ windowTypes: ["normal"] });
    for (const win of windows) {
      if (win.id === undefined) continue;
      await ensureWorkspaceForWindow(win.id);
      await ensureDashboardTab(win.id);
    }
  });

  browser.windows.onRemoved.addListener((windowId) => {
    removeWindowWorkspace(windowId);
  });

  browser.windows.onFocusChanged.addListener(async (windowId) => {
    if (windowId === browser.windows.WINDOW_ID_NONE) return;
    const map = await getWindowWorkspaceMap();
    const workspaceId = map[windowId];
    if (workspaceId)
      await updateSettings({ lastActiveWorkspaceId: workspaceId });
  });

  browser.tabs.onCreated.addListener((tab) => {
    if (tab.windowId !== undefined) syncWindow(tab.windowId);
  });
  browser.tabs.onRemoved.addListener((_tabId, info) => {
    syncWindow(info.windowId);
  });
  browser.tabs.onUpdated.addListener((_tabId, changeInfo, tab) => {
    if (tab.windowId === undefined) return;
    if (changeInfo.url === undefined && changeInfo.title === undefined) return;
    syncWindow(tab.windowId);
  });
  browser.tabs.onMoved.addListener((_tabId, info) => {
    syncWindow(info.windowId);
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
    await ensureWorkspaceForWindow(tab.windowId);
    await ensureDashboardTab(tab.windowId);
  });
});
