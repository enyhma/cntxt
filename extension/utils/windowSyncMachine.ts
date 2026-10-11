import { setup } from "xstate";
import { getWindowBindingMap } from "./session";
import { snapshotTabsWithIds } from "./tabs";
import { getQuests, updateQuest } from "./quests";
import { getFolders, updateFolder } from "./folders";
import { resolveProjectLiveTarget } from "./projectLiveTabs";
import { ensureLiveTabGroup } from "./tabGroups";
import type { ColorKey } from "@cntxt/ui";

type Context = { windowId: number };
type Event = { type: "TABS_CHANGED" } | { type: "WINDOW_CLOSED" };

// Each Quest/Project tab list is a plain snapshot now — no per-tab metadata
// (like the old phaseId tag) survives a resync, so there's nothing to merge
// by URL, just write the fresh list straight through.
async function syncTabs(windowId: number) {
  const map = await getWindowBindingMap();
  const binding = map[windowId];
  if (!binding) return;

  const { tabs, tabIds } = await snapshotTabsWithIds(windowId);

  if (binding.kind === "quest") {
    await updateQuest(binding.questId, { tabs });
    const quest = (await getQuests()).find((q) => q.id === binding.questId);
    if (quest) {
      await ensureLiveTabGroup(
        windowId,
        {
          table: "quests",
          id: quest.id,
          name: quest.name,
          color: quest.color as ColorKey | undefined,
        },
        tabIds,
      );
    }
    return;
  }

  const project = (await getFolders()).find((f) => f.id === binding.projectId);
  if (!project) return;

  const target = resolveProjectLiveTarget(project);
  if (target.table === "quests") {
    await updateQuest(target.id, { tabs });
    const quest = (await getQuests()).find((q) => q.id === target.id);
    if (quest) {
      await ensureLiveTabGroup(
        windowId,
        {
          table: "quests",
          id: quest.id,
          name: quest.name,
          color: quest.color as ColorKey | undefined,
        },
        tabIds,
      );
    }
  } else {
    await updateFolder(target.id, { tabs });
    await ensureLiveTabGroup(
      windowId,
      {
        table: "folders",
        id: project.id,
        name: project.name,
        color: project.color as ColorKey | undefined,
      },
      tabIds,
    );
  }
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
