import { openMissingTabs } from "./tabOps";
import { ensureLiveTabGroup } from "./tabGroups";
import { getGroups, updateGroup } from "./groups";
import type { Group } from "./groups";
import { updateFolder } from "./folders";
import type { Folder } from "./folders";
import type { ColorKey } from "@cntxt/ui";

// Opens `group`'s tabs if they aren't already (idempotent — reactivating a
// "done" group whose tabs got closed, or re-asserting state on a group
// that's already fully open), then expands/collapses its native tab group
// to match. No-ops entirely with no live window (a schedule-tick automation
// run) or no tabs to show.
async function mirrorGroup(
  windowId: number | null,
  group: Group,
  collapsed: boolean,
): Promise<void> {
  if (windowId === null) return;
  const tabIds = await openMissingTabs(windowId, group.tabs);
  if (tabIds.length === 0) return;
  await ensureLiveTabGroup(
    windowId,
    {
      table: "groups",
      id: group.id,
      name: group.name,
      color: group.color as ColorKey | undefined,
      collapsed,
    },
    tabIds,
  );
}

// Activates `group` within its Project: opens its tabs if needed, expands
// its native tab group, marks it "active", and demotes whatever sibling was
// previously active back to "pending" — collapsing that sibling's native
// group without closing its tabs, since every live sibling's tabs stay open
// at once under this model; only which one is expanded changes.
export async function activateGroupInProject(
  windowId: number | null,
  project: Folder,
  group: Group,
): Promise<void> {
  await mirrorGroup(windowId, group, false);
  await updateGroup(group.id, { status: "active" });
  await updateFolder(project.id, { activeGroupId: group.id });

  const siblings = (await getGroups()).filter(
    (g) =>
      g.folderId === project.id && g.id !== group.id && g.status === "active",
  );
  for (const sib of siblings) {
    await updateGroup(sib.id, { status: "pending" });
    await mirrorGroup(windowId, sib, true);
  }
}

// A Group's native tab group vanished because its last tab closed — done by
// the user directly in the browser, not through a dashboard action. Only
// demotes a group that was actually "active": a "done" group's tabs closing
// (the normal outcome of Complete group) must stay "done", not get silently
// reopened as "pending".
export async function deactivateGroup(
  group: Group,
  project: Folder | null,
): Promise<void> {
  if (group.status !== "active") return;
  await updateGroup(group.id, { status: "pending" });
  if (project && project.activeGroupId === group.id) {
    await updateFolder(project.id, { activeGroupId: undefined });
  }
}

// Finds the next `pending` sibling by `order` and activates it, or clears
// `activeGroupId` if there's none. Shared by groupSwapMachine's
// COMPLETE_GROUP and the automation engine's "advanceNextSibling" action
// block (utils/automationBlocks.ts), which fires this same effect from a
// passive trigger instead of a user click.
export async function advanceNextSibling(
  project: Folder,
  group: Group,
  windowId: number | null,
): Promise<void> {
  const siblings = (await getGroups()).filter((g) => g.folderId === project.id);
  const next = siblings
    .filter((s) => s.id !== group.id && s.status === "pending")
    .sort((a, b) => a.order - b.order)[0];
  if (next) {
    await activateGroupInProject(windowId, project, next);
  } else {
    await updateFolder(project.id, { activeGroupId: undefined });
  }
}
