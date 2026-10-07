import { createActor, waitFor } from "xstate";
import { beforeEach, describe, expect, it } from "vitest";
import { fakeBrowser } from "wxt/testing/fake-browser";
import { restoreMachine } from "./restoreMachine";
import { getWindowBindingMap, setWindowBinding } from "./session";
import { DASHBOARD_URL } from "./tabs";
import { createQuest, getQuests } from "./quests";
import { createFolder } from "./folders";
import { windowSyncMachine } from "./windowSyncMachine";

beforeEach(() => {
  fakeBrowser.reset();
});

async function flushAsyncWork() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * Also spawns the real per-window actor from windowSyncMachine and
 * wires it to tabs.onCreated/onRemoved, the same as background.ts does.
 * Without this, closing tabs during Restore wouldn't reproduce the bug this
 * suite guards against: the corruption only happens because something is
 * live-syncing tab changes back onto whichever target the window was
 * bound to at the moment the tabs closed.
 */
async function setUpWindowWithQuest() {
  const win = (await browser.windows.create({ focused: true }))!;
  await browser.tabs.create({ windowId: win.id, url: DASHBOARD_URL });

  const quest = await createQuest("Quest A", [
    { url: "https://a1.example/", title: "A1" },
    { url: "https://a2.example/", title: "A2" },
  ]);
  await setWindowBinding(win.id!, { kind: "quest", questId: quest.id });

  for (const tab of quest.tabs) {
    await browser.tabs.create({ windowId: win.id, url: tab.url });
  }

  const windowActor = createActor(windowSyncMachine, {
    input: { windowId: win.id! },
  }).start();
  browser.tabs.onCreated.addListener((tab) => {
    if (tab.windowId === win.id) windowActor.send({ type: "TABS_CHANGED" });
  });
  browser.tabs.onRemoved.addListener((_tabId, info) => {
    if (info.windowId === win.id) windowActor.send({ type: "TABS_CHANGED" });
  });

  // The live actor resyncs as soon as those tabs are created (fake tabs
  // have no title, so this also collapses "A1"/"A2" to ""). Let that
  // settle and re-read the quest so the test's baseline is the real
  // last-synced state, not the seed values passed into createQuest.
  await flushAsyncWork();
  const quests = await getQuests();
  const synced = quests.find((m) => m.id === quest.id)!;

  return { windowId: win.id!, quest: synced };
}

describe("restoreMachine", () => {
  it("preserves the outgoing quest's tabs instead of zeroing them out", async () => {
    const { windowId, quest: questA } = await setUpWindowWithQuest();
    const questB = await createQuest("Quest B", [
      { url: "https://b1.example/", title: "B1" },
    ]);

    const actor = createActor(restoreMachine).start();
    actor.send({
      type: "RESTORE",
      target: { kind: "quest", quest: questB },
    });
    await waitFor(actor, (state) => state.matches("idle"));
    await flushAsyncWork();

    const quests = await getQuests();
    const updatedA = quests.find((m) => m.id === questA.id);
    expect(updatedA?.tabs).toEqual(questA.tabs);

    const map = await getWindowBindingMap();
    expect(map[windowId]).toEqual({ kind: "quest", questId: questB.id });

    const openUrls = (await browser.tabs.query({ windowId }))
      .map((t) => t.url)
      .filter((url) => url !== DASHBOARD_URL);
    expect(openUrls).toEqual(["https://b1.example/"]);
  });

  it("close all tabs leaves the window on the same (now empty) quest", async () => {
    const { windowId, quest: questA } = await setUpWindowWithQuest();

    const actor = createActor(restoreMachine).start();
    actor.send({ type: "CLOSE_TABS" });
    await waitFor(actor, (state) => state.matches("idle"));
    await flushAsyncWork();

    const map = await getWindowBindingMap();
    expect(map[windowId]).toEqual({ kind: "quest", questId: questA.id });

    const openUrls = (await browser.tabs.query({ windowId })).map((t) => t.url);
    expect(openUrls).toEqual([DASHBOARD_URL]);

    // Unlike Restore, staying attached during a plain close is correct: the
    // quest really is now empty, and the live sync should record that.
    const updatedA = (await getQuests()).find((m) => m.id === questA.id);
    expect(updatedA?.tabs).toEqual([]);
  });

  it("disconnect closes tabs but preserves the quest and leaves the window unbound", async () => {
    const { windowId, quest: questA } = await setUpWindowWithQuest();

    const actor = createActor(restoreMachine).start();
    actor.send({ type: "DISCONNECT" });
    await waitFor(actor, (state) => state.matches("idle"));
    await flushAsyncWork();

    const map = await getWindowBindingMap();
    expect(map[windowId]).toBeUndefined();

    const openUrls = (await browser.tabs.query({ windowId })).map((t) => t.url);
    expect(openUrls).toEqual([DASHBOARD_URL]);

    // Detaching before closing (like Restore) means the closures never get
    // attributed to questA, unlike a plain close.
    const updatedA = (await getQuests()).find((m) => m.id === questA.id);
    expect(updatedA?.tabs).toEqual(questA.tabs);
  });

  it("restores a project target by opening its own tabs and binding the window to it", async () => {
    const win = (await browser.windows.create({ focused: true }))!;
    const project = await createFolder("Untitled Project", null, "project");
    const projectWithTabs = {
      ...project,
      tabs: [{ url: "https://p1.example/", title: "P1" }],
    };

    const actor = createActor(restoreMachine).start();
    actor.send({
      type: "RESTORE",
      target: { kind: "project", project: projectWithTabs },
    });
    await waitFor(actor, (state) => state.matches("idle"));
    await flushAsyncWork();

    const map = await getWindowBindingMap();
    expect(map[win.id!]).toEqual({ kind: "project", projectId: project.id });

    const openUrls = (await browser.tabs.query({ windowId: win.id })).map(
      (t) => t.url,
    );
    expect(openUrls).toEqual(["https://p1.example/"]);
  });

  it("COMPLETE_QUEST detaches and closes a standalone quest's tabs while marking it done", async () => {
    const { windowId, quest: questA } = await setUpWindowWithQuest();

    const actor = createActor(restoreMachine).start();
    actor.send({ type: "COMPLETE_QUEST", quest: questA });
    await waitFor(actor, (state) => state.matches("idle"));
    await flushAsyncWork();

    const map = await getWindowBindingMap();
    expect(map[windowId]).toBeUndefined();

    const openUrls = (await browser.tabs.query({ windowId })).map((t) => t.url);
    expect(openUrls).toEqual([DASHBOARD_URL]);

    const updatedA = (await getQuests()).find((m) => m.id === questA.id);
    expect(updatedA?.status).toBe("done");
    expect(updatedA?.tabs).toEqual(questA.tabs);
  });
});
