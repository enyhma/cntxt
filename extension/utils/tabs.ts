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

export async function ensureDashboardTab(windowId: number) {
  const [existing] = await browser.tabs.query({
    url: DASHBOARD_URL,
    windowId,
  });
  if (existing) return;
  await browser.tabs.create({
    windowId,
    url: DASHBOARD_URL,
    pinned: true,
    index: 0,
  });
}
