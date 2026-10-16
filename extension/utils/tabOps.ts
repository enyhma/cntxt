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

// Returns the id of every tab in `tabs` once open — pre-existing or just
// created — so a caller can hand them straight to ensureLiveTabGroup
// (utils/tabGroups.ts) without a second query.
export async function openMissingTabs(
  windowId: number,
  tabs: GroupTab[],
): Promise<number[]> {
  const open = await browser.tabs.query({ windowId });
  const byUrl = new Map(open.map((t) => [t.url, t.id]));
  const ids: number[] = [];
  for (const tab of tabs) {
    let id = byUrl.get(tab.url);
    if (id === undefined) {
      id = (await browser.tabs.create({ windowId, url: tab.url })).id;
    }
    if (id !== undefined) ids.push(id);
  }
  return ids;
}
