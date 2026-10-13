import { createActor } from "xstate";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeBrowser } from "wxt/testing/fake-browser";
import { setWindowBinding } from "./session";
import { windowSyncMachine } from "./windowSyncMachine";
import { createQuest, getQuests, updateQuest } from "./quests";
import { createFolder, getFolders, updateFolder } from "./folders";

beforeEach(() => {
  fakeBrowser.reset();
});

async function flushAsyncWork() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

// Under vi.useFakeTimers(), a bare setTimeout-based flush never fires on
// its own — repeatedly yielding the microtask queue is what drains the
// chained awaits instead (same technique as utils/sync.test.ts's `flush`,
// just more iterations: the auto-complete path chains through
// getAutomations/matchesTrigger/runAutomationChain/advanceNextSibling, a
// deeper chain than sync.ts's debounce).
async function flushMicrotasks() {
  for (let i = 0; i < 20; i++) await Promise.resolve();
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

describe("windowSyncMachine auto-complete on empty tabs", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("auto-completes a standalone quest once tabs stay empty past the debounce", async () => {
    const win = (await browser.windows.create({ focused: true }))!;
    const quest = await createQuest("Standalone", []);
    await updateQuest(quest.id, { status: "active" });
    await setWindowBinding(win.id!, { kind: "quest", questId: quest.id });

    createActor(windowSyncMachine, { input: { windowId: win.id! } }).start();
    await flushMicrotasks();

    await vi.advanceTimersByTimeAsync(45_000);

    const updated = (await getQuests()).find((q) => q.id === quest.id);
    expect(updated?.status).toBe("done");
    expect(updated?.tabs).toEqual([]);
  });

  it("cancels the pending auto-complete if a tab reappears before the debounce elapses", async () => {
    const win = (await browser.windows.create({ focused: true }))!;
    const quest = await createQuest("Standalone", []);
    await updateQuest(quest.id, { status: "active" });
    await setWindowBinding(win.id!, { kind: "quest", questId: quest.id });

    const actor = createActor(windowSyncMachine, {
      input: { windowId: win.id! },
    }).start();
    await flushMicrotasks();

    await vi.advanceTimersByTimeAsync(30_000);
    await browser.tabs.create({ windowId: win.id, url: "https://a.example/" });
    actor.send({ type: "TABS_CHANGED" });
    await flushMicrotasks();

    await vi.advanceTimersByTimeAsync(45_000);

    const updated = (await getQuests()).find((q) => q.id === quest.id);
    expect(updated?.status).toBe("active");
  });

  it("auto-completes a nested quest and advances to the next pending sibling", async () => {
    const win = (await browser.windows.create({ focused: true }))!;
    const project = await createFolder("Project", null, "project");
    const active = await createQuest("Active", []);
    await updateQuest(active.id, {
      folderId: project.id,
      status: "active",
      order: 0,
    });
    const pending = await createQuest("Pending", [
      { url: "https://b.example/", title: "" },
    ]);
    await updateQuest(pending.id, {
      folderId: project.id,
      status: "pending",
      order: 1,
    });
    await updateFolder(project.id, { activeQuestId: active.id });
    await setWindowBinding(win.id!, {
      kind: "project",
      projectId: project.id,
    });

    createActor(windowSyncMachine, { input: { windowId: win.id! } }).start();
    await flushMicrotasks();

    await vi.advanceTimersByTimeAsync(45_000);

    const quests = await getQuests();
    expect(quests.find((q) => q.id === active.id)?.status).toBe("done");
    expect(quests.find((q) => q.id === pending.id)?.status).toBe("active");

    const folders = await getFolders();
    expect(folders.find((f) => f.id === project.id)?.activeQuestId).toBe(
      pending.id,
    );

    const openTabs = await browser.tabs.query({ windowId: win.id });
    expect(openTabs.some((t) => t.url === "https://b.example/")).toBe(true);
  });
});
