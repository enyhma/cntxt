import { setup } from "xstate";
import { getWindowBindingMap } from "./session";
import { snapshotTabsWithIds } from "./tabs";
import { getQuests, updateQuest } from "./quests";
import { getFolders, updateFolder } from "./folders";
import type { Folder } from "./folders";
import { resolveProjectLiveTarget } from "./projectLiveTabs";
import { ensureLiveTabGroup } from "./tabGroups";
import {
  getEnabledAutomationsFor,
  matchesTrigger,
  runAutomationChain,
} from "./automationEngine";
import type { ColorKey } from "@cntxt/ui";

type Context = { windowId: number };
type Event = { type: "TABS_CHANGED" } | { type: "WINDOW_CLOSED" };

// Debounces the "tabs settled empty" automation trigger per quest — same
// shape as utils/captureGroups.ts's scheduleCaptureCheck: a burst of
// TABS_CHANGED events (or new tabs arriving before the debounce elapses)
// resets the timer instead of firing early. Lives here, not in
// automationEngine.ts, since only this module ever observes a live
// tab-count transition.
const EMPTY_TABS_DEBOUNCE_MS = 45_000;
const pendingEmptyChecks = new Map<string, ReturnType<typeof setTimeout>>();

function cancelEmptyTabsCheck(questId: string) {
  clearTimeout(pendingEmptyChecks.get(questId));
  pendingEmptyChecks.delete(questId);
}

function scheduleEmptyTabsCheck(
  questId: string,
  windowId: number,
  project: Folder | null,
) {
  clearTimeout(pendingEmptyChecks.get(questId));
  pendingEmptyChecks.set(
    questId,
    setTimeout(() => {
      pendingEmptyChecks.delete(questId);
      runEmptyTabsAutomations(questId, windowId, project).catch((e: unknown) =>
        console.debug("quest automation check failed:", e),
      );
    }, EMPTY_TABS_DEBOUNCE_MS),
  );
}

// Re-reads the quest fresh at fire time (not the snapshot from when the
// debounce was scheduled) — if it changed status, got deleted, or picked
// up new tabs in the meantime via a path this module didn't observe, the
// trigger's own `matches` check naturally no-ops instead of needing extra
// cancellation plumbing for every such case.
async function runEmptyTabsAutomations(
  questId: string,
  windowId: number,
  project: Folder | null,
) {
  const quest = (await getQuests()).find((q) => q.id === questId);
  if (!quest || quest.deletedAt) return;

  const automations = await getEnabledAutomationsFor("questTabsSettled");
  for (const automation of automations) {
    if (matchesTrigger(automation, quest)) {
      await runAutomationChain(automation, { quest, project, windowId });
    }
  }
}

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
      if (tabs.length > 0) {
        cancelEmptyTabsCheck(quest.id);
      } else if (quest.status !== "done") {
        scheduleEmptyTabsCheck(quest.id, windowId, null);
      }
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
      if (tabs.length > 0) {
        cancelEmptyTabsCheck(quest.id);
      } else if (quest.status !== "done") {
        scheduleEmptyTabsCheck(quest.id, windowId, project);
      }
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
