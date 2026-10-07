import { assign, fromPromise, setup } from "xstate";
import { removeWindowMission, setWindowMission } from "./session";
import { DASHBOARD_URL } from "./tabs";
import type { Mission } from "./missions";

type Context = {
  mission: Mission | null;
  windowId: number | null;
  detach: boolean;
};
type Event =
  | { type: "RESTORE"; mission: Mission }
  | { type: "CLOSE_TABS" }
  | { type: "DISCONNECT" };

async function closeCurrentTabs(input: {
  detach: boolean;
}): Promise<number | null> {
  const win = await browser.windows.getCurrent();
  if (win.id === undefined) return null;

  if (input.detach) {
    // Detach the outgoing mission before closing its tabs, so the
    // background script's live tab-sync doesn't attribute the closures to
    // it and zero out its saved tab list — we're leaving it, not clearing
    // it. (Plain "close all tabs" skips this: staying attached is what
    // makes that sync correctly record the mission as now empty.) Used by
    // both RESTORE (reattaches to a new mission right after) and
    // DISCONNECT (doesn't reattach at all).
    await removeWindowMission(win.id);
  }

  const tabs = await browser.tabs.query({ windowId: win.id });
  const ids = tabs
    .filter((t) => t.url !== DASHBOARD_URL)
    .map((t) => t.id)
    .filter((id): id is number => id !== undefined);
  if (ids.length > 0) await browser.tabs.remove(ids);
  return win.id;
}

async function openMissionTabs(input: {
  windowId: number | null;
  mission: Mission | null;
}) {
  if (input.windowId === null || input.mission === null) return;
  await setWindowMission(input.windowId, input.mission.id);
  for (const tab of input.mission.tabs) {
    await browser.tabs.create({ windowId: input.windowId, url: tab.url });
  }
}

/**
 * Shared "busy" gate for the two window-mutating dashboard actions: closing
 * the current mission's tabs, and restoring another mission into this
 * window (which is a close, then an open). Mutually exclusive so a
 * double-click can't overlap two of these operations.
 */
export const restoreMachine = setup({
  types: {} as { context: Context; events: Event },
  actors: {
    closeCurrentTabs: fromPromise(({ input }: { input: { detach: boolean } }) =>
      closeCurrentTabs(input),
    ),
    openMissionTabs: fromPromise(({ input }: { input: Context }) =>
      openMissionTabs(input),
    ),
  },
}).createMachine({
  context: { mission: null, windowId: null, detach: false },
  initial: "idle",
  states: {
    idle: {
      on: {
        RESTORE: {
          target: "closingTabs",
          actions: assign({
            mission: ({ event }) => event.mission,
            detach: true,
          }),
        },
        CLOSE_TABS: {
          target: "closingTabs",
          actions: assign({ mission: null, detach: false }),
        },
        DISCONNECT: {
          target: "closingTabs",
          actions: assign({ mission: null, detach: true }),
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
        src: "openMissionTabs",
        input: ({ context }) => context,
        onDone: "idle",
      },
    },
  },
});
