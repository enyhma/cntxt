import { createActor, waitFor } from "xstate";
import { beforeEach, describe, expect, it } from "vitest";
import { fakeBrowser } from "wxt/testing/fake-browser";
import { restoreMachine } from "./restoreMachine";
import { getWindowMissionMap, setWindowMission } from "./session";
import { DASHBOARD_URL } from "./tabs";
import { createMission, getMissions } from "./missions";
import { missionWindowMachine } from "./missionWindowMachine";

beforeEach(() => {
  fakeBrowser.reset();
});

async function flushAsyncWork() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * Also spawns the real per-window actor from missionWindowMachine and
 * wires it to tabs.onCreated/onRemoved, the same as background.ts does.
 * Without this, closing tabs during Restore wouldn't reproduce the bug this
 * suite guards against: the corruption only happens because something is
 * live-syncing tab changes back onto whichever mission the window was
 * mapped to at the moment the tabs closed.
 */
async function setUpWindowWithMission() {
  const win = (await browser.windows.create({ focused: true }))!;
  await browser.tabs.create({ windowId: win.id, url: DASHBOARD_URL });

  const mission = await createMission("Mission A", [
    { url: "https://a1.example/", title: "A1" },
    { url: "https://a2.example/", title: "A2" },
  ]);
  await setWindowMission(win.id!, mission.id);

  for (const tab of mission.tabs) {
    await browser.tabs.create({ windowId: win.id, url: tab.url });
  }

  const windowActor = createActor(missionWindowMachine, {
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
  // settle and re-read the mission so the test's baseline is the real
  // last-synced state, not the seed values passed into createMission.
  await flushAsyncWork();
  const missions = await getMissions();
  const synced = missions.find((m) => m.id === mission.id)!;

  return { windowId: win.id!, mission: synced };
}

describe("restoreMachine", () => {
  it("preserves the outgoing mission's tabs instead of zeroing them out", async () => {
    const { windowId, mission: missionA } = await setUpWindowWithMission();
    const missionB = await createMission("Mission B", [
      { url: "https://b1.example/", title: "B1" },
    ]);

    const actor = createActor(restoreMachine).start();
    actor.send({ type: "RESTORE", mission: missionB });
    await waitFor(actor, (state) => state.matches("idle"));
    await flushAsyncWork();

    const missions = await getMissions();
    const updatedA = missions.find((m) => m.id === missionA.id);
    expect(updatedA?.tabs).toEqual(missionA.tabs);

    const map = await getWindowMissionMap();
    expect(map[windowId]).toBe(missionB.id);

    const openUrls = (await browser.tabs.query({ windowId }))
      .map((t) => t.url)
      .filter((url) => url !== DASHBOARD_URL);
    expect(openUrls).toEqual(["https://b1.example/"]);
  });

  it("close all tabs leaves the window on the same (now empty) mission", async () => {
    const { windowId, mission: missionA } = await setUpWindowWithMission();

    const actor = createActor(restoreMachine).start();
    actor.send({ type: "CLOSE_TABS" });
    await waitFor(actor, (state) => state.matches("idle"));
    await flushAsyncWork();

    const map = await getWindowMissionMap();
    expect(map[windowId]).toBe(missionA.id);

    const openUrls = (await browser.tabs.query({ windowId })).map((t) => t.url);
    expect(openUrls).toEqual([DASHBOARD_URL]);

    // Unlike Restore, staying attached during a plain close is correct: the
    // mission really is now empty, and the live sync should record that.
    const updatedA = (await getMissions()).find((m) => m.id === missionA.id);
    expect(updatedA?.tabs).toEqual([]);
  });

  it("disconnect closes tabs but preserves the mission and leaves the window unmapped", async () => {
    const { windowId, mission: missionA } = await setUpWindowWithMission();

    const actor = createActor(restoreMachine).start();
    actor.send({ type: "DISCONNECT" });
    await waitFor(actor, (state) => state.matches("idle"));
    await flushAsyncWork();

    const map = await getWindowMissionMap();
    expect(map[windowId]).toBeUndefined();

    const openUrls = (await browser.tabs.query({ windowId })).map((t) => t.url);
    expect(openUrls).toEqual([DASHBOARD_URL]);

    // Detaching before closing (like Restore) means the closures never get
    // attributed to missionA, unlike a plain close.
    const updatedA = (await getMissions()).find((m) => m.id === missionA.id);
    expect(updatedA?.tabs).toEqual(missionA.tabs);
  });
});
