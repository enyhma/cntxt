import { getSettings } from "./settings";
import type { BlockType } from "./automationBlocks";

export interface AutomationNode {
  id: string;
  kind: "trigger" | "action";
  blockType: BlockType;
  config: Record<string, unknown>;
  // Canvas position for the editor (packages/ui/src/AutomationsPanel.tsx)
  // — meaningless to the engine itself, carried here so the graph is one
  // source of truth instead of a separate execution list plus a separate
  // layout list that could drift apart.
  position: { x: number; y: number };
}

export interface AutomationEdge {
  id: string;
  source: string;
  target: string;
}

export interface Automation {
  id: string;
  name: string;
  enabled: boolean;
  nodes: AutomationNode[];
  edges: AutomationEdge[];
  createdAt: number;
  updatedAt: number;
  // True only for the two defaultAutomations() below. Shortcuts (custom,
  // user-authored automations) are Pro-only, but these two reproduce
  // pre-existing core behavior (auto-archive, auto-complete-on-empty) that
  // every tier keeps — see getEnabledAutomationsFor's plan check.
  seeded?: boolean;
}

const STORAGE_KEY = "automations";

// Reproduces today's hardcoded behavior (utils/autoArchive.ts) plus the
// newly-requested "close all tabs -> done" rule, as the two seeded,
// user-editable Automations — so behavior is preserved, not regressed,
// the first time this storage key is read.
function defaultAutomations(autoArchiveDays: number): Automation[] {
  const now = Date.now();
  return [
    {
      id: crypto.randomUUID(),
      name: "Archive stale done groups",
      enabled: true,
      seeded: true,
      nodes: [
        {
          id: "trigger",
          kind: "trigger",
          blockType: "groupDoneAndStale",
          config: { days: autoArchiveDays },
          position: { x: 0, y: 0 },
        },
        {
          id: "action",
          kind: "action",
          blockType: "archiveGroup",
          config: {},
          position: { x: 260, y: 0 },
        },
      ],
      edges: [{ id: "e1", source: "trigger", target: "action" }],
      createdAt: now,
      updatedAt: now,
    },
    {
      id: crypto.randomUUID(),
      name: "Complete group when tabs close",
      enabled: true,
      seeded: true,
      nodes: [
        {
          id: "trigger",
          kind: "trigger",
          blockType: "groupTabsEmpty",
          config: {},
          position: { x: 0, y: 0 },
        },
        {
          id: "action1",
          kind: "action",
          blockType: "setGroupStatus",
          config: { status: "done" },
          position: { x: 260, y: 0 },
        },
        {
          id: "action2",
          kind: "action",
          blockType: "advanceNextSibling",
          config: {},
          position: { x: 520, y: 0 },
        },
      ],
      edges: [
        { id: "e1", source: "trigger", target: "action1" },
        { id: "e2", source: "action1", target: "action2" },
      ],
      createdAt: now,
      updatedAt: now,
    },
  ];
}

export async function getAutomations(): Promise<Automation[]> {
  const result = await browser.storage.local.get(STORAGE_KEY);
  const existing = result[STORAGE_KEY] as Automation[] | undefined;
  if (existing) return existing;

  const { autoArchiveDays } = await getSettings();
  const seeded = defaultAutomations(autoArchiveDays);
  await setAutomations(seeded);
  return seeded;
}

async function setAutomations(automations: Automation[]) {
  await browser.storage.local.set({ [STORAGE_KEY]: automations });
}

export async function createAutomation(
  input: Pick<Automation, "name" | "nodes" | "edges"> & { enabled?: boolean },
): Promise<Automation> {
  const automation: Automation = {
    id: crypto.randomUUID(),
    name: input.name,
    enabled: input.enabled ?? true,
    nodes: input.nodes,
    edges: input.edges,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    seeded: false,
  };
  const automations = await getAutomations();
  await setAutomations([...automations, automation]);
  return automation;
}

export async function updateAutomation(
  id: string,
  patch: Partial<Pick<Automation, "name" | "enabled" | "nodes" | "edges">>,
): Promise<void> {
  const automations = await getAutomations();
  await setAutomations(
    automations.map((a) =>
      a.id === id ? { ...a, ...patch, updatedAt: Date.now() } : a,
    ),
  );
}

export async function deleteAutomation(id: string): Promise<void> {
  const automations = await getAutomations();
  await setAutomations(automations.filter((a) => a.id !== id));
}
