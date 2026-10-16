import { beforeEach, describe, expect, it } from "vitest";
import { fakeBrowser } from "wxt/testing/fake-browser";
import {
  activateGroupInProject,
  advanceNextSibling,
  deactivateGroup,
} from "./groupActivation";
import { createFolder, getFolders, updateFolder } from "./folders";
import { createGroup, getGroups, updateGroup } from "./groups";

beforeEach(() => {
  fakeBrowser.reset();
});

async function groupById(id: string) {
  return (await getGroups()).find((g) => g.id === id)!;
}

async function openUrlsIn(windowId: number) {
  return (await browser.tabs.query({ windowId })).map((t) => t.url);
}

describe("activateGroupInProject", () => {
  it("opens the target's tabs, marks it active, and demotes the previously active sibling without closing its tabs", async () => {
    const win = (await browser.windows.create({ focused: true }))!;
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
    await browser.tabs.create({
      windowId: win.id,
      url: "https://active.example/",
    });

    await activateGroupInProject(win.id!, project, await groupById(pending.id));

    expect(await openUrlsIn(win.id!)).toEqual(
      expect.arrayContaining([
        "https://active.example/",
        "https://pending.example/",
      ]),
    );
    expect((await groupById(pending.id)).status).toBe("active");
    expect((await groupById(active.id)).status).toBe("pending");
    const updatedProject = (await getFolders()).find(
      (f) => f.id === project.id,
    );
    expect(updatedProject?.activeGroupId).toBe(pending.id);
  });

  it("is a no-op on storage with a null windowId (schedule-tick automation context)", async () => {
    const project = await createFolder("Project", null, "project");
    const group = await createGroup("Group", [
      { url: "https://a.example/", title: "" },
    ]);
    await updateGroup(group.id, { folderId: project.id, status: "pending" });

    await activateGroupInProject(null, project, await groupById(group.id));

    expect((await groupById(group.id)).status).toBe("active");
    const updatedProject = (await getFolders()).find(
      (f) => f.id === project.id,
    );
    expect(updatedProject?.activeGroupId).toBe(group.id);
  });
});

describe("deactivateGroup", () => {
  it("drops an active group back to pending and clears the project's activeGroupId", async () => {
    const project = await createFolder("Project", null, "project");
    const group = await createGroup("Group", []);
    await updateGroup(group.id, { folderId: project.id, status: "active" });
    await updateFolder(project.id, { activeGroupId: group.id });

    await deactivateGroup(await groupById(group.id), {
      ...project,
      activeGroupId: group.id,
    });

    expect((await groupById(group.id)).status).toBe("pending");
    const updatedProject = (await getFolders()).find(
      (f) => f.id === project.id,
    );
    expect(updatedProject?.activeGroupId).toBeUndefined();
  });

  it("leaves a done group untouched — closing its tabs is the normal outcome of Complete group, not a deactivation", async () => {
    const project = await createFolder("Project", null, "project");
    const group = await createGroup("Group", []);
    await updateGroup(group.id, { folderId: project.id, status: "done" });

    await deactivateGroup(await groupById(group.id), project);

    expect((await groupById(group.id)).status).toBe("done");
  });
});

describe("advanceNextSibling", () => {
  it("activates the next pending sibling by order", async () => {
    const win = (await browser.windows.create({ focused: true }))!;
    const project = await createFolder("Project", null, "project");
    const done = await createGroup("Done", []);
    await updateGroup(done.id, {
      folderId: project.id,
      status: "done",
      order: 0,
    });
    const next = await createGroup("Next", [
      { url: "https://next.example/", title: "" },
    ]);
    await updateGroup(next.id, {
      folderId: project.id,
      status: "pending",
      order: 1,
    });

    await advanceNextSibling(project, await groupById(done.id), win.id!);

    expect((await groupById(next.id)).status).toBe("active");
    const updatedProject = (await getFolders()).find(
      (f) => f.id === project.id,
    );
    expect(updatedProject?.activeGroupId).toBe(next.id);
  });

  it("clears the project's activeGroupId when no pending sibling is left", async () => {
    const project = await createFolder("Project", null, "project");
    const done = await createGroup("Done", []);
    await updateGroup(done.id, { folderId: project.id, status: "done" });

    await advanceNextSibling(project, await groupById(done.id), null);

    const updatedProject = (await getFolders()).find(
      (f) => f.id === project.id,
    );
    expect(updatedProject?.activeGroupId).toBeUndefined();
  });
});
