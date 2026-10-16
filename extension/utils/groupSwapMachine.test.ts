import { createActor, waitFor } from "xstate";
import { beforeEach, describe, expect, it } from "vitest";
import { fakeBrowser } from "wxt/testing/fake-browser";
import { groupSwapMachine } from "./groupSwapMachine";
import { setWindowBinding } from "./session";
import { DASHBOARD_URL } from "./tabs";
import { createFolder, getFolders, updateFolder } from "./folders";
import { createGroup, getGroups, updateGroup } from "./groups";

beforeEach(() => {
  fakeBrowser.reset();
});

async function flushAsyncWork() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

async function openUrlsIn(windowId: number) {
  return (await browser.tabs.query({ windowId }))
    .map((t) => t.url)
    .filter((url) => url !== DASHBOARD_URL);
}

async function groupById(id: string) {
  return (await getGroups()).find((q) => q.id === id)!;
}

/**
 * A Project with three sibling groups (g1 active, g2 and g3 pending) and
 * every one of their own tabs already open in the window — mirrors what
 * restoreMachine's openBindingTabs does on connect: every live sibling's
 * tabs open at once, not just the active one's.
 */
async function setUpProjectWithSiblings() {
  const win = (await browser.windows.create({ focused: true }))!;
  await browser.tabs.create({ windowId: win.id, url: DASHBOARD_URL });

  const project = await createFolder("Benchmarking", null, "project");
  const g1 = await createGroup("Research", [
    { url: "https://research.example/", title: "Research" },
  ]);
  const g2 = await createGroup("Draft", [
    { url: "https://draft.example/", title: "Draft" },
  ]);
  const g3 = await createGroup("QA", [
    { url: "https://qa.example/", title: "QA" },
  ]);
  await updateGroup(g1.id, {
    folderId: project.id,
    status: "active",
    order: 0,
  });
  await updateGroup(g2.id, {
    folderId: project.id,
    status: "pending",
    order: 1,
  });
  await updateGroup(g3.id, {
    folderId: project.id,
    status: "pending",
    order: 2,
  });
  await updateFolder(project.id, { activeGroupId: g1.id });
  await setWindowBinding(win.id!, { kind: "project", projectId: project.id });

  await browser.tabs.create({
    windowId: win.id,
    url: "https://research.example/",
  });
  await browser.tabs.create({
    windowId: win.id,
    url: "https://draft.example/",
  });
  await browser.tabs.create({ windowId: win.id, url: "https://qa.example/" });

  const freshProject = (await getFolders()).find((f) => f.id === project.id)!;
  return {
    windowId: win.id!,
    project: freshProject,
    g1: await groupById(g1.id),
    g2: await groupById(g2.id),
    g3: await groupById(g3.id),
  };
}

describe("groupSwapMachine", () => {
  it("ACTIVATE_GROUP activates the target group without closing any sibling's tabs", async () => {
    const { windowId, project, g1, g2 } = await setUpProjectWithSiblings();

    const actor = createActor(groupSwapMachine).start();
    actor.send({ type: "ACTIVATE_GROUP", project, group: g2 });
    await waitFor(actor, (state) => state.matches("idle"));
    await flushAsyncWork();

    expect(await openUrlsIn(windowId)).toEqual([
      "https://research.example/",
      "https://draft.example/",
      "https://qa.example/",
    ]);

    const updatedProject = (await getFolders()).find(
      (f) => f.id === project.id,
    );
    expect(updatedProject?.activeGroupId).toBe(g2.id);
    expect((await groupById(g2.id)).status).toBe("active");
    expect((await groupById(g1.id)).status).toBe("pending");
  });

  it("COMPLETE_GROUP closes only its own tabs (keeping the record) and auto-advances to the next pending sibling by order", async () => {
    const { windowId, project, g1, g2 } = await setUpProjectWithSiblings();

    const actor = createActor(groupSwapMachine).start();
    actor.send({ type: "COMPLETE_GROUP", project, group: g1 });
    await waitFor(actor, (state) => state.matches("idle"));
    await flushAsyncWork();

    expect(await openUrlsIn(windowId)).toEqual([
      "https://draft.example/",
      "https://qa.example/",
    ]);

    const completed = await groupById(g1.id);
    expect(completed.status).toBe("done");
    expect(completed.tabs).toEqual(g1.tabs);

    const advanced = await groupById(g2.id);
    expect(advanced.status).toBe("active");
    const updatedProject = (await getFolders()).find(
      (f) => f.id === project.id,
    );
    expect(updatedProject?.activeGroupId).toBe(g2.id);
  });

  it("COMPLETE_GROUP with no pending siblings left clears the project's activeGroupId", async () => {
    const { windowId, project, g1, g2, g3 } = await setUpProjectWithSiblings();
    await updateGroup(g2.id, { status: "done" });
    await updateGroup(g3.id, { status: "done" });

    const actor = createActor(groupSwapMachine).start();
    actor.send({ type: "COMPLETE_GROUP", project, group: g1 });
    await waitFor(actor, (state) => state.matches("idle"));
    await flushAsyncWork();

    expect(await openUrlsIn(windowId)).not.toContain(
      "https://research.example/",
    );
    const updatedProject = (await getFolders()).find(
      (f) => f.id === project.id,
    );
    expect(updatedProject?.activeGroupId).toBeUndefined();
  });

  it("ACTIVATE_GROUP reopens a done group's tabs if they aren't already open", async () => {
    const { windowId, project, g1, g2 } = await setUpProjectWithSiblings();
    await updateGroup(g2.id, { status: "done" });
    // Simulate the normal outcome of a prior Complete group — its tabs are
    // actually closed, unlike setup's blanket "everything open".
    const draftTab = (await browser.tabs.query({ windowId })).find(
      (t) => t.url === "https://draft.example/",
    );
    await browser.tabs.remove(draftTab!.id!);
    const doneGroup = await groupById(g2.id);

    const actor = createActor(groupSwapMachine).start();
    actor.send({ type: "ACTIVATE_GROUP", project, group: doneGroup });
    await waitFor(actor, (state) => state.matches("idle"));
    await flushAsyncWork();

    expect(await openUrlsIn(windowId)).toContain("https://draft.example/");
    expect((await groupById(g2.id)).status).toBe("active");
    expect((await groupById(g1.id)).status).toBe("pending");
  });
});
