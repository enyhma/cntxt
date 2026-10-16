import type { GroupTab } from "./groups";

export const DASHBOARD_URL = browser.runtime.getURL("/dashboard.html");

export async function snapshotTabs(windowId: number): Promise<GroupTab[]> {
  const tabs = await browser.tabs.query({ windowId });
  return tabs
    .filter((t) => t.url !== DASHBOARD_URL)
    .map((t) => ({ url: t.url ?? "", title: t.title ?? "" }));
}

// Same snapshot as snapshotTabs, plus the raw tab ids — needed by
// ensureLiveTabGroup (utils/tabGroups.ts) to group/ungroup actual tabs,
// which snapshotTabs's {url,title}-only shape can't carry. A sibling
// function rather than changing snapshotTabs's return shape: that one has
// its own call site (attach.ts) with no use for ids.
export async function snapshotTabsWithIds(
  windowId: number,
): Promise<{ tabs: GroupTab[]; tabIds: number[] }> {
  const tabs = (await browser.tabs.query({ windowId })).filter(
    (t) => t.url !== DASHBOARD_URL,
  );
  return {
    tabs: tabs.map((t) => ({ url: t.url ?? "", title: t.title ?? "" })),
    tabIds: tabs
      .map((t) => t.id)
      .filter((id): id is number => id !== undefined),
  };
}

// Another sibling of snapshotTabs, this time carrying each tab's native
// tab-group id — needed by windowSyncMachine.ts to tell a Project's own
// (ungrouped) tabs apart from a child Group's (natively grouped) ones.
// `groupId` is `-1` (browser.tabGroups.TAB_GROUP_ID_NONE) for an ungrouped
// tab.
export async function snapshotTabsByGroup(
  windowId: number,
): Promise<{ id: number; url: string; title: string; groupId: number }[]> {
  const tabs = (await browser.tabs.query({ windowId })).filter(
    (t) => t.url !== DASHBOARD_URL,
  );
  return tabs
    .filter((t): t is typeof t & { id: number } => t.id !== undefined)
    .map((t) => ({
      id: t.id,
      url: t.url ?? "",
      title: t.title ?? "",
      groupId: t.groupId ?? -1,
    }));
}

export async function ensureDashboardTab(windowId: number) {
  const [existing] = await browser.tabs.query({
    url: DASHBOARD_URL,
    windowId,
  });
  if (existing) {
    // Re-pin on every sync, not just at creation: pinning is also how a tab
    // gets kicked out of a native tab group (Chrome unpins a tab when it
    // joins one), so this doubles as "never let the dashboard tab end up
    // grouped" with no separate group-membership check needed.
    if (!existing.pinned && existing.id !== undefined) {
      await browser.tabs.update(existing.id, { pinned: true });
    }
    return;
  }
  await browser.tabs.create({
    windowId,
    url: DASHBOARD_URL,
    pinned: true,
    index: 0,
  });
}
