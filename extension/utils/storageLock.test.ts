import { describe, expect, it } from "vitest";
import { withStorageLock } from "./storageLock";

describe("withStorageLock", () => {
  it("serializes concurrent read-modify-writes so none are lost", async () => {
    let value = 0;
    async function increment() {
      return withStorageLock("counter", async () => {
        const current = value;
        // Simulates the async gap a real storage.local round-trip leaves
        // between reading the current value and writing the next one —
        // without the lock, every concurrent call would read 0 here.
        await new Promise((resolve) => setTimeout(resolve, 0));
        value = current + 1;
      });
    }

    await Promise.all([
      increment(),
      increment(),
      increment(),
      increment(),
      increment(),
    ]);

    expect(value).toBe(5);
  });

  it("lets a failed call through without wedging later callers for the same key", async () => {
    await expect(
      withStorageLock("k", async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");

    await expect(withStorageLock("k", async () => "ok")).resolves.toBe("ok");
  });

  it("does not serialize calls for different keys against each other", async () => {
    const order: string[] = [];
    const slow = withStorageLock("a", async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      order.push("a");
    });
    const fast = withStorageLock("b", async () => {
      order.push("b");
    });

    await Promise.all([slow, fast]);

    expect(order).toEqual(["b", "a"]);
  });
});
