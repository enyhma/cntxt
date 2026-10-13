import { createActor } from "xstate";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const pullRemoteGroups = vi.fn();
const pushDirtyGroups = vi.fn();
const purgeExpiredLocalTrash = vi.fn();
vi.mock("./groups", () => ({
  pullRemoteGroups,
  pushDirtyGroups,
  purgeExpiredLocalTrash,
}));
const pullRemoteFolders = vi.fn();
const pushDirtyFolders = vi.fn();
vi.mock("./folders", () => ({ pullRemoteFolders, pushDirtyFolders }));
const pullRemoteResources = vi.fn();
vi.mock("./resources", () => ({ pullRemoteResources }));
const pullRemoteSessions = vi.fn();
vi.mock("./sessions", () => ({ pullRemoteSessions }));
vi.mock("./entitlements", () => ({
  getCachedEntitlements: vi.fn().mockResolvedValue(undefined),
}));

const { syncMachine } = await import("./sync");

beforeEach(() => {
  vi.useFakeTimers();
  pullRemoteGroups.mockReset().mockResolvedValue(0);
  pushDirtyGroups.mockReset().mockImplementation((input) => input);
  purgeExpiredLocalTrash.mockReset().mockResolvedValue(undefined);
  pullRemoteFolders.mockReset().mockResolvedValue(0);
  pushDirtyFolders.mockReset().mockImplementation((input) => input);
  pullRemoteResources.mockReset().mockResolvedValue(0);
  pullRemoteSessions.mockReset().mockResolvedValue(0);
});

afterEach(() => {
  vi.useRealTimers();
});

// pullAndPurgeTrash chains three awaits (pull, getCachedEntitlements,
// purge) — a single microtask tick isn't enough to drain it, so flush
// several.
async function flush() {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

describe("syncMachine", () => {
  it("pulls once on start", async () => {
    const actor = createActor(syncMachine).start();
    await flush();
    expect(pullRemoteGroups).toHaveBeenCalledTimes(1);
    expect(actor.getSnapshot().value).toBe("idle");
  });

  it("debounces a burst of LOCAL_CHANGE into a single push", async () => {
    const actor = createActor(syncMachine).start();
    await flush();

    actor.send({ type: "LOCAL_CHANGE" });
    vi.advanceTimersByTime(500);
    actor.send({ type: "LOCAL_CHANGE" });
    vi.advanceTimersByTime(500);
    actor.send({ type: "LOCAL_CHANGE" });
    expect(pushDirtyGroups).not.toHaveBeenCalled();

    vi.advanceTimersByTime(2000);
    await flush();
    expect(pushDirtyGroups).toHaveBeenCalledTimes(1);
    expect(actor.getSnapshot().value).toBe("idle");
  });

  it("re-debounces a LOCAL_CHANGE that lands mid-push instead of dropping it", async () => {
    let resolvePush!: (v: Record<string, number>) => void;
    pushDirtyGroups.mockImplementation(
      () => new Promise((resolve) => (resolvePush = resolve)),
    );

    const actor = createActor(syncMachine).start();
    await flush();
    actor.send({ type: "LOCAL_CHANGE" });
    vi.advanceTimersByTime(2000);
    await flush();
    expect(actor.getSnapshot().value).toBe("pushing");

    actor.send({ type: "LOCAL_CHANGE" });
    resolvePush({});
    await flush();
    expect(actor.getSnapshot().value).toBe("debouncingPush");

    vi.advanceTimersByTime(2000);
    await flush();
    expect(pushDirtyGroups).toHaveBeenCalledTimes(2);
  });

  it("goes offline on a pull failure and recovers on ONLINE", async () => {
    pullRemoteGroups.mockRejectedValue(new Error("network"));
    const actor = createActor(syncMachine).start();
    await flush();
    expect(actor.getSnapshot().value).toBe("offline");

    pullRemoteGroups.mockResolvedValue(0);
    actor.send({ type: "ONLINE" });
    expect(actor.getSnapshot().value).toBe("idle");
  });

  it("goes offline on a push failure without losing lastPushedAt progress", async () => {
    const actor = createActor(syncMachine).start();
    await flush();

    pushDirtyGroups.mockRejectedValue(new Error("network"));
    actor.send({ type: "LOCAL_CHANGE" });
    vi.advanceTimersByTime(2000);
    await flush();
    expect(actor.getSnapshot().value).toBe("offline");
  });

  it("runs a periodic pull on the interval without any LOCAL_CHANGE", async () => {
    const actor = createActor(syncMachine).start();
    await flush();
    expect(pullRemoteGroups).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(5 * 60 * 1000);
    await flush();
    expect(pullRemoteGroups).toHaveBeenCalledTimes(2);
    expect(actor.getSnapshot().value).toBe("idle");
  });
});
