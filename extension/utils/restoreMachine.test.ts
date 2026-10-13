import { createActor, waitFor } from "xstate";
import { beforeEach, describe, expect, it } from "vitest";
import { fakeBrowser } from "wxt/testing/fake-browser";
import { restoreMachine } from "./restoreMachine";
import { getWindowBindingMap, setWindowBinding } from "./session";
import { DASHBOARD_URL } from "./tabs";
import { createGroup, getGroups } from "./groups";
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
async function setUpWindowWithGroup() {
  const win = (await browser.windows.create({ focused: true }))!;
  await browser.tabs.create({ windowId: win.id, url: DASHBOARD_URL });

  const group = await createGroup("Group A", [
    { url: "https://a1.example/", title: "A1" },
    { url: "https://a2.example/", title: "A2" },
  ]);
  await setWindowBinding(win.id!, { kind: "group", groupId: group.id });

  for (const tab of group.tabs) {
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
  // settle and re-read the group so the test's baseline is the real
  // last-synced state, not the seed values passed into createGroup.
  await flushAsyncWork();
  const groups = await getGroups();
  const synced = groups.find((m) => m.id === group.id)!;

  return { windowId: win.id!, group: synced };
}

describe("restoreMachine", () => {
  it("preserves the outgoing group's tabs instead of zeroing them out", async () => {
    const { windowId, group: groupA } = await setUpWindowWithGroup();
    const groupB = await createGroup("Group B", [
      { url: "https://b1.example/", title: "B1" },
    ]);

    const actor = createActor(restoreMachine).start();
    actor.send({
      type: "RESTORE",
      target: { kind: "group", group: groupB },
    });
    await waitFor(actor, (state) => state.matches("idle"));
    await flushAsyncWork();

    const groups = await getGroups();
    const updatedA = groups.find((m) => m.id === groupA.id);
    expect(updatedA?.tabs).toEqual(groupA.tabs);

    const map = await getWindowBindingMap();
    expect(map[windowId]).toEqual({ kind: "group", groupId: groupB.id });

    const openUrls = (await browser.tabs.query({ windowId }))
      .map((t) => t.url)
      .filter((url) => url !== DASHBOARD_URL);
    expect(openUrls).toEqual(["https://b1.example/"]);
  });

  it("close all tabs leaves the window on the same (now empty) group", async () => {
    const { windowId, group: groupA } = await setUpWindowWithGroup();

    const actor = createActor(restoreMachine).start();
    actor.send({ type: "CLOSE_TABS" });
    await waitFor(actor, (state) => state.matches("idle"));
    await flushAsyncWork();

    const map = await getWindowBindingMap();
    expect(map[windowId]).toEqual({ kind: "group", groupId: groupA.id });

    const openUrls = (await browser.tabs.query({ windowId })).map((t) => t.url);
    expect(openUrls).toEqual([DASHBOARD_URL]);

    // Unlike Restore, staying attached during a plain close is correct: the
    // group really is now empty, and the live sync should record that.
    const updatedA = (await getGroups()).find((m) => m.id === groupA.id);
    expect(updatedA?.tabs).toEqual([]);
  });

  it("disconnect closes tabs but preserves the group and leaves the window unbound", async () => {
    const { windowId, group: groupA } = await setUpWindowWithGroup();

    const actor = createActor(restoreMachine).start();
    actor.send({ type: "DISCONNECT" });
    await waitFor(actor, (state) => state.matches("idle"));
    await flushAsyncWork();

    const map = await getWindowBindingMap();
    expect(map[windowId]).toBeUndefined();

    const openUrls = (await browser.tabs.query({ windowId })).map((t) => t.url);
    expect(openUrls).toEqual([DASHBOARD_URL]);

    // Detaching before closing (like Restore) means the closures never get
    // attributed to groupA, unlike a plain close.
    const updatedA = (await getGroups()).find((m) => m.id === groupA.id);
    expect(updatedA?.tabs).toEqual(groupA.tabs);
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

  it("COMPLETE_GROUP detaches and closes a standalone group's tabs while marking it done", async () => {
    const { windowId, group: groupA } = await setUpWindowWithGroup();

    const actor = createActor(restoreMachine).start();
    actor.send({ type: "COMPLETE_GROUP", group: groupA });
    await waitFor(actor, (state) => state.matches("idle"));
    await flushAsyncWork();

    const map = await getWindowBindingMap();
    expect(map[windowId]).toBeUndefined();

    const openUrls = (await browser.tabs.query({ windowId })).map((t) => t.url);
    expect(openUrls).toEqual([DASHBOARD_URL]);

    const updatedA = (await getGroups()).find((m) => m.id === groupA.id);
    expect(updatedA?.status).toBe("done");
    expect(updatedA?.tabs).toEqual(groupA.tabs);
  });
});
