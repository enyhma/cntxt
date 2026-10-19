import { beforeEach, describe, expect, it } from "vitest";
import { fakeBrowser } from "wxt/testing/fake-browser";
import { createGroup, getGroups, updateGroup } from "./groups";
import { createFolder, getFolders } from "./folders";
import type { Automation, AutomationEdge, AutomationNode } from "./automations";
import {
  getEnabledAutomationsFor,
  matchesTrigger,
  runAutomationChain,
  validateAutomation,
} from "./automationEngine";

beforeEach(async () => {
  fakeBrowser.reset();
  // Shortcuts (custom automations) are Pro-only — seed a Pro-active cache
  // so these tests exercise the engine itself, not the plan gate (that
  // gate gets its own test below).
  await fakeBrowser.storage.local.set({
    entitlementsCache: {
      maxMissions: 100_000,
      accessExpiresAt: new Date(Date.now() + 86_400_000).toISOString(),
      hasBasicLicense: false,
      proActive: true,
    },
  });
});

function chain(nodes: AutomationNode[]): AutomationEdge[] {
  return nodes.slice(0, -1).map((n, i) => ({
    id: `e${i}`,
    source: n.id,
    target: nodes[i + 1]!.id,
  }));
}

describe("runAutomationChain", () => {
  it("runs setGroupStatus then advanceNextSibling in order", async () => {
    const project = await createFolder("Project", null, "project");
    const active = await createGroup("Active", []);
    await updateGroup(active.id, {
      folderId: project.id,
      status: "active",
      order: 0,
    });
    const pending = await createGroup("Pending", []);
    await updateGroup(pending.id, {
      folderId: project.id,
      status: "pending",
      order: 1,
    });

    const nodes: AutomationNode[] = [
      {
        id: "trigger",
        kind: "trigger",
        blockType: "groupTabsEmpty",
        config: {},
        position: { x: 0, y: 0 },
      },
      {
        id: "a1",
        kind: "action",
        blockType: "setGroupStatus",
        config: { status: "done" },
        position: { x: 0, y: 0 },
      },
      {
        id: "a2",
        kind: "action",
        blockType: "advanceNextSibling",
        config: {},
        position: { x: 0, y: 0 },
      },
    ];
    const automation: Pick<Automation, "nodes" | "edges"> = {
      nodes,
      edges: chain(nodes),
    };

    const freshActive = (await getGroups()).find((q) => q.id === active.id)!;
    await runAutomationChain(automation, {
      group: freshActive,
      project,
      windowId: null,
    });

    const groups = await getGroups();
    expect(groups.find((q) => q.id === active.id)?.status).toBe("done");
    expect(groups.find((q) => q.id === pending.id)?.status).toBe("active");

    const folders = await getFolders();
    expect(folders.find((f) => f.id === project.id)?.activeGroupId).toBe(
      pending.id,
    );
  });

  it("does nothing beyond the trigger when there are no action nodes", async () => {
    const group = await createGroup("Standalone", []);
    const nodes: AutomationNode[] = [
      {
        id: "trigger",
        kind: "trigger",
        blockType: "groupTabsEmpty",
        config: {},
        position: { x: 0, y: 0 },
      },
    ];
    await runAutomationChain(
      { nodes, edges: [] },
      { group, project: null, windowId: null },
    );
    const groups = await getGroups();
    expect(groups.find((q) => q.id === group.id)?.status).toBeUndefined();
  });
});

describe("matchesTrigger / getEnabledAutomationsFor", () => {
  it("filters by the trigger's firesOn, not the automation name", async () => {
    const scheduleAutomation: Automation = {
      id: "w1",
      name: "schedule",
      enabled: true,
      nodes: [
        {
          id: "t",
          kind: "trigger",
          blockType: "groupDoneAndStale",
          config: { days: 1 },
          position: { x: 0, y: 0 },
        },
      ],
      edges: [],
      createdAt: 0,
      updatedAt: 0,
    };
    const eventAutomation: Automation = {
      ...scheduleAutomation,
      id: "w2",
      name: "event",
      nodes: [
        {
          id: "t",
          kind: "trigger",
          blockType: "groupTabsEmpty",
          config: {},
          position: { x: 0, y: 0 },
        },
      ],
    };
    await browser.storage.local.set({
      automations: [scheduleAutomation, eventAutomation],
    });

    const scheduled = await getEnabledAutomationsFor("scheduleTick");
    expect(scheduled.map((a) => a.id)).toEqual(["w1"]);
    const event = await getEnabledAutomationsFor("groupTabsSettled");
    expect(event.map((a) => a.id)).toEqual(["w2"]);
  });

  it("excludes non-seeded automations when Pro isn't active, keeps seeded ones (Shortcuts is Pro-only)", async () => {
    await fakeBrowser.storage.local.set({
      entitlementsCache: {
        maxMissions: 3,
        accessExpiresAt: null,
        hasBasicLicense: true,
        proActive: false,
      },
    });
    const custom: Automation = {
      id: "custom",
      name: "custom",
      enabled: true,
      seeded: false,
      nodes: [
        {
          id: "t",
          kind: "trigger",
          blockType: "groupDoneAndStale",
          config: { days: 1 },
          position: { x: 0, y: 0 },
        },
      ],
      edges: [],
      createdAt: 0,
      updatedAt: 0,
    };
    const builtin: Automation = {
      ...custom,
      id: "builtin",
      name: "builtin",
      seeded: true,
    };
    await browser.storage.local.set({ automations: [custom, builtin] });

    const scheduled = await getEnabledAutomationsFor("scheduleTick");
    expect(scheduled.map((a) => a.id)).toEqual(["builtin"]);
  });

  it("matchesTrigger returns false when there's no trigger node", () => {
    const group = {
      id: "q",
      name: "Q",
      tabs: [],
      createdAt: 0,
      updatedAt: 0,
      order: 0,
    };
    expect(matchesTrigger({ nodes: [] }, group)).toBe(false);
  });
});

describe("validateAutomation", () => {
  const trigger: AutomationNode = {
    id: "t",
    kind: "trigger",
    blockType: "groupTabsEmpty",
    config: {},
    position: { x: 0, y: 0 },
  };
  const action: AutomationNode = {
    id: "a",
    kind: "action",
    blockType: "archiveGroup",
    config: {},
    position: { x: 0, y: 0 },
  };

  it("accepts a valid linear chain", () => {
    expect(
      validateAutomation({
        nodes: [trigger, action],
        edges: [{ id: "e", source: "t", target: "a" }],
      }),
    ).toBeNull();
  });

  it("rejects zero or multiple triggers", () => {
    expect(validateAutomation({ nodes: [action], edges: [] })).toMatch(
      /exactly one trigger/,
    );
    expect(
      validateAutomation({
        nodes: [trigger, { ...trigger, id: "t2" }],
        edges: [],
      }),
    ).toMatch(/exactly one trigger/);
  });

  it("rejects a node with more than one outgoing edge", () => {
    const action2: AutomationNode = { ...action, id: "a2" };
    expect(
      validateAutomation({
        nodes: [trigger, action, action2],
        edges: [
          { id: "e1", source: "t", target: "a" },
          { id: "e2", source: "t", target: "a2" },
        ],
      }),
    ).toMatch(/one next block/);
  });

  it("rejects a disconnected node", () => {
    const orphan: AutomationNode = { ...action, id: "orphan" };
    expect(
      validateAutomation({
        nodes: [trigger, action, orphan],
        edges: [{ id: "e", source: "t", target: "a" }],
      }),
    ).toMatch(/connect back to the trigger/);
  });

  it("rejects a cycle", () => {
    const action2: AutomationNode = { ...action, id: "a2" };
    expect(
      validateAutomation({
        nodes: [trigger, action, action2],
        edges: [
          { id: "e1", source: "t", target: "a" },
          { id: "e2", source: "a", target: "a2" },
          { id: "e3", source: "a2", target: "a" },
        ],
      }),
    ).toMatch(/cycle/);
  });
});
