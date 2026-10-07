import { assign, fromPromise, setup } from "xstate";
import { closeMatchingTabs, openMissingTabs } from "./tabOps";
import { updateMission } from "./missions";
import type { Mission, Phase } from "./missions";

type Mode = "activate" | "complete";

type Context = {
  mission: Mission | null;
  windowId: number | null;
  mode: Mode | null;
  // The phase named in the triggering event — the one to activate, or the
  // one being marked done.
  eventPhaseId: string | null;
  // Phase to open tabs for once closing finishes; null when completing the
  // last phase in the roadmap leaves nothing to advance to.
  openPhaseId: string | null;
  nextPhases: Phase[] | null;
  nextActivePhaseId: string | undefined;
};

type Event =
  | { type: "ACTIVATE_PHASE"; mission: Mission; phaseId: string }
  | { type: "COMPLETE_PHASE"; mission: Mission; phaseId: string };

function phaseIdOfUrl(mission: Mission, url: string | undefined) {
  if (!url) return undefined;
  return mission.tabs.find((t) => t.url === url)?.phaseId;
}

async function closeForEvent(input: {
  mission: Mission;
  mode: Mode;
  eventPhaseId: string;
}): Promise<number | null> {
  const win = await browser.windows.getCurrent();
  if (win.id === undefined) return null;
  await closeMatchingTabs(win.id, (tab) => {
    const tabPhaseId = phaseIdOfUrl(input.mission, tab.url);
    // Activating a phase closes every *other* phase's tabs, leaving
    // unphased tabs (phaseId undefined) and this phase's own tabs alone.
    // Completing a phase closes only that phase's own tabs.
    return input.mode === "activate"
      ? tabPhaseId !== undefined && tabPhaseId !== input.eventPhaseId
      : tabPhaseId === input.eventPhaseId;
  });
  return win.id;
}

async function openAndPersist(input: {
  windowId: number | null;
  mission: Mission;
  openPhaseId: string | null;
  nextPhases: Phase[];
  nextActivePhaseId: string | undefined;
}) {
  if (input.windowId !== null && input.openPhaseId !== null) {
    const tabs = input.mission.tabs.filter(
      (t) => t.phaseId === input.openPhaseId,
    );
    await openMissingTabs(input.windowId, tabs);
  }
  await updateMission(input.mission.id, {
    phases: input.nextPhases,
    activePhaseId: input.nextActivePhaseId,
  });
}

/**
 * Stage-gated roadmap: activating a phase swaps the window's tabs to that
 * phase's subset; completing one closes its tabs and auto-advances to the
 * next pending phase. Mirrors restoreMachine's closingTabs/openingTabs
 * shape (sharing its tabOps.ts helpers) but is its own machine — the
 * close/open semantics genuinely differ (filtered close instead of
 * close-all, no window detach/reattach) enough that one shared machine
 * would need branchy context instead of two small ones.
 */
export const phaseMachine = setup({
  types: {} as { context: Context; events: Event },
  actors: {
    closeForEvent: fromPromise(
      ({
        input,
      }: {
        input: { mission: Mission; mode: Mode; eventPhaseId: string };
      }) => closeForEvent(input),
    ),
    openAndPersist: fromPromise(
      ({
        input,
      }: {
        input: {
          windowId: number | null;
          mission: Mission;
          openPhaseId: string | null;
          nextPhases: Phase[];
          nextActivePhaseId: string | undefined;
        };
      }) => openAndPersist(input),
    ),
  },
}).createMachine({
  context: {
    mission: null,
    windowId: null,
    mode: null,
    eventPhaseId: null,
    openPhaseId: null,
    nextPhases: null,
    nextActivePhaseId: undefined,
  },
  initial: "idle",
  states: {
    idle: {
      on: {
        ACTIVATE_PHASE: {
          target: "closingTabs",
          actions: assign(({ event }) => {
            const phases = (event.mission.phases ?? []).map((p) =>
              p.id === event.phaseId
                ? { ...p, status: "active" as const }
                : p.status === "active"
                  ? { ...p, status: "pending" as const }
                  : p,
            );
            return {
              mission: event.mission,
              mode: "activate" as const,
              eventPhaseId: event.phaseId,
              openPhaseId: event.phaseId,
              nextPhases: phases,
              nextActivePhaseId: event.phaseId,
            };
          }),
        },
        COMPLETE_PHASE: {
          target: "closingTabs",
          actions: assign(({ event }) => {
            const phases = event.mission.phases ?? [];
            const idx = phases.findIndex((p) => p.id === event.phaseId);
            const next = phases
              .slice(idx + 1)
              .find((p) => p.status === "pending");
            const nextPhases = phases.map((p) =>
              p.id === event.phaseId
                ? { ...p, status: "done" as const }
                : next && p.id === next.id
                  ? { ...p, status: "active" as const }
                  : p,
            );
            return {
              mission: event.mission,
              mode: "complete" as const,
              eventPhaseId: event.phaseId,
              openPhaseId: next?.id ?? null,
              nextPhases,
              nextActivePhaseId: next?.id,
            };
          }),
        },
      },
    },
    closingTabs: {
      invoke: {
        src: "closeForEvent",
        input: ({ context }) => ({
          mission: context.mission!,
          mode: context.mode!,
          eventPhaseId: context.eventPhaseId!,
        }),
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
          windowId: context.windowId ?? null,
          mission: context.mission!,
          openPhaseId: context.openPhaseId,
          nextPhases: context.nextPhases!,
          nextActivePhaseId: context.nextActivePhaseId,
        }),
        onDone: "idle",
      },
    },
  },
});
