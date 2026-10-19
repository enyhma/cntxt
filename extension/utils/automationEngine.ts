import { getGroups } from "./groups";
import type { Group } from "./groups";
import { getAutomations } from "./automations";
import type { Automation } from "./automations";
import { BLOCK_REGISTRY } from "./automationBlocks";
import type { TriggerFiresOn, AutomationRunContext } from "./automationBlocks";
import { getCachedEntitlements } from "./entitlements";

function triggerNodeOf(automation: Pick<Automation, "nodes">) {
  return automation.nodes.find((n) => n.kind === "trigger");
}

export function matchesTrigger(
  automation: Pick<Automation, "nodes">,
  group: Group,
): boolean {
  const triggerNode = triggerNodeOf(automation);
  if (!triggerNode) return false;
  const block = BLOCK_REGISTRY[triggerNode.blockType];
  return block.kind === "trigger" && block.matches(group, triggerNode.config);
}

// Walks the chain starting right after the trigger node, running each
// action block's `run` in edge order. v1 enforces (see validateAutomation)
// that every node has at most one outgoing edge, so this is a straight
// walk, not a real topological sort — a future branching interpreter
// would only need to change this function, not the stored shape.
export async function runAutomationChain(
  automation: Pick<Automation, "nodes" | "edges">,
  ctx: AutomationRunContext,
): Promise<void> {
  const triggerNode = triggerNodeOf(automation);
  if (!triggerNode) return;

  let edge = automation.edges.find((e) => e.source === triggerNode.id);
  while (edge) {
    const node = automation.nodes.find((n) => n.id === edge!.target);
    if (!node || node.kind !== "action") break;
    const block = BLOCK_REGISTRY[node.blockType];
    if (block.kind === "action") await block.run(ctx, node.config);
    edge = automation.edges.find((e) => e.source === node.id);
  }
}

// Shared lookup for both runners below — each finds the automations it
// owns by which runner the trigger block declares (`firesOn`), not by
// string-matching a blockType name.
//
// Shortcuts (custom, user-authored automations) are Pro-only — but the two
// `seeded: true` defaults (utils/automations.ts) reproduce pre-existing
// core behavior every tier keeps (auto-archive, auto-complete-on-empty),
// so only non-seeded automations are filtered out here when Pro isn't
// active. One check, since every runner (runScheduledAutomations,
// windowSyncMachine's groupTabsSettled handler) calls through this.
export async function getEnabledAutomationsFor(
  firesOn: TriggerFiresOn,
): Promise<Automation[]> {
  const entitlements = await getCachedEntitlements();
  const proActive = entitlements?.proActive ?? false;

  const automations = (await getAutomations()).filter(
    (a) => a.enabled && (proActive || a.seeded),
  );
  return automations.filter((a) => {
    const triggerNode = triggerNodeOf(a);
    if (!triggerNode) return false;
    const block = BLOCK_REGISTRY[triggerNode.blockType];
    return block.kind === "trigger" && block.firesOn === firesOn;
  });
}

// Called from the existing session-capture alarm tick
// (entrypoints/background.ts) — replaces utils/autoArchive.ts's hardcoded
// loop with the same check expressed as the seeded "Archive stale done
// groups" Automation, plus any other enabled "scheduleTick" automation a
// user adds later.
export async function runScheduledAutomations(): Promise<void> {
  const automations = await getEnabledAutomationsFor("scheduleTick");
  if (automations.length === 0) return;

  for (const group of await getGroups()) {
    if (group.archivedAt || group.deletedAt) continue;
    for (const automation of automations) {
      if (matchesTrigger(automation, group)) {
        await runAutomationChain(automation, {
          group,
          project: null,
          windowId: null,
        });
      }
    }
  }
}

// Validates a graph before it's persisted (editor save path) — v1's
// linear-chain constraint, checked explicitly rather than baked into the
// storage shape so branching can be added later without a migration.
export function validateAutomation(
  automation: Pick<Automation, "nodes" | "edges">,
): string | null {
  const triggers = automation.nodes.filter((n) => n.kind === "trigger");
  const [trigger] = triggers;
  if (triggers.length !== 1 || !trigger) {
    return "An automation needs exactly one trigger.";
  }

  const outgoingCount = new Map<string, number>();
  for (const edge of automation.edges) {
    outgoingCount.set(edge.source, (outgoingCount.get(edge.source) ?? 0) + 1);
  }
  for (const count of outgoingCount.values()) {
    if (count > 1) return "Each block can only connect to one next block.";
  }

  const visited = new Set<string>([trigger.id]);
  let edge = automation.edges.find((e) => e.source === trigger.id);
  while (edge) {
    if (visited.has(edge.target)) return "Automation has a cycle.";
    visited.add(edge.target);
    edge = automation.edges.find((e) => e.source === edge!.target);
  }

  if (automation.nodes.some((n) => !visited.has(n.id))) {
    return "Every block must connect back to the trigger.";
  }
  return null;
}
