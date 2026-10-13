import { getWindowBindingMap } from "./session";
import { getFolders, updateFolder } from "./folders";
import { createGroup, updateGroup } from "./groups";
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
// native tab group only runs capture once, with every member tab already
// settled.
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

// Turns a newly-user-created *native* browser tab group into a persisted,
// nested Group entity — the "silent hero" capture path: no confirmation,
// grouping tabs natively is itself the action. v1 scope: only windows
// bound to a Project (a standalone Group-bound window's tabs are already
// one native tab group entirely via mirroring — a second native group
// appearing inside one has no clean semantic yet, so it's simply not
// wired here, not specially blocked either).
export async function runCaptureCheck(windowId: number, groupId: number) {
  if (!groupingSupported() || isMirroring(windowId)) return;

  const owners = await getTabGroupOwners();
  if (owners[groupId]) return; // ours already — not a capture candidate

  const binding = (await getWindowBindingMap())[windowId];
  if (!binding || binding.kind !== "project") return;

  // The *native* browser tab group's own title/color — distinct from the
  // Group entity (below) this capture is about to create from it.
  let nativeGroup: { title?: string; color: string } = {
    title: undefined,
    color: "grey",
  };
  if (tabGroupsApiAvailable()) {
    try {
      nativeGroup = await browser.tabGroups.get(groupId);
    } catch {
      return; // native group vanished before the debounce fired
    }
  }

  const tabs = await browser.tabs.query({ windowId, groupId });
  const tabIds = tabs
    .map((t) => t.id)
    .filter((id): id is number => id !== undefined);
  if (tabIds.length === 0) return;

  const folders = await getFolders();
  const rules = await getTabGroupRules();
  const rule = matchRule(rules, nativeGroup);
  const ruleTargetValid = rule && folders.some((f) => f.id === rule.folderId);
  const targetFolderId = ruleTargetValid ? rule.folderId : binding.projectId;

  const group = await createGroup(
    nativeGroup.title || "Untitled group",
    tabs.map((t) => ({ url: t.url ?? "", title: t.title ?? "" })),
  );
  await updateGroup(group.id, { folderId: targetFolderId });

  const project = folders.find((f) => f.id === targetFolderId);
  if (project && !project.activeGroupId) {
    // No child group active yet in the target project — these tabs are
    // already open and already "the thing you're doing", so make it live
    // immediately, same as an explicit ACTIVATE_GROUP would.
    await updateGroup(group.id, { status: "active" });
    await updateFolder(targetFolderId, { activeGroupId: group.id });
  }
  // Else: leave it pending, don't touch the window or the already-active
  // group — reachable later via the existing double-click-to-switch UI.

  await setTabGroupOwner(groupId, { table: "groups", id: group.id });
}
