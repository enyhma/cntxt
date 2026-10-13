import { createActor } from "xstate";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeBrowser } from "wxt/testing/fake-browser";
import { setWindowBinding } from "./session";
import { windowSyncMachine } from "./windowSyncMachine";
import { createGroup, getGroups, updateGroup } from "./groups";
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

    const group = await createGroup("Untouched", []);

    const actor = createActor(windowSyncMachine, {
      input: { windowId: win.id! },
    }).start();
    await flushAsyncWork();

    actor.send({ type: "TABS_CHANGED" });
    await flushAsyncWork();

    const groups = await getGroups();
    expect(groups.find((m) => m.id === group.id)?.tabs).toEqual([]);
  });

  it("syncs the bound group's tabs on TABS_CHANGED", async () => {
    const win = (await browser.windows.create({ focused: true }))!;
    const group = await createGroup("Tracked", []);
    await setWindowBinding(win.id!, { kind: "group", groupId: group.id });

    const actor = createActor(windowSyncMachine, {
      input: { windowId: win.id! },
    }).start();
    await flushAsyncWork();

    await browser.tabs.create({ windowId: win.id, url: "https://a.example/" });
    actor.send({ type: "TABS_CHANGED" });
    await flushAsyncWork();

    const groups = await getGroups();
    const updated = groups.find((m) => m.id === group.id);
    expect(updated?.tabs).toEqual([{ url: "https://a.example/", title: "" }]);
  });

  it("syncs a project-bound window with no active group into the project's own tabs", async () => {
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
    expect((await getGroups()).length).toBe(0);
  });

  it("syncs a project-bound window with an active group into that group's tabs", async () => {
    const win = (await browser.windows.create({ focused: true }))!;
    const project = await createFolder("Untitled Project", null, "project");
    const group = await createGroup("Swapped in", []);
    await updateFolder(project.id, { activeGroupId: group.id });
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

    const updatedGroup = (await getGroups()).find((q) => q.id === group.id);
    expect(updatedGroup?.tabs).toEqual([
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

  it("auto-completes a standalone group once tabs stay empty past the debounce", async () => {
    const win = (await browser.windows.create({ focused: true }))!;
    const group = await createGroup("Standalone", []);
    await updateGroup(group.id, { status: "active" });
    await setWindowBinding(win.id!, { kind: "group", groupId: group.id });

    createActor(windowSyncMachine, { input: { windowId: win.id! } }).start();
    await flushMicrotasks();

    await vi.advanceTimersByTimeAsync(45_000);

    const updated = (await getGroups()).find((q) => q.id === group.id);
    expect(updated?.status).toBe("done");
    expect(updated?.tabs).toEqual([]);
  });

  it("cancels the pending auto-complete if a tab reappears before the debounce elapses", async () => {
    const win = (await browser.windows.create({ focused: true }))!;
    const group = await createGroup("Standalone", []);
    await updateGroup(group.id, { status: "active" });
    await setWindowBinding(win.id!, { kind: "group", groupId: group.id });

    const actor = createActor(windowSyncMachine, {
      input: { windowId: win.id! },
    }).start();
    await flushMicrotasks();

    await vi.advanceTimersByTimeAsync(30_000);
    await browser.tabs.create({ windowId: win.id, url: "https://a.example/" });
    actor.send({ type: "TABS_CHANGED" });
    await flushMicrotasks();

    await vi.advanceTimersByTimeAsync(45_000);

    const updated = (await getGroups()).find((q) => q.id === group.id);
    expect(updated?.status).toBe("active");
  });

  it("auto-completes a nested group and advances to the next pending sibling", async () => {
    const win = (await browser.windows.create({ focused: true }))!;
    const project = await createFolder("Project", null, "project");
    const active = await createGroup("Active", []);
    await updateGroup(active.id, {
      folderId: project.id,
      status: "active",
      order: 0,
    });
    const pending = await createGroup("Pending", [
      { url: "https://b.example/", title: "" },
    ]);
    await updateGroup(pending.id, {
      folderId: project.id,
      status: "pending",
      order: 1,
    });
    await updateFolder(project.id, { activeGroupId: active.id });
    await setWindowBinding(win.id!, {
      kind: "project",
      projectId: project.id,
    });

    createActor(windowSyncMachine, { input: { windowId: win.id! } }).start();
    await flushMicrotasks();

    await vi.advanceTimersByTimeAsync(45_000);

    const groups = await getGroups();
    expect(groups.find((q) => q.id === active.id)?.status).toBe("done");
    expect(groups.find((q) => q.id === pending.id)?.status).toBe("active");

    const folders = await getFolders();
    expect(folders.find((f) => f.id === project.id)?.activeGroupId).toBe(
      pending.id,
    );

    const openTabs = await browser.tabs.query({ windowId: win.id });
    expect(openTabs.some((t) => t.url === "https://b.example/")).toBe(true);
  });
});
