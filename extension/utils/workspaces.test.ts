import { beforeEach, expect, it, vi } from "vitest";
import { fakeBrowser } from "wxt/testing/fake-browser";

const rpc = vi.fn();
const select = vi.fn();
const from = vi.fn(() => ({ select }));
vi.mock("./supabase", () => ({ supabase: { rpc, from } }));

const { createWorkspace, getWorkspaces, pullRemoteWorkspaces } =
  await import("./workspaces");

beforeEach(() => {
  fakeBrowser.reset();
  rpc.mockReset();
  select.mockReset();
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

it("pullRemoteWorkspaces never overwrites a workspace that already exists locally", async () => {
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

it("pullRemoteWorkspaces throws on a fetch error instead of silently returning 0", async () => {
  select.mockResolvedValue({ data: null, error: { message: "network" } });
  await expect(pullRemoteWorkspaces()).rejects.toThrow("network");
  expect(await getWorkspaces()).toEqual([]);
});
