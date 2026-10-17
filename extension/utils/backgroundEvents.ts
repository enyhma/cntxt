// background.ts's own event-reaction logic, pulled out so it's testable —
// entrypoints/*.ts can't be unit tested directly in this codebase (see
// CLAUDE.md's Testing section), so background.ts stays thin wiring
// (`browser.X.onY.addListener(handler)`) and everything it decides lives
// here instead.
import {
  getTabGroupOwners,
  observeCollapsed,
  removeTabGroupOwner,
} from "./tabGroups";
import { activateGroupInProject, deactivateGroup } from "./groupActivation";
import { getGroups, updateGroup } from "./groups";
import type { Group } from "./groups";
import { getFolders } from "./folders";
import type { Folder } from "./folders";

// Derived from the real listener signatures rather than importing a
// `Browser.tabGroups.TabGroup`/`Browser.storage.onChanged` type by name —
// wxt's cross-browser browser.* typings don't export those under one
// stable name, and this stays correct automatically if they ever change.
type TabGroup = Parameters<
  NonNullable<Parameters<typeof browser.tabGroups.onUpdated.addListener>[0]>
>[0];
type StorageChanges = Parameters<
  Parameters<typeof browser.storage.onChanged.addListener>[0]
>[0];
type StorageAreaName = Parameters<
  Parameters<typeof browser.storage.onChanged.addListener>[0]
>[1];

// A native tab group the user just expanded/renamed/removed, resolved back
// to the nested Group entity + its parent Project it mirrors
// (utils/tabGroups.ts) — shared by both tabGroups listeners below, which
// only ever act on a "groups"-table owner (a mirrored Project tab group,
// which has no activation concept, is ignored).
export async function ownedGroupContext(
  nativeGroupId: number,
): Promise<{ group: Group; project: Folder } | null> {
  const owner = (await getTabGroupOwners())[nativeGroupId];
  if (owner?.table !== "groups") return null;
  const group = (await getGroups()).find((g) => g.id === owner.id);
  if (!group?.folderId) return null;
  const project = (await getFolders()).find((f) => f.id === group.folderId);
  if (!project) return null;
  return { group, project };
}

// The user expanding a nested Group's collapsed native tab group is how it
// gets activated outside the dashboard (see utils/groupActivation.ts).
// Collapsing is deliberately not wired to anything — only closing all of a
// group's tabs (handleTabGroupRemoved, below) deactivates it.
//
// A native rename is the other direction this same event carries: reverse
// mirroring is name-only (not color — see docs/capabilities.md's "Reverse
// color sync" roadmap note on the lossy 9->5 native-color mapping that'd
// need). The equality check is what keeps this from ping-ponging against
// ensureLiveTabGroup's own cntxt->native title push: once the two match,
// nothing writes again, regardless of whether Chrome fires onUpdated again
// for that push.
export async function handleTabGroupUpdated(group: TabGroup): Promise<void> {
  const ctx = await ownedGroupContext(group.id);
  if (!ctx) return;

  if (group.title && group.title !== ctx.group.name) {
    await updateGroup(ctx.group.id, { name: group.title });
  }

  // Only a genuine collapsed -> expanded transition counts as "the user
  // just expanded this group" (observeCollapsed, utils/tabGroups.ts) — not
  // every update where it merely happens to already be expanded (this same
  // rename, a recolor, or a group left expanded-but-not-"active" by
  // whatever created it). Those must not re-trigger activation, which
  // demotes and collapses whatever sibling actually is active right now.
  const wasCollapsed = observeCollapsed(group.id, group.collapsed);
  if (group.collapsed || wasCollapsed !== true) return;
  if (ctx.group.status === "active") return;
  await activateGroupInProject(group.windowId, ctx.project, ctx.group);
}

// Chrome removes a native tab group automatically once its last tab closes
// — that's the browser-side signal that a nested Group's tabs got closed
// directly (not via the dashboard's "Complete group"), so it should drop
// back to "pending" rather than staying "active" with nothing open.
export async function handleTabGroupRemoved(group: TabGroup): Promise<void> {
  const ctx = await ownedGroupContext(group.id);
  await removeTabGroupOwner(group.id);
  if (!ctx) return;
  await deactivateGroup(ctx.group, ctx.project);
}

// True only when some entity's `name`/`color` actually differs between the
// two snapshots — the two fields a routine tab-sync write never touches.
// Used by shouldResyncOnStorageChange to tell an actual dashboard-side (or
// native-rename-driven) rename/recolor apart from windowSyncMachine.ts's
// own `tabs`/`updatedAt`-only writes to the same storage key: without this
// check, resyncing on every "groups"/"folders" write would make that
// write retrigger itself via this very listener, forever (each write
// bumps `updatedAt`, which is itself a change).
export function nameOrColorChanged<
  T extends { id: string; name: string; color?: string },
>(oldList: T[] | undefined, newList: T[] | undefined): boolean {
  if (!oldList || !newList) return false;
  const oldById = new Map(oldList.map((e) => [e.id, e]));
  return newList.some((e) => {
    const old = oldById.get(e.id);
    return old !== undefined && (old.name !== e.name || old.color !== e.color);
  });
}

// A dashboard-side (or native) rename/recolor of a Group/Project fires no
// tab event, so without this the mirrored native group (utils/tabGroups.ts)
// would only catch up whenever some unrelated tab event happens to occur
// next.
export function shouldResyncOnStorageChange(
  changes: StorageChanges,
  area: StorageAreaName,
): boolean {
  if (area !== "local") return false;
  return (
    nameOrColorChanged(
      changes.groups?.oldValue as Group[] | undefined,
      changes.groups?.newValue as Group[] | undefined,
    ) ||
    nameOrColorChanged(
      changes.folders?.oldValue as Folder[] | undefined,
      changes.folders?.newValue as Folder[] | undefined,
    )
  );
}
