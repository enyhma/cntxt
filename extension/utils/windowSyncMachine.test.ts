import { createActor } from "xstate";
import { beforeEach, describe, expect, it } from "vitest";
import { fakeBrowser } from "wxt/testing/fake-browser";
import { setWindowBinding } from "./session";
import { windowSyncMachine } from "./windowSyncMachine";
import { createQuest, getQuests } from "./quests";
import { createFolder, getFolders, updateFolder } from "./folders";

beforeEach(() => {
  fakeBrowser.reset();
});

async function flushAsyncWork() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("windowSyncMachine", () => {
  it("does not touch storage while the window has no binding", async () => {
    const win = (await browser.windows.create({ focused: true }))!;
    await browser.tabs.create({ windowId: win.id, url: "https://a.example/" });

    const quest = await createQuest("Untouched", []);

    const actor = createActor(windowSyncMachine, {
      input: { windowId: win.id! },
    }).start();
    await flushAsyncWork();

    actor.send({ type: "TABS_CHANGED" });
    await flushAsyncWork();

    const quests = await getQuests();
    expect(quests.find((m) => m.id === quest.id)?.tabs).toEqual([]);
  });

  it("syncs the bound quest's tabs on TABS_CHANGED", async () => {
    const win = (await browser.windows.create({ focused: true }))!;
    const quest = await createQuest("Tracked", []);
    await setWindowBinding(win.id!, { kind: "quest", questId: quest.id });

    const actor = createActor(windowSyncMachine, {
      input: { windowId: win.id! },
    }).start();
    await flushAsyncWork();

    await browser.tabs.create({ windowId: win.id, url: "https://a.example/" });
    actor.send({ type: "TABS_CHANGED" });
    await flushAsyncWork();

    const quests = await getQuests();
    const updated = quests.find((m) => m.id === quest.id);
    expect(updated?.tabs).toEqual([{ url: "https://a.example/", title: "" }]);
  });

  it("syncs a project-bound window with no active quest into the project's own tabs", async () => {
    const win = (await browser.windows.create({ focused: true }))!;
    const project = await createFolder("Untitled Project", null, "project");
    await setWindowBinding(win.id!, {
      kind: "project",
      projectId: project.id,
    });

    const actor = createActor(windowSyncMachine, {
      input: { windowId: win.id! },
    }).start();
    await flushAsyncWork();

    await browser.tabs.create({ windowId: win.id, url: "https://a.example/" });
    actor.send({ type: "TABS_CHANGED" });
    await flushAsyncWork();

    const updated = (await getFolders()).find((f) => f.id === project.id);
    expect(updated?.tabs).toEqual([{ url: "https://a.example/", title: "" }]);
    expect((await getQuests()).length).toBe(0);
  });

  it("syncs a project-bound window with an active quest into that quest's tabs", async () => {
    const win = (await browser.windows.create({ focused: true }))!;
    const project = await createFolder("Untitled Project", null, "project");
    const quest = await createQuest("Swapped in", []);
    await updateFolder(project.id, { activeQuestId: quest.id });
    await setWindowBinding(win.id!, {
      kind: "project",
      projectId: project.id,
    });

    const actor = createActor(windowSyncMachine, {
      input: { windowId: win.id! },
    }).start();
    await flushAsyncWork();

    await browser.tabs.create({ windowId: win.id, url: "https://a.example/" });
    actor.send({ type: "TABS_CHANGED" });
    await flushAsyncWork();

    const updatedQuest = (await getQuests()).find((q) => q.id === quest.id);
    expect(updatedQuest?.tabs).toEqual([
      { url: "https://a.example/", title: "" },
    ]);
    const updatedProject = (await getFolders()).find(
      (f) => f.id === project.id,
    );
    expect(updatedProject?.tabs).toEqual([]);
  });

  it("stops on WINDOW_CLOSED", async () => {
    const win = (await browser.windows.create({ focused: true }))!;
    const actor = createActor(windowSyncMachine, {
      input: { windowId: win.id! },
    }).start();

    actor.send({ type: "WINDOW_CLOSED" });

    expect(actor.getSnapshot().status).toBe("done");
  });
});
