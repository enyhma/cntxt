import { assign, fromPromise, setup } from "xstate";
import { removeWindowQuest, setWindowQuest } from "./session";
import { closeMatchingTabs, openMissingTabs } from "./tabOps";
import type { Quest } from "./quests";

type Context = {
  quest: Quest | null;
  windowId: number | null;
  detach: boolean;
};
type Event =
  | { type: "RESTORE"; quest: Quest }
  | { type: "CLOSE_TABS" }
  | { type: "DISCONNECT" };

async function closeCurrentTabs(input: {
  detach: boolean;
}): Promise<number | null> {
  const win = await browser.windows.getCurrent();
  if (win.id === undefined) return null;

  if (input.detach) {
    // Detach the outgoing quest before closing its tabs, so the
    // background script's live tab-sync doesn't attribute the closures to
    // it and zero out its saved tab list — we're leaving it, not clearing
    // it. (Plain "close all tabs" skips this: staying attached is what
    // makes that sync correctly record the quest as now empty.) Used by
    // both RESTORE (reattaches to a new quest right after) and
    // DISCONNECT (doesn't reattach at all).
    await removeWindowQuest(win.id);
  }

  await closeMatchingTabs(win.id, () => true);
  return win.id;
}

async function openQuestTabs(input: {
  windowId: number | null;
  quest: Quest | null;
}) {
  if (input.windowId === null || input.quest === null) return;
  await setWindowQuest(input.windowId, input.quest.id);
  await openMissingTabs(input.windowId, input.quest.tabs);
}

/**
 * Shared "busy" gate for the two window-mutating dashboard actions: closing
 * the current quest's tabs, and restoring another quest into this
 * window (which is a close, then an open). Mutually exclusive so a
 * double-click can't overlap two of these operations.
 */
export const restoreMachine = setup({
  types: {} as { context: Context; events: Event },
  actors: {
    closeCurrentTabs: fromPromise(({ input }: { input: { detach: boolean } }) =>
      closeCurrentTabs(input),
    ),
    openQuestTabs: fromPromise(({ input }: { input: Context }) =>
      openQuestTabs(input),
    ),
  },
}).createMachine({
  context: { quest: null, windowId: null, detach: false },
  initial: "idle",
  states: {
    idle: {
      on: {
        RESTORE: {
          target: "closingTabs",
          actions: assign({
            quest: ({ event }) => event.quest,
            detach: true,
          }),
        },
        CLOSE_TABS: {
          target: "closingTabs",
          actions: assign({ quest: null, detach: false }),
        },
        DISCONNECT: {
          target: "closingTabs",
          actions: assign({ quest: null, detach: true }),
        },
      },
    },
    closingTabs: {
      invoke: {
        src: "closeCurrentTabs",
        input: ({ context }) => ({ detach: context.detach }),
        onDone: {
          target: "openingTabs",
          actions: assign({ windowId: ({ event }) => event.output }),
        },
      },
    },
    openingTabs: {
      invoke: {
        src: "openQuestTabs",
        input: ({ context }) => context,
        onDone: "idle",
      },
    },
  },
});
