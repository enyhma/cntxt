import type { WorkspaceTab } from "./workspaces";

export const DASHBOARD_URL = browser.runtime.getURL("/dashboard.html");

export async function snapshotTabs(windowId: number): Promise<WorkspaceTab[]> {
  const tabs = await browser.tabs.query({ windowId });
  return tabs
    .filter((t) => t.url !== DASHBOARD_URL)
    .map((t) => ({ url: t.url ?? "", title: t.title ?? "" }));
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
