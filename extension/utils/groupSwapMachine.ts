import { assign, fromPromise, setup } from "xstate";
import { closeMatchingTabs, openMissingTabs } from "./tabOps";
import { getGroups, updateGroup } from "./groups";
import type { Group } from "./groups";
import { updateFolder } from "./folders";
import type { Folder } from "./folders";

type Mode = "activate" | "complete";

type Context = {
  project: Folder | null;
  group: Group | null;
  windowId: number | null;
  mode: Mode | null;
};

type Event =
  | { type: "ACTIVATE_GROUP"; project: Folder; group: Group }
  | { type: "COMPLETE_GROUP"; project: Folder; group: Group };

async function closeForEvent(): Promise<number | null> {
  const win = await browser.windows.getCurrent();
  if (win.id === undefined) return null;
  await closeMatchingTabs(win.id, () => true);
  return win.id;
}

// Finds the next `pending` sibling by `order` and swaps it in (opens its
// tabs, activates it), or clears `activeGroupId` if there's none. Shared
// by the explicit COMPLETE_GROUP path below and by the automation
// engine's "advanceNextSibling" action block (utils/automationBlocks.ts),
// which fires this same effect from a passive trigger instead of a user
// click.
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
    if (windowId !== null) {
      await openMissingTabs(windowId, next.tabs);
    }
    await updateFolder(project.id, { activeGroupId: next.id });
    await updateGroup(next.id, { status: "active" });
  } else {
    await updateFolder(project.id, { activeGroupId: undefined });
  }
}

async function openAndPersist(input: {
  windowId: number | null;
  mode: Mode;
  project: Folder;
  group: Group;
}) {
  if (input.mode === "activate") {
    const siblings = (await getGroups()).filter(
      (g) => g.folderId === input.project.id,
    );
    if (input.windowId !== null) {
      await openMissingTabs(input.windowId, input.group.tabs);
    }
    await updateFolder(input.project.id, { activeGroupId: input.group.id });
    await updateGroup(input.group.id, { status: "active" });
    for (const sib of siblings) {
      if (sib.id !== input.group.id && sib.status === "active") {
        await updateGroup(sib.id, { status: "pending" });
      }
    }
    return;
  }

  // Complete: close its tabs and mark it done — `group.tabs` is NEVER
  // cleared, so this stays a full record, reopenable later via another
  // ACTIVATE_GROUP (which works identically regardless of prior status).
  // Then auto-advance to the next pending sibling by order, if any.
  await updateGroup(input.group.id, { status: "done" });
  await advanceNextSibling(input.project, input.group, input.windowId);
}

/**
 * Swaps which child Group of a Project has its tabs live in the Project's
 * window: activating one closes whatever's currently open and opens that
 * group's own full tab list; completing one closes its tabs (never
 * clearing them) and auto-advances to the next pending sibling by order.
 * Only `Folder.activeGroupId` ever changes here — the window's
 * WindowBinding stays pointed at the Project throughout, unlike
 * restoreMachine's RESTORE/DISCONNECT, which do change it. Shares
 * closingTabs/openingTabs shape and tabOps.ts helpers with restoreMachine,
 * but close/open here is always everything-at-once (no detach/reattach),
 * so it stays its own small machine rather than branchy shared context.
 */
export const groupSwapMachine = setup({
  types: {} as { context: Context; events: Event },
  actors: {
    closeForEvent: fromPromise(() => closeForEvent()),
    openAndPersist: fromPromise(
      ({
        input,
      }: {
        input: {
          windowId: number | null;
          mode: Mode;
          project: Folder;
          group: Group;
        };
      }) => openAndPersist(input),
    ),
  },
}).createMachine({
  context: { project: null, group: null, windowId: null, mode: null },
  initial: "idle",
  states: {
    idle: {
      on: {
        ACTIVATE_GROUP: {
          target: "closingTabs",
          actions: assign(({ event }) => ({
            project: event.project,
            group: event.group,
            mode: "activate" as const,
          })),
        },
        COMPLETE_GROUP: {
          target: "closingTabs",
          actions: assign(({ event }) => ({
            project: event.project,
            group: event.group,
            mode: "complete" as const,
          })),
        },
      },
    },
    closingTabs: {
      invoke: {
        src: "closeForEvent",
        onDone: {
          target: "openingTabs",
          actions: assign({ windowId: ({ event }) => event.output }),
        },
      },
    },
    openingTabs: {
      invoke: {
        src: "openAndPersist",
        input: ({ context }) => ({
          windowId: context.windowId,
          mode: context.mode!,
          project: context.project!,
          group: context.group!,
        }),
        onDone: "idle",
      },
    },
  },
});
