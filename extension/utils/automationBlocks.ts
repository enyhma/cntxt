import { archiveGroup, updateGroup } from "./groups";
import type { Group } from "./groups";
import type { Folder } from "./folders";
import { advanceNextSibling } from "./groupSwapMachine";

// The block registry is the one place a Group-automation block's behavior
// lives — both the editor (packages/ui/src/AutomationsPanel.tsx, label/
// config form) and the two runners (automationEngine.ts's schedule
// runner, windowSyncMachine.ts's event runner) read from this same
// object. Adding a block type later means one new entry here, nothing
// else.

export type TriggerBlockType = "groupDoneAndStale" | "groupTabsEmpty";
export type ActionBlockType =
  "setGroupStatus" | "archiveGroup" | "advanceNextSibling";
export type BlockType = TriggerBlockType | ActionBlockType;

// Which runner a trigger plugs into — the schedule runner polls on the
// existing session-capture alarm tick, the event runner reacts to live
// tab-sync. Forcing these through one dispatcher was the premature
// unification avoided here; this field is just how each runner finds the
// automations it owns without string-matching a blockType name.
export type TriggerFiresOn = "scheduleTick" | "groupTabsSettled";

export interface AutomationRunContext {
  group: Group;
  // The parent Project, only when this group is nested under one and
  // currently swapped in. Null for a standalone group or a schedule-tick
  // run, which has no live window context at all.
  project: Folder | null;
  windowId: number | null;
}

export interface TriggerBlockDef {
  kind: "trigger";
  firesOn: TriggerFiresOn;
  label: string;
  description: string;
  defaultConfig: Record<string, unknown>;
  matches: (group: Group, config: Record<string, unknown>) => boolean;
}

export interface ActionBlockDef {
  kind: "action";
  label: string;
  description: string;
  defaultConfig: Record<string, unknown>;
  run: (
    ctx: AutomationRunContext,
    config: Record<string, unknown>,
  ) => Promise<void>;
}

export type BlockDef = TriggerBlockDef | ActionBlockDef;

export const BLOCK_REGISTRY: Record<BlockType, BlockDef> = {
  groupDoneAndStale: {
    kind: "trigger",
    firesOn: "scheduleTick",
    label: "Group done & stale",
    description:
      "Fires when a done group hasn't appeared in a session capture for N days.",
    defaultConfig: { days: 30 },
    matches: (group, config) => {
      if (group.status !== "done") return false;
      const days = typeof config.days === "number" ? config.days : 30;
      const lastSeen = group.lastSeenAt ?? group.createdAt;
      return Date.now() - lastSeen > days * 24 * 60 * 60 * 1000;
    },
  },
  groupTabsEmpty: {
    kind: "trigger",
    firesOn: "groupTabsSettled",
    label: "Tabs closed",
    description: "Fires when a group's live tabs settle at zero.",
    defaultConfig: {},
    matches: (group) => group.status !== "done" && group.tabs.length === 0,
  },
  setGroupStatus: {
    kind: "action",
    label: "Set status",
    description: "Sets the group's status.",
    defaultConfig: { status: "done" },
    run: async (ctx, config) => {
      const status = config.status as Group["status"];
      if (status) await updateGroup(ctx.group.id, { status });
    },
  },
  archiveGroup: {
    kind: "action",
    label: "Archive",
    description: "Archives the group — hidden but kept, never deleted.",
    defaultConfig: {},
    run: async (ctx) => {
      await archiveGroup(ctx.group.id);
    },
  },
  advanceNextSibling: {
    kind: "action",
    label: "Advance to next sibling",
    description:
      "Opens the next pending sibling group's tabs and activates it. No-op if the group isn't nested under a Project, or has no pending sibling.",
    defaultConfig: {},
    run: async (ctx) => {
      if (!ctx.project) return;
      await advanceNextSibling(ctx.project, ctx.group, ctx.windowId);
    },
  },
};
