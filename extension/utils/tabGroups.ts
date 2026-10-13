import type { ColorKey } from "@cntxt/ui";

// The native tabGroups.Color enum (Chrome/Edge: 9 values since Chrome 89;
// Firefox: tabGroups.update's title/color landed in Firefox 139+, grouping
// itself — tabs.group()/ungroup() — in 138+ under the existing "tabs"
// permission with no separate manifest entry). Plain string union rather
// than importing the enum: the generated types already type every call site
// as `${Color}`, so nothing is lost and this avoids an enum-value import.
export type NativeColor =
  | "blue"
  | "cyan"
  | "green"
  | "grey"
  | "orange"
  | "pink"
  | "purple"
  | "red"
  | "yellow";

// Fixed 5->9 lookup, deliberately one-directional and non-configurable — a
// group's 5 semantic ColorKeys map onto 5 of the 9 literal native hues.
// No reverse table: a captured group's color is left unset (see
// captureGroups.ts) rather than trying to map the other 4 native colors
// back onto a ColorKey nobody asked it to represent.
const COLOR_TO_NATIVE: Record<ColorKey, NativeColor> = {
  accent: "blue",
  success: "green",
  warning: "yellow",
  info: "cyan",
  danger: "red",
};

export function groupingSupported(): boolean {
  return typeof browser.tabs.group === "function";
}

export function tabGroupsApiAvailable(): boolean {
  return typeof browser.tabGroups?.update === "function";
}

// --- ownership bookkeeping (session storage — wiped on browser restart,
// same lifetime as utils/session.ts's WindowBinding map, which is fine:
// group ids aren't stable across restarts either). ---
const OWNERS_KEY = "tabGroupOwners";
// `table` names which entity table owns this *native browser* tab group —
// "groups" here means the Group entity's storage table, same word as this
// type's own name meaning something different (ownership of a native tab
// group). Deliberate: see this file's own module-level framing and the
// Quest->Group rename notes in CLAUDE.md for why these two meanings of
// "group" coexist rather than one being renamed away.
export type GroupOwner = { table: "groups" | "folders"; id: string };
type OwnerMap = Record<number, GroupOwner>;

export async function getTabGroupOwners(): Promise<OwnerMap> {
  const result = await browser.storage.session.get(OWNERS_KEY);
  return (result[OWNERS_KEY] as OwnerMap | undefined) ?? {};
}

export async function setTabGroupOwner(groupId: number, owner: GroupOwner) {
  const map = await getTabGroupOwners();
  map[groupId] = owner;
  await browser.storage.session.set({ [OWNERS_KEY]: map });
}

export async function removeTabGroupOwner(groupId: number) {
  const map = await getTabGroupOwners();
  delete map[groupId];
  await browser.storage.session.set({ [OWNERS_KEY]: map });
}

export async function findOwnedGroupId(
  target: GroupOwner,
): Promise<number | undefined> {
  const map = await getTabGroupOwners();
  const hit = Object.entries(map).find(
    ([, o]) => o.table === target.table && o.id === target.id,
  );
  return hit ? Number(hit[0]) : undefined;
}

// Race guard: tabGroupOwners is only written *after* tabs.group() resolves,
// but that same call's resulting tabs.onUpdated events (watched by
// captureGroups.ts) can fire before that write lands — there's no groupId
// to check the owners map against yet. Keyed by windowId (known
// synchronously, before any groupId exists) rather than groupId, and
// in-memory only: a service-worker restart mid-call just drops the
// suppression a little early, which is an acceptable edge case here.
const mirroringWindows = new Set<number>();
export function isMirroring(windowId: number): boolean {
  return mirroringWindows.has(windowId);
}

// Consolidates tabIds into the target entity's native tab group (creating
// one if it doesn't have one yet, reusing it if it does) and syncs
// title/color. Always calls tabs.group()/tabGroups.update() unconditionally
// rather than diffing current group membership first — matches
// windowSyncMachine.ts's own house idiom (full-replace every sync, no
// diffing), and both calls are cheap/idempotent no-ops when already correct.
//
// Best-effort like utils/groups.ts's registerGroup: mirroring is a visual
// nicety layered on top of the tab sync that already succeeded by the time
// this runs, so a browser-API failure here (the window closed mid-call, the
// browser's own tabGroups limit, anything) is swallowed rather than thrown —
// it must never take down the sync this is called from.
export async function ensureLiveTabGroup(
  windowId: number,
  target: GroupOwner & { name: string; color?: ColorKey },
  tabIds: number[],
): Promise<void> {
  if (!groupingSupported() || tabIds.length === 0) return;

  mirroringWindows.add(windowId);
  try {
    let groupId = await findOwnedGroupId(target);
    if (groupId !== undefined && tabGroupsApiAvailable()) {
      try {
        await browser.tabGroups.get(groupId);
      } catch {
        // Group no longer exists (e.g. last tab closed and it auto-removed,
        // or the user ungrouped it) — drop the stale ownership and regroup
        // from scratch below.
        await removeTabGroupOwner(groupId);
        groupId = undefined;
      }
    }

    const newGroupId = await browser.tabs.group({
      tabIds: tabIds as [number, ...number[]],
      ...(groupId !== undefined
        ? { groupId }
        : { createProperties: { windowId } }),
    });
    await setTabGroupOwner(newGroupId, { table: target.table, id: target.id });

    if (tabGroupsApiAvailable()) {
      await browser.tabGroups.update(newGroupId, {
        title: target.name,
        ...(target.color ? { color: COLOR_TO_NATIVE[target.color] } : {}),
      });
    }
  } catch (e) {
    console.debug("tab-group mirror failed:", e);
  } finally {
    setTimeout(() => mirroringWindows.delete(windowId), 300);
  }
}
