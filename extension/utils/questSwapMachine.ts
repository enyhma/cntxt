import { assign, fromPromise, setup } from "xstate";
import { closeMatchingTabs, openMissingTabs } from "./tabOps";
import { updateQuest } from "./quests";
import type { Quest, Phase } from "./quests";

type Mode = "activate" | "complete";

type Context = {
  quest: Quest | null;
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
  | { type: "ACTIVATE_PHASE"; quest: Quest; phaseId: string }
  | { type: "COMPLETE_PHASE"; quest: Quest; phaseId: string };

function phaseIdOfUrl(quest: Quest, url: string | undefined) {
  if (!url) return undefined;
  return quest.tabs.find((t) => t.url === url)?.phaseId;
}

async function closeForEvent(input: {
  quest: Quest;
  mode: Mode;
  eventPhaseId: string;
}): Promise<number | null> {
  const win = await browser.windows.getCurrent();
  if (win.id === undefined) return null;
  await closeMatchingTabs(win.id, (tab) => {
    const tabPhaseId = phaseIdOfUrl(input.quest, tab.url);
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
  quest: Quest;
  openPhaseId: string | null;
  nextPhases: Phase[];
  nextActivePhaseId: string | undefined;
}) {
  if (input.windowId !== null && input.openPhaseId !== null) {
    const tabs = input.quest.tabs.filter(
      (t) => t.phaseId === input.openPhaseId,
    );
    await openMissingTabs(input.windowId, tabs);
  }
  await updateQuest(input.quest.id, {
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
export const questSwapMachine = setup({
  types: {} as { context: Context; events: Event },
  actors: {
    closeForEvent: fromPromise(
      ({
        input,
      }: {
        input: { quest: Quest; mode: Mode; eventPhaseId: string };
      }) => closeForEvent(input),
    ),
    openAndPersist: fromPromise(
      ({
        input,
      }: {
        input: {
          windowId: number | null;
          quest: Quest;
          openPhaseId: string | null;
          nextPhases: Phase[];
          nextActivePhaseId: string | undefined;
        };
      }) => openAndPersist(input),
    ),
  },
}).createMachine({
  context: {
    quest: null,
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
            const phases = (event.quest.phases ?? []).map((p) =>
              p.id === event.phaseId
                ? { ...p, status: "active" as const }
                : p.status === "active"
                  ? { ...p, status: "pending" as const }
                  : p,
            );
            return {
              quest: event.quest,
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
            const phases = event.quest.phases ?? [];
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
              quest: event.quest,
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
          quest: context.quest!,
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
          quest: context.quest!,
          openPhaseId: context.openPhaseId,
          nextPhases: context.nextPhases!,
          nextActivePhaseId: context.nextActivePhaseId,
        }),
        onDone: "idle",
      },
    },
  },
});
