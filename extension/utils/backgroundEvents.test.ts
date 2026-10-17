import { beforeEach, describe, expect, it } from "vitest";
import { fakeBrowser } from "wxt/testing/fake-browser";
import {
  handleTabGroupRemoved,
  handleTabGroupUpdated,
  nameOrColorChanged,
  shouldResyncOnStorageChange,
} from "./backgroundEvents";
import { createFolder, getFolders } from "./folders";
import { createGroup, getGroups, updateGroup } from "./groups";
import { getTabGroupOwners, setTabGroupOwner } from "./tabGroups";

beforeEach(() => {
  fakeBrowser.reset();
});

async function groupById(id: string) {
  return (await getGroups()).find((g) => g.id === id)!;
}

async function projectById(id: string) {
  return (await getFolders()).find((f) => f.id === id)!;
}

// Matches tabGroups.test.ts's own shape for a mocked native TabGroup —
// fakeBrowser doesn't implement the tabGroups API, and the real calls
// inside activateGroupInProject/deactivateGroup are wrapped to swallow
// that, so only storage-level effects need asserting here.
function nativeGroup(overrides: {
  id: number;
  windowId?: number;
  title?: string;
  collapsed: boolean;
}) {
  return {
    windowId: 1,
    title: "",
    color: "blue",
    shared: false,
    ...overrides,
  } as never;
}

// observeCollapsed (utils/tabGroups.ts) is in-memory module state, not
// reset by fakeBrowser.reset() — every test below uses its own native
// group id so none of them observe a stale "last collapsed" value left
// behind by an earlier test.
let nextNativeId = 1;
function freshNativeId() {
  return nextNativeId++;
}

describe("handleTabGroupUpdated", () => {
  it("no-ops for a native group with no recorded owner", async () => {
    await expect(
      handleTabGroupUpdated(
        nativeGroup({ id: freshNativeId(), collapsed: false }),
      ),
    ).resolves.toBeUndefined();
  });

  it("syncs a changed native title back onto the Group's name", async () => {
    const nativeId = freshNativeId();
    const project = await createFolder("Project", null, "project");
    const group = await createGroup("Untitled group", [
      { url: "https://a.example/", title: "" },
    ]);
    await updateGroup(group.id, { folderId: project.id, status: "active" });
    await setTabGroupOwner(nativeId, { table: "groups", id: group.id });

    await handleTabGroupUpdated(
      nativeGroup({ id: nativeId, title: "Roadmap", collapsed: false }),
    );

    expect((await groupById(group.id)).name).toBe("Roadmap");
  });

  it("does not activate a pending group on a rename while it merely happens to already be expanded", async () => {
    // Regression: a group left expanded-but-not-"active" by whatever
    // created it (e.g. silent capture, or the dashboard's "create a group
    // in an open project") must not get activated by an unrelated update —
    // only a real collapsed->expanded transition should.
    const nativeId = freshNativeId();
    const project = await createFolder("Project", null, "project");
    const active = await createGroup("Active", [
      { url: "https://active.example/", title: "" },
    ]);
    await updateGroup(active.id, { folderId: project.id, status: "active" });
    const pending = await createGroup("Untitled group", [
      { url: "https://pending.example/", title: "" },
    ]);
    await updateGroup(pending.id, {
      folderId: project.id,
      status: "pending",
    });
    await setTabGroupOwner(nativeId, { table: "groups", id: pending.id });

    await handleTabGroupUpdated(
      nativeGroup({ id: nativeId, title: "Roadmap", collapsed: false }),
    );

    expect((await groupById(pending.id)).status).toBe("pending");
    expect((await groupById(active.id)).status).toBe("active");
    expect((await projectById(project.id)).activeGroupId).toBeUndefined();
  });

  it("activates a pending group on a genuine collapsed -> expanded transition", async () => {
    const nativeId = freshNativeId();
    const project = await createFolder("Project", null, "project");
    const active = await createGroup("Active", [
      { url: "https://active.example/", title: "" },
    ]);
    await updateGroup(active.id, { folderId: project.id, status: "active" });
    const pending = await createGroup("Pending", [
      { url: "https://pending.example/", title: "" },
    ]);
    await updateGroup(pending.id, {
      folderId: project.id,
      status: "pending",
    });
    await setTabGroupOwner(nativeId, { table: "groups", id: pending.id });

    // First observation establishes the "was collapsed" baseline...
    await handleTabGroupUpdated(nativeGroup({ id: nativeId, collapsed: true }));
    // ...then the actual expand transition activates it.
    await handleTabGroupUpdated(
      nativeGroup({ id: nativeId, collapsed: false }),
    );

    expect((await groupById(pending.id)).status).toBe("active");
    expect((await groupById(active.id)).status).toBe("pending");
    expect((await projectById(project.id)).activeGroupId).toBe(pending.id);
  });

  it("does not re-activate a group that's already active", async () => {
    const nativeId = freshNativeId();
    const project = await createFolder("Project", null, "project");
    const group = await createGroup("Active", [
      { url: "https://a.example/", title: "" },
    ]);
    await updateGroup(group.id, { folderId: project.id, status: "active" });
    await setTabGroupOwner(nativeId, { table: "groups", id: group.id });
    await handleTabGroupUpdated(nativeGroup({ id: nativeId, collapsed: true }));

    await handleTabGroupUpdated(
      nativeGroup({ id: nativeId, collapsed: false }),
    );

    expect((await groupById(group.id)).status).toBe("active");
  });
});

describe("handleTabGroupRemoved", () => {
  it("drops the owner mapping and deactivates an active group", async () => {
    const nativeId = freshNativeId();
    const project = await createFolder("Project", null, "project");
    const group = await createGroup("Group", []);
    await updateGroup(group.id, { folderId: project.id, status: "active" });
    await setTabGroupOwner(nativeId, { table: "groups", id: group.id });

    await handleTabGroupRemoved(
      nativeGroup({ id: nativeId, collapsed: false }),
    );

    expect((await getTabGroupOwners())[nativeId]).toBeUndefined();
    expect((await groupById(group.id)).status).toBe("pending");
    expect((await projectById(project.id)).activeGroupId).toBeUndefined();
  });

  it("still clears the owner mapping for a group with no recorded owner", async () => {
    await expect(
      handleTabGroupRemoved(
        nativeGroup({ id: freshNativeId(), collapsed: false }),
      ),
    ).resolves.toBeUndefined();
  });
});

describe("nameOrColorChanged", () => {
  it("is false when only unrelated fields (e.g. tabs/updatedAt) differ", () => {
    const oldList = [{ id: "1", name: "A", tabs: [] }];
    const newList = [{ id: "1", name: "A", tabs: [{ url: "x" }] }];
    expect(nameOrColorChanged(oldList, newList)).toBe(false);
  });

  it("is true when name changed", () => {
    expect(
      nameOrColorChanged([{ id: "1", name: "A" }], [{ id: "1", name: "B" }]),
    ).toBe(true);
  });

  it("is true when color changed", () => {
    expect(
      nameOrColorChanged(
        [{ id: "1", name: "A", color: "accent" }],
        [{ id: "1", name: "A", color: "danger" }],
      ),
    ).toBe(true);
  });

  it("is false with no old or new snapshot to compare", () => {
    expect(nameOrColorChanged(undefined, [{ id: "1", name: "A" }])).toBe(false);
  });
});

describe("shouldResyncOnStorageChange", () => {
  it("is false outside the local storage area", () => {
    expect(
      shouldResyncOnStorageChange(
        {
          groups: {
            oldValue: [{ id: "1", name: "A" }],
            newValue: [{ id: "1", name: "B" }],
          },
        } as never,
        "sync" as never,
      ),
    ).toBe(false);
  });

  it("is false for a routine tabs-only sync write — the loop this guards against", () => {
    expect(
      shouldResyncOnStorageChange(
        {
          groups: {
            oldValue: [{ id: "1", name: "A", tabs: [], updatedAt: 1 }],
            newValue: [
              { id: "1", name: "A", tabs: [{ url: "x" }], updatedAt: 2 },
            ],
          },
        } as never,
        "local" as never,
      ),
    ).toBe(false);
  });

  it("is true for a folders rename", () => {
    expect(
      shouldResyncOnStorageChange(
        {
          folders: {
            oldValue: [{ id: "1", name: "Old" }],
            newValue: [{ id: "1", name: "New" }],
          },
        } as never,
        "local" as never,
      ),
    ).toBe(true);
  });
});
