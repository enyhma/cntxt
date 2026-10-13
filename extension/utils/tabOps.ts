import type { Browser } from "wxt/browser";
import { DASHBOARD_URL } from "./tabs";
import type { GroupTab } from "./groups";

// Shared by restoreMachine (close-all / restore-all) and groupSwapMachine
// (close/open a single phase's subset) — the dashboard tab is never a
// candidate for either, whatever the predicate says.
export async function closeMatchingTabs(
  windowId: number,
  shouldClose: (tab: Browser.tabs.Tab) => boolean,
): Promise<void> {
  const tabs = await browser.tabs.query({ windowId });
  const ids = tabs
    .filter((t) => t.url !== DASHBOARD_URL && shouldClose(t))
    .map((t) => t.id)
    .filter((id): id is number => id !== undefined);
  if (ids.length > 0) await browser.tabs.remove(ids);
}

export async function openMissingTabs(
  windowId: number,
  tabs: GroupTab[],
): Promise<void> {
  const open = await browser.tabs.query({ windowId });
  const openUrls = new Set(open.map((t) => t.url));
  for (const tab of tabs) {
    if (!openUrls.has(tab.url)) {
      await browser.tabs.create({ windowId, url: tab.url });
    }
  }
}
