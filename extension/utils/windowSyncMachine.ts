import { setup } from "xstate";
import { getWindowBindingMap } from "./session";
import { ensureDashboardTab, snapshotTabsWithIds } from "./tabs";
import { getGroups, updateGroup } from "./groups";
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

// Debounces the "tabs settled empty" automation trigger per group — same
// shape as utils/captureGroups.ts's scheduleCaptureCheck: a burst of
// TABS_CHANGED events (or new tabs arriving before the debounce elapses)
// resets the timer instead of firing early. Lives here, not in
// automationEngine.ts, since only this module ever observes a live
// tab-count transition.
const EMPTY_TABS_DEBOUNCE_MS = 45_000;
const pendingEmptyChecks = new Map<string, ReturnType<typeof setTimeout>>();

function cancelEmptyTabsCheck(groupId: string) {
  clearTimeout(pendingEmptyChecks.get(groupId));
  pendingEmptyChecks.delete(groupId);
}

function scheduleEmptyTabsCheck(
  groupId: string,
  windowId: number,
  project: Folder | null,
) {
  clearTimeout(pendingEmptyChecks.get(groupId));
  pendingEmptyChecks.set(
    groupId,
    setTimeout(() => {
      pendingEmptyChecks.delete(groupId);
      runEmptyTabsAutomations(groupId, windowId, project).catch((e: unknown) =>
        console.debug("group automation check failed:", e),
      );
    }, EMPTY_TABS_DEBOUNCE_MS),
  );
}

// Re-reads the group fresh at fire time (not the snapshot from when the
// debounce was scheduled) — if it changed status, got deleted, or picked
// up new tabs in the meantime via a path this module didn't observe, the
// trigger's own `matches` check naturally no-ops instead of needing extra
// cancellation plumbing for every such case.
async function runEmptyTabsAutomations(
  groupId: string,
  windowId: number,
  project: Folder | null,
) {
  const group = (await getGroups()).find((q) => q.id === groupId);
  if (!group || group.deletedAt) return;

  const automations = await getEnabledAutomationsFor("groupTabsSettled");
  for (const automation of automations) {
    if (matchesTrigger(automation, group)) {
      await runAutomationChain(automation, { group, project, windowId });
    }
  }
}

// Each Group/Project tab list is a plain snapshot now — no per-tab metadata
// (like the old phaseId tag) survives a resync, so there's nothing to merge
// by URL, just write the fresh list straight through.
async function syncTabs(windowId: number) {
  const map = await getWindowBindingMap();
  const binding = map[windowId];
  if (!binding) return;

  // Every bound window keeps its dashboard tab open and pinned — re-checked
  // on every sync so a manual close or an unpin (e.g. from joining a native
  // tab group) self-heals on the next tab event instead of staying broken
  // until the user clicks the extension icon again.
  await ensureDashboardTab(windowId);

  const { tabs, tabIds } = await snapshotTabsWithIds(windowId);

  if (binding.kind === "group") {
    await updateGroup(binding.groupId, { tabs });
    const group = (await getGroups()).find((q) => q.id === binding.groupId);
    if (group) {
      await ensureLiveTabGroup(
        windowId,
        {
          table: "groups",
          id: group.id,
          name: group.name,
          color: group.color as ColorKey | undefined,
        },
        tabIds,
      );
      if (tabs.length > 0) {
        cancelEmptyTabsCheck(group.id);
      } else if (group.status !== "done") {
        scheduleEmptyTabsCheck(group.id, windowId, null);
      }
    }
    return;
  }

  const project = (await getFolders()).find((f) => f.id === binding.projectId);
  if (!project) return;

  const target = resolveProjectLiveTarget(project);
  if (target.table === "groups") {
    await updateGroup(target.id, { tabs });
    const group = (await getGroups()).find((q) => q.id === target.id);
    if (group) {
      await ensureLiveTabGroup(
        windowId,
        {
          table: "groups",
          id: group.id,
          name: group.name,
          color: group.color as ColorKey | undefined,
        },
        tabIds,
      );
      if (tabs.length > 0) {
        cancelEmptyTabsCheck(group.id);
      } else if (group.status !== "done") {
        scheduleEmptyTabsCheck(group.id, windowId, project);
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
 * Group (Restore) without this actor knowing, so syncTabs re-reads the
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
