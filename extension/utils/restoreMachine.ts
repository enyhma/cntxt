import { assign, fromPromise, setup } from "xstate";
import { removeWindowWorkspace, setWindowWorkspace } from "./session";
import { DASHBOARD_URL } from "./tabs";
import type { Workspace } from "./workspaces";

type Context = {
  workspace: Workspace | null;
  windowId: number | null;
  detach: boolean;
};
type Event =
  | { type: "RESTORE"; workspace: Workspace }
  | { type: "CLOSE_TABS" }
  | { type: "DISCONNECT" };

async function closeCurrentTabs(input: {
  detach: boolean;
}): Promise<number | null> {
  const win = await browser.windows.getCurrent();
  if (win.id === undefined) return null;

  if (input.detach) {
    // Detach the outgoing workspace before closing its tabs, so the
    // background script's live tab-sync doesn't attribute the closures to
    // it and zero out its saved tab list — we're leaving it, not clearing
    // it. (Plain "close all tabs" skips this: staying attached is what
    // makes that sync correctly record the workspace as now empty.) Used by
    // both RESTORE (reattaches to a new workspace right after) and
    // DISCONNECT (doesn't reattach at all).
    await removeWindowWorkspace(win.id);
  }

  const tabs = await browser.tabs.query({ windowId: win.id });
  const ids = tabs
    .filter((t) => t.url !== DASHBOARD_URL)
    .map((t) => t.id)
    .filter((id): id is number => id !== undefined);
  if (ids.length > 0) await browser.tabs.remove(ids);
  return win.id;
}

async function openWorkspaceTabs(input: {
  windowId: number | null;
  workspace: Workspace | null;
}) {
  if (input.windowId === null || input.workspace === null) return;
  await setWindowWorkspace(input.windowId, input.workspace.id);
  for (const tab of input.workspace.tabs) {
    await browser.tabs.create({ windowId: input.windowId, url: tab.url });
  }
}

/**
 * Shared "busy" gate for the two window-mutating dashboard actions: closing
 * the current workspace's tabs, and restoring another workspace into this
 * window (which is a close, then an open). Mutually exclusive so a
 * double-click can't overlap two of these operations.
 */
export const restoreMachine = setup({
  types: {} as { context: Context; events: Event },
  actors: {
    closeCurrentTabs: fromPromise(({ input }: { input: { detach: boolean } }) =>
      closeCurrentTabs(input),
    ),
    openWorkspaceTabs: fromPromise(({ input }: { input: Context }) =>
      openWorkspaceTabs(input),
    ),
  },
}).createMachine({
  context: { workspace: null, windowId: null, detach: false },
  initial: "idle",
  states: {
    idle: {
      on: {
        RESTORE: {
          target: "closingTabs",
          actions: assign({
            workspace: ({ event }) => event.workspace,
            detach: true,
          }),
        },
        CLOSE_TABS: {
          target: "closingTabs",
          actions: assign({ workspace: null, detach: false }),
        },
        DISCONNECT: {
          target: "closingTabs",
          actions: assign({ workspace: null, detach: true }),
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
        src: "openWorkspaceTabs",
        input: ({ context }) => context,
        onDone: "idle",
      },
    },
  },
});
