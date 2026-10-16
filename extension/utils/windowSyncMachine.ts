import { setup } from "xstate";
import { getWindowBindingMap } from "./session";
import {
  ensureDashboardTab,
  snapshotTabsWithIds,
  snapshotTabsByGroup,
} from "./tabs";
import { getGroups, updateGroup } from "./groups";
import type { Group, GroupTab } from "./groups";
import { getFolders, updateFolder } from "./folders";
import type { Folder } from "./folders";
import { liveChildGroups } from "./projectLiveTabs";
import { ensureLiveTabGroup, getTabGroupOwners } from "./tabGroups";
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

// Splits a Project-bound window's currently-open tabs between the Project's
// own (ungrouped) tabs and each live child Group's own tabs. Native
// tab-group ownership (utils/tabGroups.ts's tabGroupOwners map) is the
// primary signal — same one captureGroups.ts's reverse capture already
// trusts — but it depends on tabs.group() having actually succeeded, which
// isn't guaranteed (no tabGroups support, or simply hasn't run yet this
// instant). Falling back to URL identity against each live group's own
// last-known tabs (same identity rule as everywhere else tab sync uses,
// see groups.ts's GroupTab comment) means a group's tabs still land in the
// right bucket even when native grouping can't be trusted. Shared with
// utils/sessions.ts's captureSession, which needs the same split for its
// per-window session legs.
export async function partitionProjectWindowTabs(
  windowId: number,
  projectId: string,
  groups: Group[],
): Promise<{
  projectTabs: GroupTab[];
  groupTabs: Map<string, { tabs: GroupTab[]; tabIds: number[] }>;
}> {
  const rows = await snapshotTabsByGroup(windowId);
  const owners = await getTabGroupOwners();
  const live = liveChildGroups(projectId, groups);
  const liveIds = new Set(live.map((g) => g.id));

  const urlOwner = new Map<string, string>();
  for (const g of live) {
    for (const t of g.tabs) {
      if (!urlOwner.has(t.url)) urlOwner.set(t.url, g.id);
    }
  }

  const projectTabs: GroupTab[] = [];
  const groupTabs = new Map<string, { tabs: GroupTab[]; tabIds: number[] }>();

  for (const row of rows) {
    const nativeOwner = row.groupId !== -1 ? owners[row.groupId] : undefined;
    const ownerId =
      nativeOwner?.table === "groups" && liveIds.has(nativeOwner.id)
        ? nativeOwner.id
        : urlOwner.get(row.url);

    if (ownerId) {
      const entry = groupTabs.get(ownerId) ?? { tabs: [], tabIds: [] };
      entry.tabs.push({ url: row.url, title: row.title });
      entry.tabIds.push(row.id);
      groupTabs.set(ownerId, entry);
    } else {
      projectTabs.push({ url: row.url, title: row.title });
    }
  }

  return { projectTabs, groupTabs };
}

// Each Group/Project tab list is a plain snapshot now — no per-tab metadata
// (like the old phaseId tag) survives a resync, so there's nothing to merge
// by URL, just write the fresh list straight through. Exported so
// restoreMachine.ts can run one authoritative pass right after it finishes
// opening a Project's own tabs and every live child Group's — guaranteeing
// the final persisted state is correct even if a live-sync pass triggered
// by an intermediate tabs.onCreated mid-sequence saw a partially-opened
// window (tabOps.ts's openMissingTabs awaits each tab create in turn).
export async function syncTabs(windowId: number) {
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

  const groups = await getGroups();
  const live = liveChildGroups(project.id, groups);
  const { projectTabs, groupTabs } = await partitionProjectWindowTabs(
    windowId,
    project.id,
    groups,
  );

  await updateFolder(project.id, { tabs: projectTabs });

  for (const group of live) {
    const entry = groupTabs.get(group.id);
    if (entry) {
      await updateGroup(group.id, { tabs: entry.tabs });
      await ensureLiveTabGroup(
        windowId,
        {
          table: "groups",
          id: group.id,
          name: group.name,
          color: group.color as ColorKey | undefined,
          collapsed: group.status !== "active",
        },
        entry.tabIds,
      );
      cancelEmptyTabsCheck(group.id);
    } else if (group.tabs.length === 0 && group.status !== "done") {
      // No tab is attributable to this group right now. Only treat that as
      // confirmed-empty when its own stored tabs were already empty —
      // otherwise this is either a mid-open race (restoreMachine is still
      // partway through opening several groups' tabs at once, so this
      // group's just haven't landed yet) or, lacking tabGroups support, an
      // unresolvable "can't tell" state. Either way, writing tabs:[] here
      // would destroy the one record of what to reopen, so leave it alone.
      scheduleEmptyTabsCheck(group.id, windowId, project);
    }
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
