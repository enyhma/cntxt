import { createActor, waitFor } from "xstate";
import { beforeEach, describe, expect, it } from "vitest";
import { fakeBrowser } from "wxt/testing/fake-browser";
import { restoreMachine } from "./restoreMachine";
import { getWindowWorkspaceMap, setWindowWorkspace } from "./session";
import { DASHBOARD_URL } from "./tabs";
import { createWorkspace, getWorkspaces } from "./workspaces";
import { workspaceWindowMachine } from "./workspaceWindowMachine";

beforeEach(() => {
  fakeBrowser.reset();
});

async function flushAsyncWork() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * Also spawns the real per-window actor from workspaceWindowMachine and
 * wires it to tabs.onCreated/onRemoved, the same as background.ts does.
 * Without this, closing tabs during Restore wouldn't reproduce the bug this
 * suite guards against: the corruption only happens because something is
 * live-syncing tab changes back onto whichever workspace the window was
 * mapped to at the moment the tabs closed.
 */
async function setUpWindowWithWorkspace() {
  const win = (await browser.windows.create({ focused: true }))!;
  await browser.tabs.create({ windowId: win.id, url: DASHBOARD_URL });

  const workspace = await createWorkspace("Workspace A", [
    { url: "https://a1.example/", title: "A1" },
    { url: "https://a2.example/", title: "A2" },
  ]);
  await setWindowWorkspace(win.id!, workspace.id);

  for (const tab of workspace.tabs) {
    await browser.tabs.create({ windowId: win.id, url: tab.url });
  }

  const windowActor = createActor(workspaceWindowMachine, {
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
  // settle and re-read the workspace so the test's baseline is the real
  // last-synced state, not the seed values passed into createWorkspace.
  await flushAsyncWork();
  const workspaces = await getWorkspaces();
  const synced = workspaces.find((w) => w.id === workspace.id)!;

  return { windowId: win.id!, workspace: synced };
}

describe("restoreMachine", () => {
  it("preserves the outgoing workspace's tabs instead of zeroing them out", async () => {
    const { windowId, workspace: workspaceA } =
      await setUpWindowWithWorkspace();
    const workspaceB = await createWorkspace("Workspace B", [
      { url: "https://b1.example/", title: "B1" },
    ]);

    const actor = createActor(restoreMachine).start();
    actor.send({ type: "RESTORE", workspace: workspaceB });
    await waitFor(actor, (state) => state.matches("idle"));
    await flushAsyncWork();

    const workspaces = await getWorkspaces();
    const updatedA = workspaces.find((w) => w.id === workspaceA.id);
    expect(updatedA?.tabs).toEqual(workspaceA.tabs);

    const map = await getWindowWorkspaceMap();
    expect(map[windowId]).toBe(workspaceB.id);

    const openUrls = (await browser.tabs.query({ windowId }))
      .map((t) => t.url)
      .filter((url) => url !== DASHBOARD_URL);
    expect(openUrls).toEqual(["https://b1.example/"]);
  });

  it("close all tabs leaves the window on the same (now empty) workspace", async () => {
    const { windowId, workspace: workspaceA } =
      await setUpWindowWithWorkspace();

    const actor = createActor(restoreMachine).start();
    actor.send({ type: "CLOSE_TABS" });
    await waitFor(actor, (state) => state.matches("idle"));
    await flushAsyncWork();

    const map = await getWindowWorkspaceMap();
    expect(map[windowId]).toBe(workspaceA.id);

    const openUrls = (await browser.tabs.query({ windowId })).map((t) => t.url);
    expect(openUrls).toEqual([DASHBOARD_URL]);

    // Unlike Restore, staying attached during a plain close is correct: the
    // workspace really is now empty, and the live sync should record that.
    const updatedA = (await getWorkspaces()).find(
      (w) => w.id === workspaceA.id,
    );
    expect(updatedA?.tabs).toEqual([]);
  });
});
