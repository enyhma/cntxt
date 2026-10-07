import { createActor, waitFor } from "xstate";
import { beforeEach, describe, expect, it } from "vitest";
import { fakeBrowser } from "wxt/testing/fake-browser";
import { questSwapMachine } from "./questSwapMachine";
import { setWindowBinding } from "./session";
import { DASHBOARD_URL } from "./tabs";
import { createFolder, getFolders, updateFolder } from "./folders";
import { createQuest, getQuests, updateQuest } from "./quests";

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

async function questById(id: string) {
  return (await getQuests()).find((q) => q.id === id)!;
}

/**
 * A Project with three sibling quests (q1 active & open in the window, q2
 * and q3 pending) — mirrors "only the active sibling's tabs are open right
 * now".
 */
async function setUpProjectWithSiblings() {
  const win = (await browser.windows.create({ focused: true }))!;
  await browser.tabs.create({ windowId: win.id, url: DASHBOARD_URL });

  const project = await createFolder("Benchmarking", null, "project");
  const q1 = await createQuest("Research", [
    { url: "https://research.example/", title: "Research" },
  ]);
  const q2 = await createQuest("Draft", [
    { url: "https://draft.example/", title: "Draft" },
  ]);
  const q3 = await createQuest("QA", [
    { url: "https://qa.example/", title: "QA" },
  ]);
  await updateQuest(q1.id, {
    folderId: project.id,
    status: "active",
    order: 0,
  });
  await updateQuest(q2.id, {
    folderId: project.id,
    status: "pending",
    order: 1,
  });
  await updateQuest(q3.id, {
    folderId: project.id,
    status: "pending",
    order: 2,
  });
  await updateFolder(project.id, { activeQuestId: q1.id });
  await setWindowBinding(win.id!, { kind: "project", projectId: project.id });

  await browser.tabs.create({
    windowId: win.id,
    url: "https://research.example/",
  });

  const freshProject = (await getFolders()).find((f) => f.id === project.id)!;
  return {
    windowId: win.id!,
    project: freshProject,
    q1: await questById(q1.id),
    q2: await questById(q2.id),
    q3: await questById(q3.id),
  };
}

describe("questSwapMachine", () => {
  it("ACTIVATE_QUEST closes everything open and swaps to the target quest's own tabs", async () => {
    const { windowId, project, q1, q2 } = await setUpProjectWithSiblings();

    const actor = createActor(questSwapMachine).start();
    actor.send({ type: "ACTIVATE_QUEST", project, quest: q2 });
    await waitFor(actor, (state) => state.matches("idle"));
    await flushAsyncWork();

    expect(await openUrlsIn(windowId)).toEqual(["https://draft.example/"]);

    const updatedProject = (await getFolders()).find(
      (f) => f.id === project.id,
    );
    expect(updatedProject?.activeQuestId).toBe(q2.id);
    expect((await questById(q2.id)).status).toBe("active");
    expect((await questById(q1.id)).status).toBe("pending");
  });

  it("COMPLETE_QUEST closes its tabs (keeping the record) and auto-advances to the next pending sibling by order", async () => {
    const { windowId, project, q1, q2 } = await setUpProjectWithSiblings();

    const actor = createActor(questSwapMachine).start();
    actor.send({ type: "COMPLETE_QUEST", project, quest: q1 });
    await waitFor(actor, (state) => state.matches("idle"));
    await flushAsyncWork();

    expect(await openUrlsIn(windowId)).toEqual(["https://draft.example/"]);

    const completed = await questById(q1.id);
    expect(completed.status).toBe("done");
    expect(completed.tabs).toEqual(q1.tabs);

    const advanced = await questById(q2.id);
    expect(advanced.status).toBe("active");
    const updatedProject = (await getFolders()).find(
      (f) => f.id === project.id,
    );
    expect(updatedProject?.activeQuestId).toBe(q2.id);
  });

  it("COMPLETE_QUEST with no pending siblings left clears the project's activeQuestId", async () => {
    const { windowId, project, q1, q2, q3 } = await setUpProjectWithSiblings();
    await updateQuest(q2.id, { status: "done" });
    await updateQuest(q3.id, { status: "done" });

    const actor = createActor(questSwapMachine).start();
    actor.send({ type: "COMPLETE_QUEST", project, quest: q1 });
    await waitFor(actor, (state) => state.matches("idle"));
    await flushAsyncWork();

    expect(await openUrlsIn(windowId)).toEqual([]);
    const updatedProject = (await getFolders()).find(
      (f) => f.id === project.id,
    );
    expect(updatedProject?.activeQuestId).toBeUndefined();
  });

  it("ACTIVATE_QUEST reopens a done quest the same way as a pending one", async () => {
    const { windowId, project, q1, q2 } = await setUpProjectWithSiblings();
    await updateQuest(q2.id, { status: "done" });
    const doneQuest = await questById(q2.id);

    const actor = createActor(questSwapMachine).start();
    actor.send({ type: "ACTIVATE_QUEST", project, quest: doneQuest });
    await waitFor(actor, (state) => state.matches("idle"));
    await flushAsyncWork();

    expect(await openUrlsIn(windowId)).toEqual(["https://draft.example/"]);
    expect((await questById(q2.id)).status).toBe("active");
    expect((await questById(q1.id)).status).toBe("pending");
  });
});
