import { createActor } from "xstate";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const pullRemoteWorkspaces = vi.fn();
const pushDirtyWorkspaces = vi.fn();
vi.mock("./workspaces", () => ({ pullRemoteWorkspaces, pushDirtyWorkspaces }));

const { syncMachine } = await import("./sync");

beforeEach(() => {
  vi.useFakeTimers();
  pullRemoteWorkspaces.mockReset().mockResolvedValue(0);
  pushDirtyWorkspaces.mockReset().mockImplementation((input) => input);
});

afterEach(() => {
  vi.useRealTimers();
});

async function flush() {
  await vi.waitFor(() => {});
}

describe("syncMachine", () => {
  it("pulls once on start", async () => {
    const actor = createActor(syncMachine).start();
    await flush();
    expect(pullRemoteWorkspaces).toHaveBeenCalledTimes(1);
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
    expect(pushDirtyWorkspaces).not.toHaveBeenCalled();

    vi.advanceTimersByTime(2000);
    await flush();
    expect(pushDirtyWorkspaces).toHaveBeenCalledTimes(1);
    expect(actor.getSnapshot().value).toBe("idle");
  });

  it("re-debounces a LOCAL_CHANGE that lands mid-push instead of dropping it", async () => {
    let resolvePush!: (v: Record<string, number>) => void;
    pushDirtyWorkspaces.mockImplementation(
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
    expect(pushDirtyWorkspaces).toHaveBeenCalledTimes(2);
  });

  it("goes offline on a pull failure and recovers on ONLINE", async () => {
    pullRemoteWorkspaces.mockRejectedValue(new Error("network"));
    const actor = createActor(syncMachine).start();
    await flush();
    expect(actor.getSnapshot().value).toBe("offline");

    pullRemoteWorkspaces.mockResolvedValue(0);
    actor.send({ type: "ONLINE" });
    expect(actor.getSnapshot().value).toBe("idle");
  });

  it("goes offline on a push failure without losing lastPushedAt progress", async () => {
    const actor = createActor(syncMachine).start();
    await flush();

    pushDirtyWorkspaces.mockRejectedValue(new Error("network"));
    actor.send({ type: "LOCAL_CHANGE" });
    vi.advanceTimersByTime(2000);
    await flush();
    expect(actor.getSnapshot().value).toBe("offline");
  });

  it("runs a periodic pull on the interval without any LOCAL_CHANGE", async () => {
    const actor = createActor(syncMachine).start();
    await flush();
    expect(pullRemoteWorkspaces).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(5 * 60 * 1000);
    await flush();
    expect(pullRemoteWorkspaces).toHaveBeenCalledTimes(2);
    expect(actor.getSnapshot().value).toBe("idle");
  });
});
