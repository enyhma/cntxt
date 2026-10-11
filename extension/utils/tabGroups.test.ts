import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeBrowser } from "wxt/testing/fake-browser";
import {
  ensureLiveTabGroup,
  findOwnedGroupId,
  getTabGroupOwners,
  setTabGroupOwner,
} from "./tabGroups";

beforeEach(() => {
  fakeBrowser.reset();
});

// fakeBrowser@2.0.1 doesn't implement tabs.group/tabGroups.* at all (they're
// wired to throw MockNotImplementedError) — every test touching them stubs
// its own in-memory behavior here, unlike tabs.query/tabs.create which
// fakeBrowser already backs for free.
function stubGroupApis() {
  const group = vi.spyOn(browser.tabs, "group").mockResolvedValue(1 as never);
  const update = vi
    .spyOn(browser.tabGroups, "update")
    .mockResolvedValue(undefined as never);
  const get = vi.spyOn(browser.tabGroups, "get").mockResolvedValue({
    id: 1,
    windowId: 1,
    color: "blue",
    collapsed: false,
    shared: false,
  } as never);
  return { group, update, get };
}

describe("ensureLiveTabGroup", () => {
  it("does nothing when there are no tabIds", async () => {
    const { group } = stubGroupApis();
    await ensureLiveTabGroup(
      1,
      { table: "quests", id: "q1", name: "Quest" },
      [],
    );
    expect(group).not.toHaveBeenCalled();
  });

  it("does nothing when tabs.group isn't supported", async () => {
    const original = browser.tabs.group;
    // @ts-expect-error -- simulating an engine without grouping support
    delete browser.tabs.group;
    try {
      await expect(
        ensureLiveTabGroup(
          1,
          { table: "quests", id: "q1", name: "Quest" },
          [10],
        ),
      ).resolves.toBeUndefined();
    } finally {
      browser.tabs.group = original;
    }
  });

  it("creates a new group and claims ownership when none exists yet", async () => {
    const { group, update } = stubGroupApis();
    await ensureLiveTabGroup(
      1,
      { table: "quests", id: "q1", name: "My Quest", color: "accent" },
      [10, 11],
    );
    expect(group).toHaveBeenCalledWith({
      tabIds: [10, 11],
      createProperties: { windowId: 1 },
    });
    expect(update).toHaveBeenCalledWith(1, {
      title: "My Quest",
      color: "blue",
    });
    expect(await findOwnedGroupId({ table: "quests", id: "q1" })).toBe(1);
  });

  it("reuses an already-owned group id", async () => {
    const { group } = stubGroupApis();
    await setTabGroupOwner(7, { table: "quests", id: "q1" });
    await ensureLiveTabGroup(
      1,
      { table: "quests", id: "q1", name: "My Quest" },
      [10],
    );
    expect(group).toHaveBeenCalledWith({ tabIds: [10], groupId: 7 });
  });

  it("drops a stale owner and regroups when the owned group no longer exists", async () => {
    const { group } = stubGroupApis();
    vi.spyOn(browser.tabGroups, "get").mockRejectedValueOnce(
      new Error("no such group"),
    );
    await setTabGroupOwner(7, { table: "quests", id: "q1" });

    await ensureLiveTabGroup(
      1,
      { table: "quests", id: "q1", name: "My Quest" },
      [10],
    );

    expect(group).toHaveBeenCalledWith({
      tabIds: [10],
      createProperties: { windowId: 1 },
    });
    expect((await getTabGroupOwners())[7]).toBeUndefined();
  });

  it("skips tabGroups.update when that API isn't available", async () => {
    const { update } = stubGroupApis();
    const original = browser.tabGroups.update;
    // @ts-expect-error -- simulating a Firefox build lacking tabGroups.update
    delete browser.tabGroups.update;
    try {
      await ensureLiveTabGroup(
        1,
        { table: "quests", id: "q1", name: "My Quest" },
        [10],
      );
    } finally {
      browser.tabGroups.update = original;
    }
    expect(update).not.toHaveBeenCalled();
  });

  it("swallows a browser-API failure instead of throwing", async () => {
    vi.spyOn(browser.tabs, "group").mockRejectedValue(new Error("boom"));
    await expect(
      ensureLiveTabGroup(1, { table: "quests", id: "q1", name: "Quest" }, [10]),
    ).resolves.toBeUndefined();
  });
});
