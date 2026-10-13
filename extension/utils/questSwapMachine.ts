import { assign, fromPromise, setup } from "xstate";
import { closeMatchingTabs, openMissingTabs } from "./tabOps";
import { getQuests, updateQuest } from "./quests";
import type { Quest } from "./quests";
import { updateFolder } from "./folders";
import type { Folder } from "./folders";

type Mode = "activate" | "complete";

type Context = {
  project: Folder | null;
  quest: Quest | null;
  windowId: number | null;
  mode: Mode | null;
};

type Event =
  | { type: "ACTIVATE_QUEST"; project: Folder; quest: Quest }
  | { type: "COMPLETE_QUEST"; project: Folder; quest: Quest };

async function closeForEvent(): Promise<number | null> {
  const win = await browser.windows.getCurrent();
  if (win.id === undefined) return null;
  await closeMatchingTabs(win.id, () => true);
  return win.id;
}

// Finds the next `pending` sibling by `order` and swaps it in (opens its
// tabs, activates it), or clears `activeQuestId` if there's none. Shared
// by the explicit COMPLETE_QUEST path below and by the automation
// engine's "advanceNextSibling" action block (utils/automationBlocks.ts), which
// fires this same effect from a passive trigger instead of a user click.
export async function advanceNextSibling(
  project: Folder,
  quest: Quest,
  windowId: number | null,
): Promise<void> {
  const siblings = (await getQuests()).filter((q) => q.folderId === project.id);
  const next = siblings
    .filter((s) => s.id !== quest.id && s.status === "pending")
    .sort((a, b) => a.order - b.order)[0];
  if (next) {
    if (windowId !== null) {
      await openMissingTabs(windowId, next.tabs);
    }
    await updateFolder(project.id, { activeQuestId: next.id });
    await updateQuest(next.id, { status: "active" });
  } else {
    await updateFolder(project.id, { activeQuestId: undefined });
  }
}

async function openAndPersist(input: {
  windowId: number | null;
  mode: Mode;
  project: Folder;
  quest: Quest;
}) {
  if (input.mode === "activate") {
    const siblings = (await getQuests()).filter(
      (q) => q.folderId === input.project.id,
    );
    if (input.windowId !== null) {
      await openMissingTabs(input.windowId, input.quest.tabs);
    }
    await updateFolder(input.project.id, { activeQuestId: input.quest.id });
    await updateQuest(input.quest.id, { status: "active" });
    for (const sib of siblings) {
      if (sib.id !== input.quest.id && sib.status === "active") {
        await updateQuest(sib.id, { status: "pending" });
      }
    }
    return;
  }

  // Complete: close its tabs and mark it done — `quest.tabs` is NEVER
  // cleared, so this stays a full record, reopenable later via another
  // ACTIVATE_QUEST (which works identically regardless of prior status).
  // Then auto-advance to the next pending sibling by order, if any.
  await updateQuest(input.quest.id, { status: "done" });
  await advanceNextSibling(input.project, input.quest, input.windowId);
}

/**
 * Swaps which child Quest of a Project has its tabs live in the Project's
 * window: activating one closes whatever's currently open and opens that
 * quest's own full tab list; completing one closes its tabs (never
 * clearing them) and auto-advances to the next pending sibling by order.
 * Only `Folder.activeQuestId` ever changes here — the window's
 * WindowBinding stays pointed at the Project throughout, unlike
 * restoreMachine's RESTORE/DISCONNECT, which do change it. Shares
 * closingTabs/openingTabs shape and tabOps.ts helpers with restoreMachine,
 * but close/open here is always everything-at-once (no detach/reattach),
 * so it stays its own small machine rather than branchy shared context.
 */
export const questSwapMachine = setup({
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
          quest: Quest;
        };
      }) => openAndPersist(input),
    ),
  },
}).createMachine({
  context: { project: null, quest: null, windowId: null, mode: null },
  initial: "idle",
  states: {
    idle: {
      on: {
        ACTIVATE_QUEST: {
          target: "closingTabs",
          actions: assign(({ event }) => ({
            project: event.project,
            quest: event.quest,
            mode: "activate" as const,
          })),
        },
        COMPLETE_QUEST: {
          target: "closingTabs",
          actions: assign(({ event }) => ({
            project: event.project,
            quest: event.quest,
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
          quest: context.quest!,
        }),
        onDone: "idle",
      },
    },
  },
});
