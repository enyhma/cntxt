import { createActor } from "xstate";
import { beforeEach, describe, expect, it } from "vitest";
import { fakeBrowser } from "wxt/testing/fake-browser";
import { setWindowMission } from "./session";
import { missionWindowMachine } from "./missionWindowMachine";
import { createMission, getMissions } from "./missions";

beforeEach(() => {
  fakeBrowser.reset();
});

async function flushAsyncWork() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("missionWindowMachine", () => {
  it("does not touch storage while the window has no mission mapping", async () => {
    const win = (await browser.windows.create({ focused: true }))!;
    await browser.tabs.create({ windowId: win.id, url: "https://a.example/" });

    const mission = await createMission("Untouched", []);

    const actor = createActor(missionWindowMachine, {
      input: { windowId: win.id! },
    }).start();
    await flushAsyncWork();

    actor.send({ type: "TABS_CHANGED" });
    await flushAsyncWork();

    const missions = await getMissions();
    expect(missions.find((m) => m.id === mission.id)?.tabs).toEqual([]);
  });

  it("syncs the mapped mission's tabs on TABS_CHANGED", async () => {
    const win = (await browser.windows.create({ focused: true }))!;
    const mission = await createMission("Tracked", []);
    await setWindowMission(win.id!, mission.id);

    const actor = createActor(missionWindowMachine, {
      input: { windowId: win.id! },
    }).start();
    await flushAsyncWork();

    await browser.tabs.create({ windowId: win.id, url: "https://a.example/" });
    actor.send({ type: "TABS_CHANGED" });
    await flushAsyncWork();

    const missions = await getMissions();
    const updated = missions.find((m) => m.id === mission.id);
    expect(updated?.tabs).toEqual([{ url: "https://a.example/", title: "" }]);
  });

  it("stops on WINDOW_CLOSED", async () => {
    const win = (await browser.windows.create({ focused: true }))!;
    const actor = createActor(missionWindowMachine, {
      input: { windowId: win.id! },
    }).start();

    actor.send({ type: "WINDOW_CLOSED" });

    expect(actor.getSnapshot().status).toBe("done");
  });
});
