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
const getCachedEntitlements = vi.fn();
vi.mock("./entitlements", () => ({ getCachedEntitlements }));

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
  // Sync (Groups/Folders/Sessions push+pull) is Pro-only — seed a
  // Pro-active cache so these tests exercise the sync machine itself, not
  // the plan gate (that gate gets its own test below).
  getCachedEntitlements.mockReset().mockResolvedValue({
    maxMissions: 100_000,
    accessExpiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    hasBasicLicense: false,
    proActive: true,
  });
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

  it("skips Groups/Folders/Sessions push+pull when Pro isn't active, but keeps pulling Resources", async () => {
    getCachedEntitlements.mockResolvedValue({
      maxMissions: 3,
      accessExpiresAt: null,
      hasBasicLicense: true,
      proActive: false,
    });

    const actor = createActor(syncMachine).start();
    await flush();
    expect(pullRemoteGroups).not.toHaveBeenCalled();
    expect(pullRemoteFolders).not.toHaveBeenCalled();
    expect(pullRemoteSessions).not.toHaveBeenCalled();
    expect(pullRemoteResources).toHaveBeenCalledTimes(1);
    expect(purgeExpiredLocalTrash).toHaveBeenCalledTimes(1);

    actor.send({ type: "LOCAL_CHANGE" });
    vi.advanceTimersByTime(2000);
    await flush();
    expect(pushDirtyGroups).not.toHaveBeenCalled();
    expect(pushDirtyFolders).not.toHaveBeenCalled();
    expect(actor.getSnapshot().value).toBe("idle");
  });
});
