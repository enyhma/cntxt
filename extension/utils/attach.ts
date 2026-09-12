import { getSettings } from "./settings";
import { getWindowWorkspaceMap, setWindowWorkspace } from "./session";
import { createWorkspace } from "./workspaces";
import { snapshotTabs } from "./tabs";

/**
 * Ensures the given window is mapped to a workspace, creating one if needed.
 * Idempotent: safe to call from both the background script and the dashboard page.
 */
export async function ensureWorkspaceForWindow(
  windowId: number,
): Promise<string> {
  const map = await getWindowWorkspaceMap();
  const existing = map[windowId];
  if (existing) return existing;

  const settings = await getSettings();
  if (
    settings.startupBehavior === "lastUsed" &&
    settings.lastActiveWorkspaceId
  ) {
    const alreadyOpenElsewhere = Object.values(map).includes(
      settings.lastActiveWorkspaceId,
    );
    if (!alreadyOpenElsewhere) {
      await setWindowWorkspace(windowId, settings.lastActiveWorkspaceId);
      return settings.lastActiveWorkspaceId;
    }
  }

  const tabs = await snapshotTabs(windowId);
  const workspace = await createWorkspace("Untitled", tabs);
  await setWindowWorkspace(windowId, workspace.id);
  return workspace.id;
}
