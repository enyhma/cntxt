import { setup } from "xstate";
import { getWindowMissionMap } from "./session";
import { snapshotTabs } from "./tabs";
import { getMissions, updateMission } from "./missions";

type Context = { windowId: number };
type Event = { type: "TABS_CHANGED" } | { type: "WINDOW_CLOSED" };

async function syncTabs(windowId: number) {
  const map = await getWindowMissionMap();
  const missionId = map[windowId];
  if (!missionId) return;
  const mission = (await getMissions()).find((m) => m.id === missionId);
  if (!mission) return;

  // Re-reads activePhaseId fresh every sync, same staleness reason as the
  // window->mission mapping above: the dashboard can activate a different
  // phase independently of this actor. A tab already known keeps its
  // phaseId (identity by URL — see the MissionTab type comment); only a
  // genuinely new tab gets tagged with whatever phase is active right now.
  const existingByUrl = new Map(mission.tabs.map((t) => [t.url, t]));
  const tabs = (await snapshotTabs(windowId)).map((t) => {
    const existing = existingByUrl.get(t.url);
    return existing
      ? { ...existing, title: t.title }
      : { ...t, phaseId: mission.activePhaseId };
  });
  await updateMission(missionId, { tabs });
}

/**
 * One actor per open window. missionId is deliberately NOT kept in
 * context: the dashboard can reassign a window to a different mission
 * (Restore) without this actor knowing, so syncTabs re-reads the mapping
 * from session storage on every sync instead of trusting stale context.
 */
export const missionWindowMachine = setup({
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
