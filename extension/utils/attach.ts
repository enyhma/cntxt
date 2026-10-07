import { getSettings } from "./settings";
import { getWindowMissionMap, setWindowMission } from "./session";
import { createMission } from "./missions";
import { snapshotTabs } from "./tabs";

/**
 * Ensures the given window is mapped to a mission, creating one if needed.
 * Idempotent: safe to call from both the background script and the dashboard page.
 */
export async function ensureMissionForWindow(
  windowId: number,
): Promise<string> {
  const map = await getWindowMissionMap();
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
      await setWindowMission(windowId, settings.lastActiveWorkspaceId);
      return settings.lastActiveWorkspaceId;
    }
  }

  const tabs = await snapshotTabs(windowId);
  const mission = await createMission("Untitled", tabs);
  await setWindowMission(windowId, mission.id);
  return mission.id;
}
