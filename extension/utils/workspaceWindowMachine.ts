import { setup } from "xstate";
import { getWindowWorkspaceMap } from "./session";
import { snapshotTabs } from "./tabs";
import { updateWorkspace } from "./workspaces";

type Context = { windowId: number };
type Event = { type: "TABS_CHANGED" } | { type: "WINDOW_CLOSED" };

async function syncTabs(windowId: number) {
  const map = await getWindowWorkspaceMap();
  const workspaceId = map[windowId];
  if (!workspaceId) return;
  await updateWorkspace(workspaceId, { tabs: await snapshotTabs(windowId) });
}

/**
 * One actor per open window. workspaceId is deliberately NOT kept in
 * context: the dashboard can reassign a window to a different workspace
 * (Restore) without this actor knowing, so syncTabs re-reads the mapping
 * from session storage on every sync instead of trusting stale context.
 */
export const workspaceWindowMachine = setup({
  types: {} as { context: Context; events: Event; input: Context },
  actions: {
    syncTabs: ({ context }) => {
      syncTabs(context.windowId);
    },
  },
}).createMachine({
  context: ({ input }) => input,
  initial: "syncing",
  states: {
    syncing: {
      entry: "syncTabs",
      on: {
        TABS_CHANGED: { actions: "syncTabs" },
        WINDOW_CLOSED: "stopped",
      },
    },
    stopped: { type: "final" },
  },
});
