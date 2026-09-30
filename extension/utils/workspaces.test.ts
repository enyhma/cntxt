import { beforeEach, expect, it, vi } from "vitest";
import { fakeBrowser } from "wxt/testing/fake-browser";

const rpc = vi.fn();
vi.mock("./supabase", () => ({ supabase: { rpc } }));

const { createWorkspace, getWorkspaces } = await import("./workspaces");

beforeEach(() => {
  fakeBrowser.reset();
  rpc.mockReset();
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
