import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeBrowser } from "wxt/testing/fake-browser";

const rpc = vi.fn();
const select = vi.fn();
const single = vi.fn();
const eq = vi.fn(() => ({ select: vi.fn(() => ({ single })) }));
const update = vi.fn(() => ({ eq }));
const from = vi.fn(() => ({ select, update }));
vi.mock("./supabase", () => ({ supabase: { rpc, from } }));

const {
  createWorkspace,
  getWorkspaces,
  pullRemoteWorkspaces,
  pushDirtyWorkspaces,
  updateWorkspace,
} = await import("./workspaces");

beforeEach(() => {
  fakeBrowser.reset();
  rpc.mockReset();
  select.mockReset();
  single.mockReset();
  eq.mockClear();
  update.mockClear();
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

    expect(update).toHaveBeenCalledWith({ name: "Renamed", tabs: [] });
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
});
