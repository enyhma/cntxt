import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeBrowser } from "wxt/testing/fake-browser";

const insert = vi.fn();
const select = vi.fn();
const deleteEq = vi.fn().mockResolvedValue({ error: null });
const del = vi.fn(() => ({ eq: deleteEq }));
const from = vi.fn(() => ({ select, insert, delete: del }));
vi.mock("./supabase", () => ({ supabase: { from } }));

const {
  addResource,
  deleteResource,
  getResources,
  pullRemoteResources,
  reconcileResourceSyncStatus,
} = await import("./resources");

beforeEach(() => {
  fakeBrowser.reset();
  insert.mockReset().mockResolvedValue({ error: null });
  select.mockReset();
  deleteEq.mockClear();
  del.mockClear();
  from.mockClear();
});

async function syncStatusOf(id: string) {
  const resources = await getResources();
  return resources.find((r) => r.id === id)?.syncStatus;
}

it("marks a resource synced once the insert succeeds", async () => {
  const resource = await addResource(
    { questId: "quest-1" },
    { url: "https://a.com" },
  );
  await vi.waitFor(async () =>
    expect(await syncStatusOf(resource.id)).toBe("synced"),
  );
});

it("falls back to offline on an unrecognized insert error", async () => {
  insert.mockResolvedValue({ error: { message: "network down" } });
  const resource = await addResource(
    { questId: "quest-1" },
    { note: "read later" },
  );
  await vi.waitFor(async () =>
    expect(await syncStatusOf(resource.id)).toBe("offline"),
  );
});

it("treats a unique-violation as already synced", async () => {
  insert.mockResolvedValue({
    error: { code: "23505", message: "duplicate key value" },
  });
  const resource = await addResource(
    { questId: "quest-1" },
    { url: "https://a.com" },
  );
  await vi.waitFor(async () =>
    expect(await syncStatusOf(resource.id)).toBe("synced"),
  );
});

it("reconcileResourceSyncStatus retries anything not already synced", async () => {
  insert.mockResolvedValueOnce({ error: { message: "network down" } });
  const resource = await addResource(
    { questId: "quest-1" },
    { url: "https://a.com" },
  );
  await vi.waitFor(async () =>
    expect(await syncStatusOf(resource.id)).toBe("offline"),
  );

  insert.mockResolvedValue({ error: null });
  await reconcileResourceSyncStatus();
  expect(await syncStatusOf(resource.id)).toBe("synced");
});

it("pullRemoteResources adds a remote resource missing locally", async () => {
  select.mockResolvedValue({
    data: [
      {
        id: "remote-1",
        quest_id: "quest-1",
        type: "link",
        url: "https://example.com",
        note: null,
        created_at: new Date(0).toISOString(),
      },
    ],
    error: null,
  });

  const applied = await pullRemoteResources();
  expect(applied).toBe(1);
  expect((await getResources()).map((r) => r.url)).toContain(
    "https://example.com",
  );
});

it("pullRemoteResources doesn't duplicate a resource already stored locally", async () => {
  const resource = await addResource(
    { questId: "quest-1" },
    { url: "https://a.com" },
  );
  select.mockResolvedValue({
    data: [
      {
        id: resource.id,
        quest_id: "quest-1",
        type: "link",
        url: "https://a.com",
        note: null,
        created_at: new Date(0).toISOString(),
      },
    ],
    error: null,
  });

  const applied = await pullRemoteResources();
  expect(applied).toBe(0);
  expect((await getResources()).length).toBe(1);
});

describe("deleteResource", () => {
  it("removes it locally and fires a remote delete", async () => {
    const resource = await addResource(
      { questId: "quest-1" },
      { url: "https://a.com" },
    );
    await deleteResource(resource.id);
    expect(await getResources()).toEqual([]);
    expect(deleteEq).toHaveBeenCalledWith("id", resource.id);
  });
});

describe("folder-parented resources (Sections)", () => {
  it("inserts with folder_id set and quest_id null", async () => {
    const resource = await addResource(
      { folderId: "section-1" },
      { url: "https://a.com" },
    );
    expect(resource.folderId).toBe("section-1");
    expect(resource.questId).toBeUndefined();
    await vi.waitFor(() =>
      expect(insert).toHaveBeenCalledWith(
        expect.objectContaining({ quest_id: null, folder_id: "section-1" }),
      ),
    );
  });

  it("pullRemoteResources maps a remote folder_id onto Resource.folderId", async () => {
    select.mockResolvedValue({
      data: [
        {
          id: "remote-1",
          quest_id: null,
          folder_id: "section-1",
          type: "link",
          url: "https://example.com",
          note: null,
          created_at: new Date(0).toISOString(),
        },
      ],
      error: null,
    });

    const applied = await pullRemoteResources();
    expect(applied).toBe(1);
    const [r] = await getResources();
    expect(r?.folderId).toBe("section-1");
    expect(r?.questId).toBeUndefined();
  });
});
