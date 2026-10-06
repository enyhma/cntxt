import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeBrowser } from "wxt/testing/fake-browser";

const insert = vi.fn();
const select = vi.fn();
const single = vi.fn();
const eq = vi.fn(() => ({ select: vi.fn(() => ({ single })) }));
const update = vi.fn(() => ({ eq }));
const deleteEq = vi.fn().mockResolvedValue({ error: null });
const del = vi.fn(() => ({ eq: deleteEq }));
const from = vi.fn(() => ({ select, insert, update, delete: del }));
// createWorkspace (used by the deleteFolder test below) fires off
// registerWorkspace's RPC call without awaiting it — needs a resolved stub
// or that unawaited call rejects with "rpc is not a function".
const rpc = vi.fn().mockResolvedValue({ error: null });
vi.mock("./supabase", () => ({ supabase: { from, rpc } }));

const {
  createFolder,
  deleteFolder,
  getFolders,
  pullRemoteFolders,
  pushDirtyFolders,
  updateFolder,
} = await import("./folders");
const { createWorkspace, getWorkspaces, updateWorkspace } =
  await import("./workspaces");

beforeEach(() => {
  fakeBrowser.reset();
  insert.mockReset().mockResolvedValue({ error: null });
  select.mockReset();
  single.mockReset();
  eq.mockClear();
  update.mockClear();
  deleteEq.mockClear();
  del.mockClear();
  from.mockClear();
});

async function syncStatusOf(id: string) {
  const folders = await getFolders();
  return folders.find((f) => f.id === id)?.syncStatus;
}

it("marks a folder synced once the insert succeeds", async () => {
  const folder = await createFolder("Engineering");
  await vi.waitFor(async () =>
    expect(await syncStatusOf(folder.id)).toBe("synced"),
  );
});

it("falls back to offline on an unrecognized insert error", async () => {
  insert.mockResolvedValue({ error: { message: "network down" } });
  const folder = await createFolder("Engineering");
  await vi.waitFor(async () =>
    expect(await syncStatusOf(folder.id)).toBe("offline"),
  );
});

it("pullRemoteFolders adds a remote folder missing locally", async () => {
  select.mockResolvedValue({
    data: [
      {
        id: "remote-1",
        name: "Marketing",
        parent_id: null,
        color: null,
        created_at: new Date(0).toISOString(),
        updated_at: new Date(0).toISOString(),
      },
    ],
    error: null,
  });

  const applied = await pullRemoteFolders();
  expect(applied).toBe(1);
  expect((await getFolders()).map((f) => f.name)).toContain("Marketing");
});

it("pushDirtyFolders pushes a locally-renamed, already-synced folder", async () => {
  const folder = await createFolder("Engineering");
  await vi.waitFor(async () =>
    expect(await syncStatusOf(folder.id)).toBe("synced"),
  );
  await updateFolder(folder.id, { name: "Platform" });

  single.mockResolvedValue({
    data: { updated_at: new Date().toISOString() },
    error: null,
  });

  await pushDirtyFolders({});
  expect(update).toHaveBeenCalledWith(
    expect.objectContaining({ name: "Platform" }),
  );
});

describe("deleteFolder", () => {
  it("cascades to child folders and ungroups workspaces pointing at either", async () => {
    const area = await createFolder("Engineering");
    const project = await createFolder("App Redesign", area.id);
    const workspace = await createWorkspace("Research", []);
    await updateWorkspace(workspace.id, { folderId: project.id });

    await deleteFolder(area.id);

    const folderIds = (await getFolders()).map((f) => f.id);
    expect(folderIds).not.toContain(area.id);
    expect(folderIds).not.toContain(project.id);

    const updated = (await getWorkspaces()).find((w) => w.id === workspace.id);
    expect(updated?.folderId).toBeNull();
  });
});
