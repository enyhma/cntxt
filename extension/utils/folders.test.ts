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
// createQuest (used by the deleteFolder test below) fires off
// registerQuest's RPC call without awaiting it — needs a resolved stub
// or that unawaited call rejects with "rpc is not a function".
const rpc = vi.fn().mockResolvedValue({ error: null });
vi.mock("./supabase", () => ({ supabase: { from, rpc } }));

const {
  archiveFolder,
  createFolder,
  deleteFolder,
  getFolders,
  pullRemoteFolders,
  pushDirtyFolders,
  unarchiveFolder,
  updateFolder,
} = await import("./folders");
const { createQuest, getQuests, updateQuest } = await import("./quests");

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
  const folder = await createFolder("Engineering", null, "area");
  await vi.waitFor(async () =>
    expect(await syncStatusOf(folder.id)).toBe("synced"),
  );
});

it("falls back to offline on an unrecognized insert error", async () => {
  insert.mockResolvedValue({ error: { message: "network down" } });
  const folder = await createFolder("Engineering", null, "area");
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
        kind: "area",
        color: null,
        created_at: new Date(0).toISOString(),
        updated_at: new Date(0).toISOString(),
        tabs: [],
        active_quest_id: null,
      },
    ],
    error: null,
  });

  const applied = await pullRemoteFolders();
  expect(applied).toBe(1);
  expect((await getFolders()).map((f) => f.name)).toContain("Marketing");
});

it("pullRemoteFolders round-trips a Project's kind, tabs, and active_quest_id", async () => {
  select.mockResolvedValue({
    data: [
      {
        id: "remote-project-1",
        name: "App Redesign",
        parent_id: null,
        kind: "project",
        color: null,
        created_at: new Date(0).toISOString(),
        updated_at: new Date(0).toISOString(),
        tabs: [{ url: "https://a.com", title: "A" }],
        active_quest_id: "quest-9",
      },
    ],
    error: null,
  });

  await pullRemoteFolders();
  const project = (await getFolders()).find((f) => f.id === "remote-project-1");
  expect(project?.kind).toBe("project");
  expect(project?.tabs).toEqual([{ url: "https://a.com", title: "A" }]);
  expect(project?.activeQuestId).toBe("quest-9");
});

it("pushDirtyFolders pushes a locally-renamed, already-synced folder", async () => {
  const folder = await createFolder("Engineering", null, "area");
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

it("pushDirtyFolders includes a Project's tabs and active_quest_id", async () => {
  const folder = await createFolder("App Redesign", null, "project");
  await vi.waitFor(async () =>
    expect(await syncStatusOf(folder.id)).toBe("synced"),
  );
  await updateFolder(folder.id, {
    tabs: [{ url: "https://a.com", title: "A" }],
    activeQuestId: "quest-9",
  });

  single.mockResolvedValue({
    data: { updated_at: new Date().toISOString() },
    error: null,
  });

  await pushDirtyFolders({});
  expect(update).toHaveBeenCalledWith(
    expect.objectContaining({
      tabs: [{ url: "https://a.com", title: "A" }],
      active_quest_id: "quest-9",
    }),
  );
});

describe("createFolder with kind: 'project'", () => {
  it("calls create_project instead of a plain insert", async () => {
    rpc.mockResolvedValue({ error: null });
    const folder = await createFolder("App Redesign", "area-1", "project");
    await vi.waitFor(async () =>
      expect(await syncStatusOf(folder.id)).toBe("synced"),
    );
    expect(rpc).toHaveBeenCalledWith(
      "create_project",
      expect.objectContaining({
        p_name: "App Redesign",
        p_parent_id: "area-1",
        p_id: folder.id,
      }),
    );
    expect(insert).not.toHaveBeenCalled();
  });

  it("maps a workspace-limit-reached RPC error to limit-reached", async () => {
    rpc.mockResolvedValue({ error: { message: "workspace limit reached" } });
    const folder = await createFolder("App Redesign", null, "project");
    await vi.waitFor(async () =>
      expect(await syncStatusOf(folder.id)).toBe("limit-reached"),
    );
  });
});

describe("deleteFolder", () => {
  it("cascades to child folders and ungroups quests pointing at either", async () => {
    const area = await createFolder("Engineering", null, "area");
    const project = await createFolder("App Redesign", area.id, "project");
    const quest = await createQuest("Research", []);
    await updateQuest(quest.id, { folderId: project.id });

    await deleteFolder(area.id);

    const folderIds = (await getFolders()).map((f) => f.id);
    expect(folderIds).not.toContain(area.id);
    expect(folderIds).not.toContain(project.id);

    const updated = (await getQuests()).find((m) => m.id === quest.id);
    expect(updated?.folderId).toBeNull();
  });
});

describe("archiveFolder", () => {
  it("archiving a project cascades to archive its child quests", async () => {
    const project = await createFolder("App Redesign", null, "project");
    const quest = await createQuest("Research", []);
    await updateQuest(quest.id, { folderId: project.id });

    await archiveFolder(project.id);

    const updatedProject = (await getFolders()).find(
      (f) => f.id === project.id,
    );
    expect(updatedProject?.archivedAt).toBeGreaterThan(0);
    const updatedQuest = (await getQuests()).find((q) => q.id === quest.id);
    expect(updatedQuest?.archivedAt).toBeGreaterThan(0);
  });

  it("archiving an area does not cascade to its child projects", async () => {
    const area = await createFolder("Engineering", null, "area");
    const project = await createFolder("App Redesign", area.id, "project");

    await archiveFolder(area.id);

    const updatedArea = (await getFolders()).find((f) => f.id === area.id);
    expect(updatedArea?.archivedAt).toBeGreaterThan(0);
    const updatedProject = (await getFolders()).find(
      (f) => f.id === project.id,
    );
    expect(updatedProject?.archivedAt).toBeUndefined();
  });

  it("unarchiveFolder does not cascade back to child quests", async () => {
    const project = await createFolder("App Redesign", null, "project");
    const quest = await createQuest("Research", []);
    await updateQuest(quest.id, { folderId: project.id });
    await archiveFolder(project.id);

    await unarchiveFolder(project.id);

    const updatedProject = (await getFolders()).find(
      (f) => f.id === project.id,
    );
    expect(updatedProject?.archivedAt).toBeUndefined();
    const updatedQuest = (await getQuests()).find((q) => q.id === quest.id);
    expect(updatedQuest?.archivedAt).toBeGreaterThan(0);
  });
});
