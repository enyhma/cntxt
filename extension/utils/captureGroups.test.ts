import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeBrowser } from "wxt/testing/fake-browser";
import { runCaptureCheck } from "./captureGroups";
import { setWindowBinding } from "./session";
import { createFolder, getFolders, updateFolder } from "./folders";
import { getGroups } from "./groups";
import { addTabGroupRule } from "./tabGroupRules";
import { setTabGroupOwner } from "./tabGroups";

beforeEach(() => {
  fakeBrowser.reset();
});

function stubGroup(group: { title?: string; color: string }, tabs: unknown[]) {
  vi.spyOn(browser.tabGroups, "get").mockResolvedValue(group as never);
  vi.spyOn(browser.tabs, "query").mockResolvedValue(tabs as never);
}

describe("runCaptureCheck", () => {
  it("does nothing for a window with no binding", async () => {
    const win = (await browser.windows.create({ focused: true }))!;
    stubGroup({ title: "New group", color: "blue" }, [
      { id: 1, url: "https://a.example/", title: "A" },
    ]);
    await runCaptureCheck(win.id!, 5);
    expect(await getGroups()).toEqual([]);
  });

  it("does nothing for a group-bound window", async () => {
    const win = (await browser.windows.create({ focused: true }))!;
    await setWindowBinding(win.id!, { kind: "group", groupId: "q1" });
    stubGroup({ title: "New group", color: "blue" }, [
      { id: 1, url: "https://a.example/", title: "A" },
    ]);
    await runCaptureCheck(win.id!, 5);
    expect(await getGroups()).toEqual([]);
  });

  it("does nothing when the groupId is already owned", async () => {
    const win = (await browser.windows.create({ focused: true }))!;
    const project = await createFolder("Project", null, "project");
    await setWindowBinding(win.id!, {
      kind: "project",
      projectId: project.id,
    });
    await setTabGroupOwner(5, { table: "groups", id: "existing" });
    stubGroup({ title: "New group", color: "blue" }, [
      { id: 1, url: "https://a.example/", title: "A" },
    ]);
    await runCaptureCheck(win.id!, 5);
    expect(await getGroups()).toEqual([]);
  });

  it("creates a group nested under the window's project and activates it when none is active", async () => {
    const win = (await browser.windows.create({ focused: true }))!;
    const project = await createFolder("Project", null, "project");
    await setWindowBinding(win.id!, {
      kind: "project",
      projectId: project.id,
    });
    stubGroup({ title: "Invoices", color: "blue" }, [
      { id: 1, url: "https://a.example/", title: "A" },
      { id: 2, url: "https://b.example/", title: "B" },
    ]);

    await runCaptureCheck(win.id!, 5);

    const groups = await getGroups();
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({
      name: "Invoices",
      folderId: project.id,
      status: "active",
      tabs: [
        { url: "https://a.example/", title: "A" },
        { url: "https://b.example/", title: "B" },
      ],
    });
    const updatedProject = (await getFolders()).find(
      (f) => f.id === project.id,
    );
    expect(updatedProject?.activeGroupId).toBe(groups[0]!.id);
  });

  it("leaves the group pending and doesn't touch an already-active sibling", async () => {
    const win = (await browser.windows.create({ focused: true }))!;
    const project = await createFolder("Project", null, "project");
    await updateFolder(project.id, { activeGroupId: "already-active" });
    await setWindowBinding(win.id!, {
      kind: "project",
      projectId: project.id,
    });
    stubGroup({ title: "Side task", color: "grey" }, [
      { id: 1, url: "https://a.example/", title: "A" },
    ]);

    await runCaptureCheck(win.id!, 5);

    const groups = await getGroups();
    expect(groups).toHaveLength(1);
    // createGroup never sets status explicitly — undefined here means
    // "left pending" (same as every other untouched group in this
    // codebase), not that something was skipped.
    expect(groups[0]?.status).toBeUndefined();
    const updatedProject = (await getFolders()).find(
      (f) => f.id === project.id,
    );
    expect(updatedProject?.activeGroupId).toBe("already-active");
  });

  it("routes to a matching rule's folder instead of the window's own project", async () => {
    const win = (await browser.windows.create({ focused: true }))!;
    const project = await createFolder("Project", null, "project");
    const otherProject = await createFolder("Finance", null, "project");
    await setWindowBinding(win.id!, {
      kind: "project",
      projectId: project.id,
    });
    await addTabGroupRule({
      matchTitle: "Invoices",
      folderId: otherProject.id,
    });
    stubGroup({ title: "Invoices", color: "blue" }, [
      { id: 1, url: "https://a.example/", title: "A" },
    ]);

    await runCaptureCheck(win.id!, 5);

    const groups = await getGroups();
    expect(groups[0]?.folderId).toBe(otherProject.id);
  });

  it("falls back to the window's project when the matched rule's folder no longer exists", async () => {
    const win = (await browser.windows.create({ focused: true }))!;
    const project = await createFolder("Project", null, "project");
    await setWindowBinding(win.id!, {
      kind: "project",
      projectId: project.id,
    });
    await addTabGroupRule({
      matchTitle: "Invoices",
      folderId: "deleted-folder",
    });
    stubGroup({ title: "Invoices", color: "blue" }, [
      { id: 1, url: "https://a.example/", title: "A" },
    ]);

    await runCaptureCheck(win.id!, 5);

    const groups = await getGroups();
    expect(groups[0]?.folderId).toBe(project.id);
  });

  it("does nothing when the group has no member tabs", async () => {
    const win = (await browser.windows.create({ focused: true }))!;
    const project = await createFolder("Project", null, "project");
    await setWindowBinding(win.id!, {
      kind: "project",
      projectId: project.id,
    });
    stubGroup({ title: "Empty", color: "blue" }, []);

    await runCaptureCheck(win.id!, 5);

    expect(await getGroups()).toEqual([]);
  });
});
