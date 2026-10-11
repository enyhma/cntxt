import { getWindowBindingMap } from "./session";
import { getFolders, updateFolder } from "./folders";
import { createQuest, updateQuest } from "./quests";
import {
  getTabGroupOwners,
  isMirroring,
  groupingSupported,
  tabGroupsApiAvailable,
  setTabGroupOwner,
} from "./tabGroups";
import { getTabGroupRules, matchRule } from "./tabGroupRules";

// Grouping N tabs at once fires one tabs.onUpdated per tab, each carrying
// the same groupId — debounce per windowId:groupId pair so a multi-tab
// group only runs capture once, with every member tab already settled.
const DEBOUNCE_MS = 250;
const pending = new Map<string, ReturnType<typeof setTimeout>>();

export function scheduleCaptureCheck(windowId: number, groupId: number) {
  const key = `${windowId}:${groupId}`;
  clearTimeout(pending.get(key));
  pending.set(
    key,
    setTimeout(() => {
      pending.delete(key);
      runCaptureCheck(windowId, groupId).catch((e: unknown) =>
        console.debug("tab-group capture check failed:", e),
      );
    }, DEBOUNCE_MS),
  );
}

// Turns a newly-user-created native group into a persisted, nested Quest —
// the "silent hero" capture path: no confirmation, grouping tabs natively is
// itself the action. v1 scope: only windows bound to a Project (a standalone
// Quest-bound window's tabs are already one group entirely via mirroring —
// a second group appearing inside one has no clean semantic yet, so it's
// simply not wired here, not specially blocked either).
export async function runCaptureCheck(windowId: number, groupId: number) {
  if (!groupingSupported() || isMirroring(windowId)) return;

  const owners = await getTabGroupOwners();
  if (owners[groupId]) return; // ours already — not a capture candidate

  const binding = (await getWindowBindingMap())[windowId];
  if (!binding || binding.kind !== "project") return;

  let group: { title?: string; color: string } = {
    title: undefined,
    color: "grey",
  };
  if (tabGroupsApiAvailable()) {
    try {
      group = await browser.tabGroups.get(groupId);
    } catch {
      return; // group vanished before the debounce fired
    }
  }

  const tabs = await browser.tabs.query({ windowId, groupId });
  const tabIds = tabs
    .map((t) => t.id)
    .filter((id): id is number => id !== undefined);
  if (tabIds.length === 0) return;

  const folders = await getFolders();
  const rules = await getTabGroupRules();
  const rule = matchRule(rules, group);
  const ruleTargetValid = rule && folders.some((f) => f.id === rule.folderId);
  const targetFolderId = ruleTargetValid ? rule.folderId : binding.projectId;

  const quest = await createQuest(
    group.title || "Untitled quest",
    tabs.map((t) => ({ url: t.url ?? "", title: t.title ?? "" })),
  );
  await updateQuest(quest.id, { folderId: targetFolderId });

  const project = folders.find((f) => f.id === targetFolderId);
  if (project && !project.activeQuestId) {
    // No child quest active yet in the target project — these tabs are
    // already open and already "the thing you're doing", so make it live
    // immediately, same as an explicit ACTIVATE_QUEST would.
    await updateQuest(quest.id, { status: "active" });
    await updateFolder(targetFolderId, { activeQuestId: quest.id });
  }
  // Else: leave it pending, don't touch the window or the already-active
  // quest — reachable later via the existing double-click-to-switch UI.

  await setTabGroupOwner(groupId, { table: "quests", id: quest.id });
}
