import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeBrowser } from "wxt/testing/fake-browser";

const rpc = vi.fn();
const select = vi.fn();
const single = vi.fn();
const eq = vi.fn(() => ({ select: vi.fn(() => ({ single })) }));
const update = vi.fn(() => ({ eq }));
const deleteEq = vi.fn().mockResolvedValue({ error: null });
const del = vi.fn(() => ({ eq: deleteEq }));
const from = vi.fn(() => ({ select, update, delete: del }));
vi.mock("./supabase", () => ({ supabase: { rpc, from } }));

const {
  createQuest,
  deleteQuest,
  getQuests,
  permanentlyDeleteQuest,
  pullRemoteQuests,
  purgeExpiredLocalTrash,
  pushDirtyQuests,
  restoreQuest,
  trashRetentionDays,
  updateQuest,
} = await import("./quests");

beforeEach(() => {
  fakeBrowser.reset();
  // Default to a successful registerQuest RPC — createQuest fires
  // this off without awaiting it, so any test that doesn't care about sync
  // status still needs it to resolve instead of leaving a dangling,
  // unhandled rejection. Tests asserting specific RPC error mapping
  // override this explicitly.
  rpc.mockReset().mockResolvedValue({ error: null });
  select.mockReset();
  single.mockReset();
  eq.mockClear();
  update.mockClear();
  deleteEq.mockClear();
  del.mockClear();
  from.mockClear();
});

async function syncStatusOf(id: string) {
  const quests = await getQuests();
  return quests.find((m) => m.id === id)?.syncStatus;
}

it("marks a quest synced once the RPC succeeds", async () => {
  rpc.mockResolvedValue({ error: null });
  const quest = await createQuest("A", []);
  await vi.waitFor(async () =>
    expect(await syncStatusOf(quest.id)).toBe("synced"),
  );
});

it("maps a 'workspace limit reached' RPC error to limit-reached", async () => {
  rpc.mockResolvedValue({ error: { message: "workspace limit reached" } });
  const quest = await createQuest("A", []);
  await vi.waitFor(async () =>
    expect(await syncStatusOf(quest.id)).toBe("limit-reached"),
  );
});

it("treats a unique-violation (already synced from an earlier call) as synced", async () => {
  rpc.mockResolvedValue({
    error: { code: "23505", message: "duplicate key value" },
  });
  const quest = await createQuest("A", []);
  await vi.waitFor(async () =>
    expect(await syncStatusOf(quest.id)).toBe("synced"),
  );
});

it("pullRemoteQuests adds a remote quest missing from local storage", async () => {
  select.mockResolvedValue({
    data: [
      {
        id: "remote-1",
        name: "From another device",
        tabs: [{ url: "https://a.test", title: "A" }],
        created_at: "2026-01-01T00:00:00Z",
        updated_at: "2026-01-02T00:00:00Z",
      },
    ],
    error: null,
  });
  expect(await pullRemoteQuests()).toBe(1);
  const quests = await getQuests();
  expect(quests).toEqual([
    {
      id: "remote-1",
      name: "From another device",
      tabs: [{ url: "https://a.test", title: "A" }],
      createdAt: Date.parse("2026-01-01T00:00:00Z"),
      updatedAt: Date.parse("2026-01-02T00:00:00Z"),
      syncStatus: "synced",
    },
  ]);
});

it("pullRemoteQuests keeps a local edit that is newer than the server's row", async () => {
  rpc.mockResolvedValue({ error: null });
  const local = await createQuest("Local edit", []);
  select.mockResolvedValue({
    data: [
      {
        id: local.id,
        name: "Stale server copy",
        tabs: [],
        created_at: "2026-01-01T00:00:00Z",
        updated_at: "2026-01-01T00:00:00Z",
      },
    ],
    error: null,
  });
  expect(await pullRemoteQuests()).toBe(0);
  const quests = await getQuests();
  expect(quests).toHaveLength(1);
  expect(quests[0]?.name).toBe("Local edit");
});

it("pullRemoteQuests overwrites a local copy that is older than the server's row", async () => {
  rpc.mockResolvedValue({ error: null });
  const local = await createQuest("Local edit", []);
  await updateQuest(local.id, { color: "accent" });
  select.mockResolvedValue({
    data: [
      {
        id: local.id,
        name: "Edited on another device",
        tabs: [{ url: "https://b.test", title: "B" }],
        created_at: "2026-01-01T00:00:00Z",
        updated_at: "2099-01-01T00:00:00Z",
      },
    ],
    error: null,
  });
  expect(await pullRemoteQuests()).toBe(1);
  const quests = await getQuests();
  expect(quests).toHaveLength(1);
  expect(quests[0]?.name).toBe("Edited on another device");
  // color/icon are dashboard-local picks with no server column — a remote
  // row overwriting the rest of the quest shouldn't erase those.
  expect(quests[0]?.color).toBe("accent");
});

it("pullRemoteQuests throws on a fetch error instead of silently returning 0", async () => {
  select.mockResolvedValue({ data: null, error: { message: "network" } });
  await expect(pullRemoteQuests()).rejects.toThrow("network");
  expect(await getQuests()).toEqual([]);
});

describe("pushDirtyQuests", () => {
  it("pushes a synced quest whose local edit is newer than lastPushedAt", async () => {
    rpc.mockResolvedValue({ error: null });
    const quest = await createQuest("A", []);
    await vi.waitFor(async () =>
      expect(await syncStatusOf(quest.id)).toBe("synced"),
    );
    await updateQuest(quest.id, { name: "Renamed" });

    single.mockResolvedValue({
      data: { updated_at: "2030-01-01T00:00:00Z" },
      error: null,
    });
    const lastPushedAt = await pushDirtyQuests({});

    expect(update).toHaveBeenCalledWith({
      name: "Renamed",
      tabs: [],
      deleted_at: null,
      folder_id: null,
      phases: [],
      active_phase_id: null,
    });
    expect(lastPushedAt[quest.id]).toBe(Date.parse("2030-01-01T00:00:00Z"));
    const quests = await getQuests();
    expect(quests[0]?.updatedAt).toBe(Date.parse("2030-01-01T00:00:00Z"));
  });

  it("skips a quest whose local updatedAt hasn't moved since lastPushedAt", async () => {
    rpc.mockResolvedValue({ error: null });
    const quest = await createQuest("A", []);
    await vi.waitFor(async () =>
      expect(await syncStatusOf(quest.id)).toBe("synced"),
    );

    await pushDirtyQuests({ [quest.id]: Date.now() + 1000 });
    expect(update).not.toHaveBeenCalled();
  });

  it("skips a quest that was never synced to the server", async () => {
    rpc.mockResolvedValue({ error: { message: "not authenticated" } });
    await createQuest("Local only", []);
    await vi.waitFor(async () => {
      const [m] = await getQuests();
      expect(m?.syncStatus).toBe("signed-out");
    });

    await pushDirtyQuests({});
    expect(update).not.toHaveBeenCalled();
  });

  it("throws on an update error, leaving already-pushed ids in the returned map", async () => {
    rpc.mockResolvedValue({ error: null });
    const quest = await createQuest("A", []);
    await vi.waitFor(async () =>
      expect(await syncStatusOf(quest.id)).toBe("synced"),
    );
    await updateQuest(quest.id, { name: "Renamed" });

    single.mockResolvedValue({ data: null, error: { message: "network" } });
    await expect(pushDirtyQuests({})).rejects.toThrow("network");
  });

  it("includes deleted_at in the update payload so trashing propagates", async () => {
    rpc.mockResolvedValue({ error: null });
    const quest = await createQuest("A", []);
    await vi.waitFor(async () =>
      expect(await syncStatusOf(quest.id)).toBe("synced"),
    );
    await deleteQuest(quest.id);

    single.mockResolvedValue({
      data: { updated_at: "2030-01-01T00:00:00Z" },
      error: null,
    });
    await pushDirtyQuests({});

    const [m] = await getQuests();
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        deleted_at: new Date(m!.deletedAt!).toISOString(),
      }),
    );
  });
});

describe("trashRetentionDays", () => {
  it("is 7 days with no access_expires_at (free tier)", () => {
    expect(trashRetentionDays(null)).toBe(7);
    expect(trashRetentionDays(undefined)).toBe(7);
  });

  it("is 7 days with a lapsed access_expires_at", () => {
    expect(trashRetentionDays("2020-01-01T00:00:00Z")).toBe(7);
  });

  it("is 30 days with a future access_expires_at (paid)", () => {
    expect(trashRetentionDays("2099-01-01T00:00:00Z")).toBe(30);
  });
});

describe("deleteQuest / restoreQuest", () => {
  it("deleteQuest sets deletedAt instead of removing the quest", async () => {
    const quest = await createQuest("A", []);
    await deleteQuest(quest.id);
    const quests = await getQuests();
    expect(quests).toHaveLength(1);
    expect(quests[0]?.deletedAt).toBeDefined();
  });

  it("restoreQuest clears deletedAt", async () => {
    const quest = await createQuest("A", []);
    await deleteQuest(quest.id);
    await restoreQuest(quest.id);
    const [m] = await getQuests();
    expect(m?.deletedAt).toBeUndefined();
  });
});

describe("permanentlyDeleteQuest", () => {
  it("removes the quest locally and issues a best-effort server delete", async () => {
    const quest = await createQuest("A", []);
    await permanentlyDeleteQuest(quest.id);
    expect(await getQuests()).toEqual([]);
    expect(del).toHaveBeenCalled();
    expect(deleteEq).toHaveBeenCalledWith("id", quest.id);
  });
});

describe("purgeExpiredLocalTrash", () => {
  it("removes a quest trashed past the free 7-day window", async () => {
    const quest = await createQuest("A", []);
    await deleteQuest(quest.id);
    const [m] = await getQuests();
    m!.deletedAt = Date.now() - 8 * 24 * 60 * 60 * 1000;
    await browser.storage.local.set({ workspaces: [m] });

    await purgeExpiredLocalTrash(null);
    expect(await getQuests()).toEqual([]);
  });

  it("keeps a quest trashed within the window", async () => {
    const quest = await createQuest("A", []);
    await deleteQuest(quest.id);

    await purgeExpiredLocalTrash(null);
    expect(await getQuests()).toHaveLength(1);
  });

  it("keeps a quest trashed 10 days ago for a paid account (30-day window)", async () => {
    const quest = await createQuest("A", []);
    await deleteQuest(quest.id);
    const [m] = await getQuests();
    m!.deletedAt = Date.now() - 10 * 24 * 60 * 60 * 1000;
    await browser.storage.local.set({ workspaces: [m] });

    await purgeExpiredLocalTrash("2099-01-01T00:00:00Z");
    expect(await getQuests()).toHaveLength(1);
  });

  it("never touches an active (non-trashed) quest", async () => {
    await createQuest("A", []);
    await purgeExpiredLocalTrash(null);
    expect(await getQuests()).toHaveLength(1);
  });
});
