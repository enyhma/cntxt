import { getSettings } from "./settings";
import { archiveQuest, getQuests } from "./quests";

// Archives a "done" quest once it's gone unreferenced by a session capture
// (see utils/sessions.ts's lastSeenAt side-write) for Settings.autoArchiveDays.
// Only ever archives Quests — Folders have no `status`, so "done + inactive"
// can't apply to a Project; a Project is only ever archived manually (see
// archiveFolder in utils/folders.ts), whose cascade to child quests is a
// separate, manual-path concern.
export async function runAutoArchiveCheck(): Promise<void> {
  const { autoArchiveDays } = await getSettings();
  const cutoffMs = autoArchiveDays * 24 * 60 * 60 * 1000;
  for (const quest of await getQuests()) {
    if (quest.archivedAt || quest.deletedAt || quest.status !== "done") {
      continue;
    }
    const lastSeen = quest.lastSeenAt ?? quest.createdAt;
    if (Date.now() - lastSeen > cutoffMs) {
      await archiveQuest(quest.id);
    }
  }
}
