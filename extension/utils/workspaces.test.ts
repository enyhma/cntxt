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
  createWorkspace,
  deleteWorkspace,
  getWorkspaces,
  permanentlyDeleteWorkspace,
  pullRemoteWorkspaces,
  purgeExpiredLocalTrash,
  pushDirtyWorkspaces,
  restoreWorkspace,
  trashRetentionDays,
  updateWorkspace,
} = await import("./workspaces");

beforeEach(() => {
  fakeBrowser.reset();
  // Default to a successful registerWorkspace RPC — createWorkspace fires
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
  const workspaces = await getWorkspaces();
  return workspaces.find((w) => w.id === id)?.syncStatus;
}

it("marks a workspace synced once the RPC succeeds", async () => {
  rpc.mockResolvedValue({ error: null });
  const workspace = await createWorkspace("A", []);
  await vi.waitFor(async () =>
    expect(await syncStatusOf(workspace.id)).toBe("synced"),
  );
});

it("maps a 'workspace limit reached' RPC error to limit-reached", async () => {
  rpc.mockResolvedValue({ error: { message: "workspace limit reached" } });
  const workspace = await createWorkspace("A", []);
  await vi.waitFor(async () =>
    expect(await syncStatusOf(workspace.id)).toBe("limit-reached"),
  );
});

it("treats a unique-violation (already synced from an earlier call) as synced", async () => {
  rpc.mockResolvedValue({
    error: { code: "23505", message: "duplicate key value" },
  });
  const workspace = await createWorkspace("A", []);
  await vi.waitFor(async () =>
    expect(await syncStatusOf(workspace.id)).toBe("synced"),
  );
});

it("pullRemoteWorkspaces adds a remote workspace missing from local storage", async () => {
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
  expect(await pullRemoteWorkspaces()).toBe(1);
  const workspaces = await getWorkspaces();
  expect(workspaces).toEqual([
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

it("pullRemoteWorkspaces keeps a local edit that is newer than the server's row", async () => {
  rpc.mockResolvedValue({ error: null });
  const local = await createWorkspace("Local edit", []);
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
  expect(await pullRemoteWorkspaces()).toBe(0);
  const workspaces = await getWorkspaces();
  expect(workspaces).toHaveLength(1);
  expect(workspaces[0]?.name).toBe("Local edit");
});

it("pullRemoteWorkspaces overwrites a local copy that is older than the server's row", async () => {
  rpc.mockResolvedValue({ error: null });
  const local = await createWorkspace("Local edit", []);
  await updateWorkspace(local.id, { color: "accent" });
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
  expect(await pullRemoteWorkspaces()).toBe(1);
  const workspaces = await getWorkspaces();
  expect(workspaces).toHaveLength(1);
  expect(workspaces[0]?.name).toBe("Edited on another device");
  // color/icon are dashboard-local picks with no server column — a remote
  // row overwriting the rest of the workspace shouldn't erase those.
  expect(workspaces[0]?.color).toBe("accent");
});

it("pullRemoteWorkspaces throws on a fetch error instead of silently returning 0", async () => {
  select.mockResolvedValue({ data: null, error: { message: "network" } });
  await expect(pullRemoteWorkspaces()).rejects.toThrow("network");
  expect(await getWorkspaces()).toEqual([]);
});

describe("pushDirtyWorkspaces", () => {
  it("pushes a synced workspace whose local edit is newer than lastPushedAt", async () => {
    rpc.mockResolvedValue({ error: null });
    const workspace = await createWorkspace("A", []);
    await vi.waitFor(async () =>
      expect(await syncStatusOf(workspace.id)).toBe("synced"),
    );
    await updateWorkspace(workspace.id, { name: "Renamed" });

    single.mockResolvedValue({
      data: { updated_at: "2030-01-01T00:00:00Z" },
      error: null,
    });
    const lastPushedAt = await pushDirtyWorkspaces({});

    expect(update).toHaveBeenCalledWith({
      name: "Renamed",
      tabs: [],
      deleted_at: null,
    });
    expect(lastPushedAt[workspace.id]).toBe(Date.parse("2030-01-01T00:00:00Z"));
    const workspaces = await getWorkspaces();
    expect(workspaces[0]?.updatedAt).toBe(Date.parse("2030-01-01T00:00:00Z"));
  });

  it("skips a workspace whose local updatedAt hasn't moved since lastPushedAt", async () => {
    rpc.mockResolvedValue({ error: null });
    const workspace = await createWorkspace("A", []);
    await vi.waitFor(async () =>
      expect(await syncStatusOf(workspace.id)).toBe("synced"),
    );

    await pushDirtyWorkspaces({ [workspace.id]: Date.now() + 1000 });
    expect(update).not.toHaveBeenCalled();
  });

  it("skips a workspace that was never synced to the server", async () => {
    rpc.mockResolvedValue({ error: { message: "not authenticated" } });
    await createWorkspace("Local only", []);
    await vi.waitFor(async () => {
      const [w] = await getWorkspaces();
      expect(w?.syncStatus).toBe("signed-out");
    });

    await pushDirtyWorkspaces({});
    expect(update).not.toHaveBeenCalled();
  });

  it("throws on an update error, leaving already-pushed ids in the returned map", async () => {
    rpc.mockResolvedValue({ error: null });
    const workspace = await createWorkspace("A", []);
    await vi.waitFor(async () =>
      expect(await syncStatusOf(workspace.id)).toBe("synced"),
    );
    await updateWorkspace(workspace.id, { name: "Renamed" });

    single.mockResolvedValue({ data: null, error: { message: "network" } });
    await expect(pushDirtyWorkspaces({})).rejects.toThrow("network");
  });

  it("includes deleted_at in the update payload so trashing propagates", async () => {
    rpc.mockResolvedValue({ error: null });
    const workspace = await createWorkspace("A", []);
    await vi.waitFor(async () =>
      expect(await syncStatusOf(workspace.id)).toBe("synced"),
    );
    await deleteWorkspace(workspace.id);

    single.mockResolvedValue({
      data: { updated_at: "2030-01-01T00:00:00Z" },
      error: null,
    });
    await pushDirtyWorkspaces({});

    const [w] = await getWorkspaces();
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        deleted_at: new Date(w!.deletedAt!).toISOString(),
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

describe("deleteWorkspace / restoreWorkspace", () => {
  it("deleteWorkspace sets deletedAt instead of removing the workspace", async () => {
    const workspace = await createWorkspace("A", []);
    await deleteWorkspace(workspace.id);
    const workspaces = await getWorkspaces();
    expect(workspaces).toHaveLength(1);
    expect(workspaces[0]?.deletedAt).toBeDefined();
  });

  it("restoreWorkspace clears deletedAt", async () => {
    const workspace = await createWorkspace("A", []);
    await deleteWorkspace(workspace.id);
    await restoreWorkspace(workspace.id);
    const [w] = await getWorkspaces();
    expect(w?.deletedAt).toBeUndefined();
  });
});

describe("permanentlyDeleteWorkspace", () => {
  it("removes the workspace locally and issues a best-effort server delete", async () => {
    const workspace = await createWorkspace("A", []);
    await permanentlyDeleteWorkspace(workspace.id);
    expect(await getWorkspaces()).toEqual([]);
    expect(del).toHaveBeenCalled();
    expect(deleteEq).toHaveBeenCalledWith("id", workspace.id);
  });
});

describe("purgeExpiredLocalTrash", () => {
  it("removes a workspace trashed past the free 7-day window", async () => {
    const workspace = await createWorkspace("A", []);
    await deleteWorkspace(workspace.id);
    const [w] = await getWorkspaces();
    w!.deletedAt = Date.now() - 8 * 24 * 60 * 60 * 1000;
    await browser.storage.local.set({ workspaces: [w] });

    await purgeExpiredLocalTrash(null);
    expect(await getWorkspaces()).toEqual([]);
  });

  it("keeps a workspace trashed within the window", async () => {
    const workspace = await createWorkspace("A", []);
    await deleteWorkspace(workspace.id);

    await purgeExpiredLocalTrash(null);
    expect(await getWorkspaces()).toHaveLength(1);
  });

  it("keeps a workspace trashed 10 days ago for a paid account (30-day window)", async () => {
    const workspace = await createWorkspace("A", []);
    await deleteWorkspace(workspace.id);
    const [w] = await getWorkspaces();
    w!.deletedAt = Date.now() - 10 * 24 * 60 * 60 * 1000;
    await browser.storage.local.set({ workspaces: [w] });

    await purgeExpiredLocalTrash("2099-01-01T00:00:00Z");
    expect(await getWorkspaces()).toHaveLength(1);
  });

  it("never touches an active (non-trashed) workspace", async () => {
    await createWorkspace("A", []);
    await purgeExpiredLocalTrash(null);
    expect(await getWorkspaces()).toHaveLength(1);
  });
});
