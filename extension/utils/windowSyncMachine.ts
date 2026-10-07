import { setup } from "xstate";
import { getWindowBindingMap } from "./session";
import { snapshotTabs } from "./tabs";
import { getQuests, updateQuest, type Quest } from "./quests";
import { getFolders, updateFolder } from "./folders";
import { resolveProjectLiveTarget } from "./projectLiveTabs";

type Context = { windowId: number };
type Event = { type: "TABS_CHANGED" } | { type: "WINDOW_CLOSED" };

// Re-reads activePhaseId fresh every sync, same staleness reason as the
// window->quest mapping: the dashboard can activate a different phase
// independently of this actor. A tab already known keeps its phaseId
// (identity by URL — see the QuestTab type comment); only a genuinely new
// tab gets tagged with whatever phase is active right now.
async function syncQuestTabs(windowId: number, quest: Quest) {
  const existingByUrl = new Map(quest.tabs.map((t) => [t.url, t]));
  const tabs = (await snapshotTabs(windowId)).map((t) => {
    const existing = existingByUrl.get(t.url);
    return existing
      ? { ...existing, title: t.title }
      : { ...t, phaseId: quest.activePhaseId };
  });
  await updateQuest(quest.id, { tabs });
}

async function syncTabs(windowId: number) {
  const map = await getWindowBindingMap();
  const binding = map[windowId];
  if (!binding) return;

  if (binding.kind === "quest") {
    const quest = (await getQuests()).find((q) => q.id === binding.questId);
    if (quest) await syncQuestTabs(windowId, quest);
    return;
  }

  const project = (await getFolders()).find((f) => f.id === binding.projectId);
  if (!project) return;

  const target = resolveProjectLiveTarget(project);
  if (target.table === "quests") {
    const quest = (await getQuests()).find((q) => q.id === target.id);
    if (quest) await syncQuestTabs(windowId, quest);
    return;
  }

  // A Project's own tabs have no phase concept, so there's nothing per-tab
  // to preserve across a resync — just write the fresh snapshot.
  await updateFolder(target.id, { tabs: await snapshotTabs(windowId) });
}

/**
 * One actor per open window. The binding is deliberately NOT kept in
 * context: the dashboard can reassign a window to a different Project or
 * Quest (Restore) without this actor knowing, so syncTabs re-reads the
 * mapping from session storage on every sync instead of trusting stale
 * context.
 */
export const windowSyncMachine = setup({
  types: {} as { context: Context; events: Event; input: Context },
  actions: {
    syncTabs: ({ context }) => {
      syncTabs(context.windowId);
    },
  },
}).createMachine({
  context: ({ input }) => input,
  initial: "syncing",
  states: {
    syncing: {
      entry: "syncTabs",
      on: {
        TABS_CHANGED: { actions: "syncTabs" },
        WINDOW_CLOSED: "stopped",
      },
    },
    stopped: { type: "final" },
  },
});
