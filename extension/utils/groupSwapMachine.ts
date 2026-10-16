import { assign, fromPromise, setup } from "xstate";
import { closeMatchingTabs } from "./tabOps";
import { updateGroup } from "./groups";
import type { Group } from "./groups";
import type { Folder } from "./folders";
import { activateGroupInProject, advanceNextSibling } from "./groupActivation";

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

async function currentWindowId(): Promise<number | null> {
  const win = await browser.windows.getCurrent();
  return win.id ?? null;
}

async function run(input: {
  windowId: number | null;
  mode: Mode;
  project: Folder;
  group: Group;
}) {
  if (input.mode === "activate") {
    await activateGroupInProject(input.windowId, input.project, input.group);
    return;
  }

  // Complete: close only this group's own tabs (never clearing
  // `group.tabs` itself, so it stays a full record, reopenable later via
  // another ACTIVATE_GROUP) — every other live sibling's tabs are
  // untouched, unlike the old whole-window close. Then auto-advance to the
  // next pending sibling by order, if any.
  if (input.windowId !== null) {
    const urls = new Set(input.group.tabs.map((t) => t.url));
    await closeMatchingTabs(input.windowId, (tab) => urls.has(tab.url ?? ""));
  }
  await updateGroup(input.group.id, { status: "done" });
  await advanceNextSibling(input.project, input.group, input.windowId);
}

/**
 * Activates or completes a child Group of a Project. Every live sibling's
 * tabs are already open in the window (opened once at connect time by
 * restoreMachine, as a collapsed native tab group) — activating just
 * expands the target's native group and collapses whatever was previously
 * active, no window-wide close/reopen; completing closes only the one
 * group's own tabs. Only `Group.status`/`Folder.activeGroupId` change
 * here — the window's WindowBinding stays pointed at the Project
 * throughout, unlike restoreMachine's RESTORE/DISCONNECT.
 */
export const groupSwapMachine = setup({
  types: {} as { context: Context; events: Event },
  actors: {
    resolveWindowId: fromPromise(() => currentWindowId()),
    run: fromPromise(
      ({
        input,
      }: {
        input: {
          windowId: number | null;
          mode: Mode;
          project: Folder;
          group: Group;
        };
      }) => run(input),
    ),
  },
}).createMachine({
  context: { project: null, group: null, windowId: null, mode: null },
  initial: "idle",
  states: {
    idle: {
      on: {
        ACTIVATE_GROUP: {
          target: "resolvingWindow",
          actions: assign(({ event }) => ({
            project: event.project,
            group: event.group,
            mode: "activate" as const,
          })),
        },
        COMPLETE_GROUP: {
          target: "resolvingWindow",
          actions: assign(({ event }) => ({
            project: event.project,
            group: event.group,
            mode: "complete" as const,
          })),
        },
      },
    },
    resolvingWindow: {
      invoke: {
        src: "resolveWindowId",
        onDone: {
          target: "running",
          actions: assign({ windowId: ({ event }) => event.output }),
        },
      },
    },
    running: {
      invoke: {
        src: "run",
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
