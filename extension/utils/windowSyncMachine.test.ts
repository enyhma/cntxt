import { createActor } from "xstate";
import { beforeEach, describe, expect, it } from "vitest";
import { fakeBrowser } from "wxt/testing/fake-browser";
import { setWindowQuest } from "./session";
import { windowSyncMachine } from "./windowSyncMachine";
import { createQuest, getQuests, updateQuest } from "./quests";

beforeEach(() => {
  fakeBrowser.reset();
});

async function flushAsyncWork() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("windowSyncMachine", () => {
  it("does not touch storage while the window has no quest mapping", async () => {
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

  it("syncs the mapped quest's tabs on TABS_CHANGED", async () => {
    const win = (await browser.windows.create({ focused: true }))!;
    const quest = await createQuest("Tracked", []);
    await setWindowQuest(win.id!, quest.id);

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

  it("tags a newly-opened tab with the currently active phase", async () => {
    const win = (await browser.windows.create({ focused: true }))!;
    const quest = await createQuest("Roadmap", []);
    await updateQuest(quest.id, {
      phases: [{ id: "p1", name: "Research", status: "active" }],
      activePhaseId: "p1",
    });
    await setWindowQuest(win.id!, quest.id);

    const actor = createActor(windowSyncMachine, {
      input: { windowId: win.id! },
    }).start();
    await flushAsyncWork();

    await browser.tabs.create({ windowId: win.id, url: "https://a.example/" });
    actor.send({ type: "TABS_CHANGED" });
    await flushAsyncWork();

    const [updated] = (await getQuests()).filter((m) => m.id === quest.id);
    expect(updated?.tabs).toEqual([
      { url: "https://a.example/", title: "", phaseId: "p1" },
    ]);
  });

  it("keeps a tab's existing phaseId across a resync instead of re-tagging it", async () => {
    const win = (await browser.windows.create({ focused: true }))!;
    const quest = await createQuest("Roadmap", [
      { url: "https://a.example/", title: "A", phaseId: "p1" },
    ]);
    await updateQuest(quest.id, {
      phases: [
        { id: "p1", name: "Research", status: "done" },
        { id: "p2", name: "Draft", status: "active" },
      ],
      activePhaseId: "p2",
    });
    await setWindowQuest(win.id!, quest.id);
    await browser.tabs.create({ windowId: win.id, url: "https://a.example/" });

    const actor = createActor(windowSyncMachine, {
      input: { windowId: win.id! },
    }).start();
    await flushAsyncWork();
    actor.send({ type: "TABS_CHANGED" });
    await flushAsyncWork();

    const [updated] = (await getQuests()).filter((m) => m.id === quest.id);
    expect(updated?.tabs).toEqual([
      { url: "https://a.example/", title: "", phaseId: "p1" },
    ]);
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
