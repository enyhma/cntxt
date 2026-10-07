import { assign, fromPromise, setup } from "xstate";
import { removeWindowBinding, setWindowBinding } from "./session";
import { closeMatchingTabs, openMissingTabs } from "./tabOps";
import { resolveProjectLiveTarget } from "./projectLiveTabs";
import { getQuests, updateQuest } from "./quests";
import type { Quest } from "./quests";
import type { Folder } from "./folders";

type RestoreTarget =
  { kind: "project"; project: Folder } | { kind: "quest"; quest: Quest };

type Context = {
  target: RestoreTarget | null;
  windowId: number | null;
  detach: boolean;
};
type Event =
  | { type: "RESTORE"; target: RestoreTarget }
  | { type: "CLOSE_TABS" }
  | { type: "DISCONNECT" }
  // A standalone quest (no Project parent, so no questSwapMachine sibling
  // roster) gets the same non-destructive complete/reopen lifecycle a
  // Project-nested quest gets from questSwapMachine: detach + close like
  // DISCONNECT, plus mark it done. Reopening later is a plain RESTORE —
  // ACTIVATE-style reopening already works for any status.
  | { type: "COMPLETE_QUEST"; quest: Quest };

async function closeCurrentTabs(input: {
  detach: boolean;
}): Promise<number | null> {
  const win = await browser.windows.getCurrent();
  if (win.id === undefined) return null;

  if (input.detach) {
    // Detach the outgoing binding before closing its tabs, so the
    // background script's live tab-sync doesn't attribute the closures to
    // it and zero out its saved tab list — we're leaving it, not clearing
    // it. (Plain "close all tabs" skips this: staying attached is what
    // makes that sync correctly record the target as now empty.) Used by
    // both RESTORE (reattaches to a new target right after) and
    // DISCONNECT (doesn't reattach at all).
    await removeWindowBinding(win.id);
  }

  await closeMatchingTabs(win.id, () => true);
  return win.id;
}

async function openBindingTabs(input: {
  windowId: number | null;
  target: RestoreTarget | null;
}) {
  if (input.windowId === null || input.target === null) return;

  if (input.target.kind === "quest") {
    await setWindowBinding(input.windowId, {
      kind: "quest",
      questId: input.target.quest.id,
    });
    await openMissingTabs(input.windowId, input.target.quest.tabs);
    return;
  }

  await setWindowBinding(input.windowId, {
    kind: "project",
    projectId: input.target.project.id,
  });
  const resolved = resolveProjectLiveTarget(input.target.project);
  const tabs =
    resolved.table === "quests"
      ? ((await getQuests()).find((q) => q.id === resolved.id)?.tabs ?? [])
      : (input.target.project.tabs ?? []);
  await openMissingTabs(input.windowId, tabs);
}

/**
 * Shared "busy" gate for the two window-mutating dashboard actions: closing
 * the current binding's tabs, and restoring another Project or Quest into
 * this window (which is a close, then an open). Mutually exclusive so a
 * double-click can't overlap them.
 */
export const restoreMachine = setup({
  types: {} as { context: Context; events: Event },
  actors: {
    closeCurrentTabs: fromPromise(({ input }: { input: { detach: boolean } }) =>
      closeCurrentTabs(input),
    ),
    openBindingTabs: fromPromise(({ input }: { input: Context }) =>
      openBindingTabs(input),
    ),
  },
}).createMachine({
  context: { target: null, windowId: null, detach: false },
  initial: "idle",
  states: {
    idle: {
      on: {
        RESTORE: {
          target: "closingTabs",
          actions: assign({
            target: ({ event }) => event.target,
            detach: true,
          }),
        },
        CLOSE_TABS: {
          target: "closingTabs",
          actions: assign({ target: null, detach: false }),
        },
        DISCONNECT: {
          target: "closingTabs",
          actions: assign({ target: null, detach: true }),
        },
        COMPLETE_QUEST: {
          target: "closingTabs",
          actions: [
            assign({ target: null, detach: true }),
            ({ event }) => {
              updateQuest(event.quest.id, { status: "done" });
            },
          ],
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
        src: "openBindingTabs",
        input: ({ context }) => context,
        onDone: "idle",
      },
    },
  },
});
