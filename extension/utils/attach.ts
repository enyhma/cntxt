import { getSettings } from "./settings";
import { getWindowQuestMap, setWindowQuest } from "./session";
import { createQuest } from "./quests";
import { snapshotTabs } from "./tabs";

/**
 * Ensures the given window is mapped to a quest, creating one if needed.
 * Idempotent: safe to call from both the background script and the dashboard page.
 */
export async function ensureQuestForWindow(windowId: number): Promise<string> {
  const map = await getWindowQuestMap();
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
      await setWindowQuest(windowId, settings.lastActiveWorkspaceId);
      return settings.lastActiveWorkspaceId;
    }
  }

  const tabs = await snapshotTabs(windowId);
  const quest = await createQuest("Untitled", tabs);
  await setWindowQuest(windowId, quest.id);
  return quest.id;
}
