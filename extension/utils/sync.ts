import { assign, fromPromise, setup } from "xstate";
import { getCachedEntitlements } from "./entitlements";
import {
  pullRemoteWorkspaces,
  purgeExpiredLocalTrash,
  pushDirtyWorkspaces,
} from "./workspaces";

async function pullAndPurgeTrash(): Promise<number> {
  const applied = await pullRemoteWorkspaces();
  const entitlements = await getCachedEntitlements();
  await purgeExpiredLocalTrash(entitlements?.accessExpiresAt);
  return applied;
}

type Context = {
  lastPushedAt: Record<string, number>;
  lastPullCount?: number;
  lastError?: string;
  pendingPush: boolean;
};

type Event = { type: "PULL" } | { type: "LOCAL_CHANGE" } | { type: "ONLINE" };

// How long a burst of storage.onChanged writes (e.g. the background
// script's live tab-sync) is coalesced before pushing — see
// docs/architecture-sync.md's "debounce (coalesce a burst of tab-sync
// writes)".
const PUSH_DEBOUNCE_MS = 2000;

// Closest thing to M6's "periodic pull tick" — piggybacks on nothing this
// time (unlike the token-refresh timer App.tsx used before this machine
// existed), so it needs its own interval.
const PULL_INTERVAL_MS = 5 * 60 * 1000;

/**
 * Owns the sync engine's timing (docs/architecture-sync.md's push/pull/
 * offline diagrams) the way workspaceWindowMachine owns per-window tab-sync
 * timing: the actual storage.local reads/writes live in utils/workspaces.ts,
 * this just decides when to call them. One instance for the whole dashboard,
 * not per-window.
 *
 * `offline` collapses the diagram's separate "Retrying" state: there's
 * nothing distinct to do there beyond immediately retrying, so ONLINE goes
 * straight back to idle.
 */
export const syncMachine = setup({
  types: {} as { context: Context; events: Event },
  actors: {
    pull: fromPromise(() => pullAndPurgeTrash()),
    push: fromPromise(({ input }: { input: Record<string, number> }) =>
      pushDirtyWorkspaces(input),
    ),
  },
}).createMachine({
  context: { lastPushedAt: {}, pendingPush: false },
  initial: "pulling",
  states: {
    idle: {
      after: { [PULL_INTERVAL_MS]: "pulling" },
      on: {
        PULL: "pulling",
        LOCAL_CHANGE: "debouncingPush",
      },
    },
    debouncingPush: {
      // Re-entering the same state on a fresh LOCAL_CHANGE restarts the
      // `after` timer below, so a burst of writes only pushes once.
      on: { LOCAL_CHANGE: "debouncingPush" },
      after: { [PUSH_DEBOUNCE_MS]: "pushing" },
    },
    pushing: {
      entry: assign({ pendingPush: false }),
      invoke: {
        src: "push",
        input: ({ context }) => context.lastPushedAt,
        onDone: [
          {
            target: "debouncingPush",
            guard: ({ context }) => context.pendingPush,
            actions: assign({ lastPushedAt: ({ event }) => event.output }),
          },
          {
            target: "idle",
            actions: assign({ lastPushedAt: ({ event }) => event.output }),
          },
        ],
        onError: {
          target: "offline",
          actions: assign({
            lastError: ({ event }) => String(event.error),
          }),
        },
      },
      // A local change that lands mid-push isn't in this invoke's snapshot
      // of dirty workspaces — flag it so onDone re-debounces instead of
      // going idle and losing it until the next periodic pull tick.
      on: { LOCAL_CHANGE: { actions: assign({ pendingPush: true }) } },
    },
    pulling: {
      invoke: {
        src: "pull",
        onDone: {
          target: "idle",
          actions: assign({
            lastPullCount: ({ event }) => event.output,
            lastError: undefined,
          }),
        },
        onError: {
          target: "offline",
          actions: assign({
            lastError: ({ event }) => String(event.error),
          }),
        },
      },
    },
    offline: {
      on: { ONLINE: "idle", PULL: "pulling" },
    },
  },
});
