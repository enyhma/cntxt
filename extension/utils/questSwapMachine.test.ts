import { createActor, waitFor } from "xstate";
import { beforeEach, describe, expect, it } from "vitest";
import { fakeBrowser } from "wxt/testing/fake-browser";
import { questSwapMachine } from "./questSwapMachine";
import { setWindowQuest } from "./session";
import { DASHBOARD_URL } from "./tabs";
import { createQuest, getQuests, updateQuest } from "./quests";

beforeEach(() => {
  fakeBrowser.reset();
});

async function flushAsyncWork() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

async function setUpRoadmapWindow() {
  const win = (await browser.windows.create({ focused: true }))!;
  await browser.tabs.create({ windowId: win.id, url: DASHBOARD_URL });

  const quest = await createQuest("Benchmarking", [
    { url: "https://research.example/", title: "Research", phaseId: "p1" },
    { url: "https://draft.example/", title: "Draft", phaseId: "p2" },
    { url: "https://always.example/", title: "Unphased" },
  ]);
  await updateQuest(quest.id, {
    phases: [
      { id: "p1", name: "Research", status: "active" },
      { id: "p2", name: "Draft", status: "pending" },
      { id: "p3", name: "QA", status: "pending" },
    ],
    activePhaseId: "p1",
  });
  await setWindowQuest(win.id!, quest.id);

  // Phase 1's and the unphased tab start open; phase 2's does not, mirroring
  // "only the active phase's tabs are open right now".
  await browser.tabs.create({
    windowId: win.id,
    url: "https://research.example/",
  });
  await browser.tabs.create({
    windowId: win.id,
    url: "https://always.example/",
  });

  const [synced] = (await getQuests()).filter((m) => m.id === quest.id);
  return { windowId: win.id!, quest: synced! };
}

async function openUrlsIn(windowId: number) {
  return (await browser.tabs.query({ windowId }))
    .map((t) => t.url)
    .filter((url) => url !== DASHBOARD_URL);
}

describe("questSwapMachine", () => {
  it("ACTIVATE_PHASE closes other phases' tabs, opens this phase's, leaves unphased tabs alone", async () => {
    const { windowId, quest } = await setUpRoadmapWindow();

    const actor = createActor(questSwapMachine).start();
    actor.send({ type: "ACTIVATE_PHASE", quest, phaseId: "p2" });
    await waitFor(actor, (state) => state.matches("idle"));
    await flushAsyncWork();

    expect(await openUrlsIn(windowId)).toEqual(
      expect.arrayContaining([
        "https://draft.example/",
        "https://always.example/",
      ]),
    );
    expect(await openUrlsIn(windowId)).not.toContain(
      "https://research.example/",
    );

    const [updated] = (await getQuests()).filter((m) => m.id === quest.id);
    expect(updated?.activePhaseId).toBe("p2");
    expect(updated?.phases).toEqual([
      { id: "p1", name: "Research", status: "pending" },
      { id: "p2", name: "Draft", status: "active" },
      { id: "p3", name: "QA", status: "pending" },
    ]);
  });

  it("COMPLETE_PHASE closes the completed phase's tabs and auto-advances to the next pending phase", async () => {
    const { windowId, quest } = await setUpRoadmapWindow();

    const actor = createActor(questSwapMachine).start();
    actor.send({ type: "COMPLETE_PHASE", quest, phaseId: "p1" });
    await waitFor(actor, (state) => state.matches("idle"));
    await flushAsyncWork();

    expect(await openUrlsIn(windowId)).toEqual(
      expect.arrayContaining([
        "https://draft.example/",
        "https://always.example/",
      ]),
    );
    expect(await openUrlsIn(windowId)).not.toContain(
      "https://research.example/",
    );

    const [updated] = (await getQuests()).filter((m) => m.id === quest.id);
    expect(updated?.activePhaseId).toBe("p2");
    expect(updated?.phases).toEqual([
      { id: "p1", name: "Research", status: "done" },
      { id: "p2", name: "Draft", status: "active" },
      { id: "p3", name: "QA", status: "pending" },
    ]);
  });

  it("COMPLETE_PHASE on the last phase leaves nothing active", async () => {
    const { windowId, quest } = await setUpRoadmapWindow();
    await updateQuest(quest.id, {
      phases: [
        { id: "p1", name: "Research", status: "done" },
        { id: "p2", name: "Draft", status: "done" },
        { id: "p3", name: "QA", status: "active" },
      ],
      activePhaseId: "p3",
    });
    const [current] = (await getQuests()).filter((m) => m.id === quest.id);

    const actor = createActor(questSwapMachine).start();
    actor.send({ type: "COMPLETE_PHASE", quest: current!, phaseId: "p3" });
    await waitFor(actor, (state) => state.matches("idle"));
    await flushAsyncWork();

    const [updated] = (await getQuests()).filter((m) => m.id === quest.id);
    expect(updated?.activePhaseId).toBeUndefined();
    expect(updated?.phases?.find((p) => p.id === "p3")?.status).toBe("done");
    // unphased tab untouched throughout
    expect(await openUrlsIn(windowId)).toContain("https://always.example/");
  });
});
