import { assign, fromPromise, setup } from "xstate";
import { getCachedEntitlements } from "./entitlements";
import { pullRemoteFolders, pushDirtyFolders } from "./folders";
import { pullRemoteResources } from "./resources";
import { pullRemoteSessions } from "./sessions";
import {
  pullRemoteQuests,
  purgeExpiredLocalTrash,
  pushDirtyQuests,
} from "./quests";

async function pullAndPurgeTrash(): Promise<number> {
  // Folders first: a quest's folder_id pull below is only meaningful
  // once the folder it points to already exists locally. Resources last —
  // they reference a workspace_id, so pulling them before quests exist
  // locally would just leave them attributed to a quest not there yet.
  // Sessions have no FK ordering dependency on either (entity references
  // live denormalized inside their own jsonb, not as real FKs) — pulled
  // last out of convenience, not necessity. No pushDirtySessions: a
  // session is immutable after creation, nothing to push.
  const folders = await pullRemoteFolders();
  const quests = await pullRemoteQuests();
  const resources = await pullRemoteResources();
  const sessions = await pullRemoteSessions();
  const entitlements = await getCachedEntitlements();
  await purgeExpiredLocalTrash(entitlements?.accessExpiresAt);
  return folders + quests + resources + sessions;
}

async function pushDirty(
  lastPushedAt: Record<string, number>,
): Promise<Record<string, number>> {
  const afterFolders = await pushDirtyFolders(lastPushedAt);
  return pushDirtyQuests(afterFolders);
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
 * offline diagrams) the way windowSyncMachine owns per-window tab-sync
 * timing: the actual storage.local reads/writes live in utils/quests.ts,
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
      pushDirty(input),
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
      // of dirty quests — flag it so onDone re-debounces instead of
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
