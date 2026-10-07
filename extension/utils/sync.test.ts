import { createActor } from "xstate";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const pullRemoteQuests = vi.fn();
const pushDirtyQuests = vi.fn();
const purgeExpiredLocalTrash = vi.fn();
vi.mock("./quests", () => ({
  pullRemoteQuests,
  pushDirtyQuests,
  purgeExpiredLocalTrash,
}));
const pullRemoteFolders = vi.fn();
const pushDirtyFolders = vi.fn();
vi.mock("./folders", () => ({ pullRemoteFolders, pushDirtyFolders }));
const pullRemoteResources = vi.fn();
vi.mock("./resources", () => ({ pullRemoteResources }));
vi.mock("./entitlements", () => ({
  getCachedEntitlements: vi.fn().mockResolvedValue(undefined),
}));

const { syncMachine } = await import("./sync");

beforeEach(() => {
  vi.useFakeTimers();
  pullRemoteQuests.mockReset().mockResolvedValue(0);
  pushDirtyQuests.mockReset().mockImplementation((input) => input);
  purgeExpiredLocalTrash.mockReset().mockResolvedValue(undefined);
  pullRemoteFolders.mockReset().mockResolvedValue(0);
  pushDirtyFolders.mockReset().mockImplementation((input) => input);
  pullRemoteResources.mockReset().mockResolvedValue(0);
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
    expect(pullRemoteQuests).toHaveBeenCalledTimes(1);
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
    expect(pushDirtyQuests).not.toHaveBeenCalled();

    vi.advanceTimersByTime(2000);
    await flush();
    expect(pushDirtyQuests).toHaveBeenCalledTimes(1);
    expect(actor.getSnapshot().value).toBe("idle");
  });

  it("re-debounces a LOCAL_CHANGE that lands mid-push instead of dropping it", async () => {
    let resolvePush!: (v: Record<string, number>) => void;
    pushDirtyQuests.mockImplementation(
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
    expect(pushDirtyQuests).toHaveBeenCalledTimes(2);
  });

  it("goes offline on a pull failure and recovers on ONLINE", async () => {
    pullRemoteQuests.mockRejectedValue(new Error("network"));
    const actor = createActor(syncMachine).start();
    await flush();
    expect(actor.getSnapshot().value).toBe("offline");

    pullRemoteQuests.mockResolvedValue(0);
    actor.send({ type: "ONLINE" });
    expect(actor.getSnapshot().value).toBe("idle");
  });

  it("goes offline on a push failure without losing lastPushedAt progress", async () => {
    const actor = createActor(syncMachine).start();
    await flush();

    pushDirtyQuests.mockRejectedValue(new Error("network"));
    actor.send({ type: "LOCAL_CHANGE" });
    vi.advanceTimersByTime(2000);
    await flush();
    expect(actor.getSnapshot().value).toBe("offline");
  });

  it("runs a periodic pull on the interval without any LOCAL_CHANGE", async () => {
    const actor = createActor(syncMachine).start();
    await flush();
    expect(pullRemoteQuests).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(5 * 60 * 1000);
    await flush();
    expect(pullRemoteQuests).toHaveBeenCalledTimes(2);
    expect(actor.getSnapshot().value).toBe("idle");
  });
});
