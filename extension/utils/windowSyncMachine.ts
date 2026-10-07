import { setup } from "xstate";
import { getWindowQuestMap } from "./session";
import { snapshotTabs } from "./tabs";
import { getQuests, updateQuest } from "./quests";

type Context = { windowId: number };
type Event = { type: "TABS_CHANGED" } | { type: "WINDOW_CLOSED" };

async function syncTabs(windowId: number) {
  const map = await getWindowQuestMap();
  const questId = map[windowId];
  if (!questId) return;
  const quest = (await getQuests()).find((m) => m.id === questId);
  if (!quest) return;

  // Re-reads activePhaseId fresh every sync, same staleness reason as the
  // window->quest mapping above: the dashboard can activate a different
  // phase independently of this actor. A tab already known keeps its
  // phaseId (identity by URL — see the QuestTab type comment); only a
  // genuinely new tab gets tagged with whatever phase is active right now.
  const existingByUrl = new Map(quest.tabs.map((t) => [t.url, t]));
  const tabs = (await snapshotTabs(windowId)).map((t) => {
    const existing = existingByUrl.get(t.url);
    return existing
      ? { ...existing, title: t.title }
      : { ...t, phaseId: quest.activePhaseId };
  });
  await updateQuest(questId, { tabs });
}

/**
 * One actor per open window. questId is deliberately NOT kept in
 * context: the dashboard can reassign a window to a different quest
 * (Restore) without this actor knowing, so syncTabs re-reads the mapping
 * from session storage on every sync instead of trusting stale context.
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
