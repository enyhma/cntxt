import { createActor } from "xstate";
import { beforeEach, describe, expect, it } from "vitest";
import { fakeBrowser } from "wxt/testing/fake-browser";
import { setWindowWorkspace } from "./session";
import { workspaceWindowMachine } from "./workspaceWindowMachine";
import { createWorkspace, getWorkspaces } from "./workspaces";

beforeEach(() => {
  fakeBrowser.reset();
});

async function flushAsyncWork() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("workspaceWindowMachine", () => {
  it("does not touch storage while the window has no workspace mapping", async () => {
    const win = (await browser.windows.create({ focused: true }))!;
    await browser.tabs.create({ windowId: win.id, url: "https://a.example/" });

    const workspace = await createWorkspace("Untouched", []);

    const actor = createActor(workspaceWindowMachine, {
      input: { windowId: win.id! },
    }).start();
    await flushAsyncWork();

    actor.send({ type: "TABS_CHANGED" });
    await flushAsyncWork();

    const workspaces = await getWorkspaces();
    expect(workspaces.find((w) => w.id === workspace.id)?.tabs).toEqual([]);
  });

  it("syncs the mapped workspace's tabs on TABS_CHANGED", async () => {
    const win = (await browser.windows.create({ focused: true }))!;
    const workspace = await createWorkspace("Tracked", []);
    await setWindowWorkspace(win.id!, workspace.id);

    const actor = createActor(workspaceWindowMachine, {
      input: { windowId: win.id! },
    }).start();
    await flushAsyncWork();

    await browser.tabs.create({ windowId: win.id, url: "https://a.example/" });
    actor.send({ type: "TABS_CHANGED" });
    await flushAsyncWork();

    const workspaces = await getWorkspaces();
    const updated = workspaces.find((w) => w.id === workspace.id);
    expect(updated?.tabs).toEqual([{ url: "https://a.example/", title: "" }]);
  });

  it("stops on WINDOW_CLOSED", async () => {
    const win = (await browser.windows.create({ focused: true }))!;
    const actor = createActor(workspaceWindowMachine, {
      input: { windowId: win.id! },
    }).start();

    actor.send({ type: "WINDOW_CLOSED" });

    expect(actor.getSnapshot().status).toBe("done");
  });
});
