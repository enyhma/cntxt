import { createMemo, createSignal, For, Show, type Accessor } from "solid-js";
import {
  createNodeStore,
  createEdgeStore,
  SolidFlow,
  Background,
  Controls,
  Handle,
  Position,
} from "@dschz/solid-flow";
import type { NodeProps, NodeTypes } from "@dschz/solid-flow";
// Required base styles for positioning/rendering nodes, edges, and the
// Background/Controls plugins — without this, nodes render as unstyled
// full-width boxes and the a11y instruction text (normally screen-reader
// only) shows up as visible text.
import "@dschz/solid-flow/styles";
import { Plus, Trash2 } from "lucide-solid";

// Inline shapes, not imported from extension/utils/automations.ts — same
// package-decoupling precedent as TimelinePanel's SessionLeg: this package
// stays ignorant of the extension's storage schema, only the structural
// shape it actually renders.
export type AutomationBlockType =
  | "groupDoneAndStale"
  | "groupTabsEmpty"
  | "setGroupStatus"
  | "archiveGroup"
  | "advanceNextSibling";

export type AutomationNode = {
  id: string;
  kind: "trigger" | "action";
  blockType: AutomationBlockType;
  config: Record<string, unknown>;
  position: { x: number; y: number };
};
export type AutomationEdge = { id: string; source: string; target: string };
export type Automation = {
  id: string;
  name: string;
  enabled: boolean;
  nodes: AutomationNode[];
  edges: AutomationEdge[];
};

// Display-only metadata — the real behavior (matches/run) lives in the
// extension's utils/automationBlocks.ts registry, which this package
// never imports (it's extension-specific, uses browser APIs). Kept in
// sync by hand; the two block type unions are structurally identical.
const BLOCK_INFO: Record<
  AutomationBlockType,
  { kind: "trigger" | "action"; label: string }
> = {
  groupDoneAndStale: { kind: "trigger", label: "Group done & stale" },
  groupTabsEmpty: { kind: "trigger", label: "Tabs closed" },
  setGroupStatus: { kind: "action", label: "Set status" },
  archiveGroup: { kind: "action", label: "Archive" },
  advanceNextSibling: { kind: "action", label: "Advance to next sibling" },
};
const ACTION_BLOCK_TYPES: AutomationBlockType[] = [
  "setGroupStatus",
  "archiveGroup",
  "advanceNextSibling",
];

function summarize(node: AutomationNode): string {
  if (node.blockType === "groupDoneAndStale") {
    return `${BLOCK_INFO[node.blockType].label} (${node.config.days ?? 30}d)`;
  }
  if (node.blockType === "setGroupStatus") {
    return `${BLOCK_INFO[node.blockType].label}: ${node.config.status ?? "done"}`;
  }
  return BLOCK_INFO[node.blockType].label;
}

// Handles are required for an edge to have anywhere to attach — without
// them the library silently skips drawing the connecting line, even
// though the edge data itself is correct. Connecting is still disabled
// (see `nodesConnectable={false}` on <SolidFlow>, below) since v1 only
// wires edges via the "Add block" button, not freeform handle-dragging;
// these just need to exist for the fixed edges to render.
function BlockNode(props: NodeProps<{ label: string; kind: string }, "block">) {
  return (
    <div
      class={`rounded border px-3 py-2 text-xs shadow-[var(--shadow-card)] ${
        props.data.kind === "trigger"
          ? "border-accent bg-surface-alt1"
          : "border-surface-alt3 bg-surface-alt1"
      } ${props.selected ? "ring-2 ring-accent" : ""}`}
    >
      <Handle type="target" position={Position.Left} />
      {props.data.label}
      <Handle type="source" position={Position.Right} />
    </div>
  );
}

const nodeTypes = { block: BlockNode } satisfies NodeTypes;

function orderedChain(automation: Automation): AutomationNode[] {
  const trigger = automation.nodes.find((n) => n.kind === "trigger");
  if (!trigger) return [];
  const byId = new Map(automation.nodes.map((n) => [n.id, n]));
  const chain = [trigger];
  let edge = automation.edges.find((e) => e.source === trigger.id);
  while (edge) {
    const next = byId.get(edge.target);
    if (!next) break;
    chain.push(next);
    edge = automation.edges.find((e) => e.source === next.id);
  }
  return chain;
}

function AutomationEditor(props: {
  automation: Automation;
  onSave: (patch: Pick<Automation, "nodes" | "edges">) => void;
  onClose: () => void;
}) {
  const [nodes, setNodes] = createNodeStore<typeof nodeTypes>(
    props.automation.nodes.map((n) => ({
      id: n.id,
      type: "block" as const,
      position: n.position,
      data: { label: summarize(n), kind: n.kind },
    })),
  );
  const [edges, setEdges] = createEdgeStore(
    props.automation.edges.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
    })),
  );
  const [chain, setChain] = createSignal(orderedChain(props.automation));
  const [selectedId, setSelectedId] = createSignal<string | undefined>();
  const selected = createMemo(() => chain().find((n) => n.id === selectedId()));
  const [addBlockType, setAddBlockType] =
    createSignal<AutomationBlockType>("setGroupStatus");

  function syncFromChain(next: AutomationNode[]) {
    setChain(next);
    setNodes(
      next.map((n) => ({
        id: n.id,
        type: "block" as const,
        position: n.position,
        data: { label: summarize(n), kind: n.kind },
      })),
    );
    const nextEdges: AutomationEdge[] = next
      .slice(0, -1)
      .map((n, i) => ({ id: `e${i}`, source: n.id, target: next[i + 1]!.id }));
    setEdges(nextEdges);
  }

  function addAction() {
    const current = chain();
    const last = current[current.length - 1];
    const node: AutomationNode = {
      id: crypto.randomUUID(),
      kind: "action",
      blockType: addBlockType(),
      config: {},
      position: { x: (last?.position.x ?? 0) + 260, y: last?.position.y ?? 0 },
    };
    syncFromChain([...current, node]);
  }

  function removeSelected() {
    const id = selectedId();
    if (!id) return;
    syncFromChain(chain().filter((n) => n.id !== id));
    setSelectedId(undefined);
  }

  function updateSelectedConfig(config: Record<string, unknown>) {
    const id = selectedId();
    if (!id) return;
    syncFromChain(chain().map((n) => (n.id === id ? { ...n, config } : n)));
  }

  function save() {
    const current = chain();
    syncFromChain(current); // keep nodes/edges store in lockstep before saving
    props.onSave({
      nodes: current,
      edges: current.slice(0, -1).map((n, i) => ({
        id: `e${i}`,
        source: n.id,
        target: current[i + 1]!.id,
      })),
    });
  }

  return (
    <div class="flex flex-1 flex-col gap-3 overflow-hidden p-6">
      <div class="flex items-center justify-between">
        <h2 class="text-base font-semibold">{props.automation.name}</h2>
        <div class="flex gap-2">
          <button
            type="button"
            class="btn btn-sm border border-surface-alt3"
            onClick={props.onClose}
          >
            Close
          </button>
          <button type="button" class="btn btn-sm btn-primary" onClick={save}>
            Save
          </button>
        </div>
      </div>

      <div class="h-80 rounded border border-surface-alt3 bg-surface">
        <SolidFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          nodesConnectable={false}
          onNodeClick={({ node }) => setSelectedId(node.id)}
          onPaneClick={() => setSelectedId(undefined)}
          fitView
        >
          <Background
            variant="dots"
            bgColor="var(--surface)"
            patternColor="var(--surface-alt3)"
          />
          <Controls
            showLock={false}
            buttonBgColor="var(--surface-alt1)"
            buttonBgColorHover="var(--surface-alt2)"
            buttonColor="var(--surface-txt)"
            buttonBorderColor="var(--surface-alt3)"
          />
        </SolidFlow>
      </div>

      <div class="flex items-center gap-2">
        <select
          class="select select-sm border border-surface-alt3 bg-surface-alt1"
          value={addBlockType()}
          onChange={(e) =>
            setAddBlockType(e.currentTarget.value as AutomationBlockType)
          }
        >
          <For each={ACTION_BLOCK_TYPES}>
            {(bt) => <option value={bt}>{BLOCK_INFO[bt].label}</option>}
          </For>
        </select>
        <button
          type="button"
          class="btn btn-sm border border-surface-alt3"
          onClick={addAction}
        >
          <Plus size={14} /> Add block
        </button>
      </div>

      <Show when={selected()}>
        {(node) => (
          <div class="flex items-center gap-3 rounded border border-surface-alt3 bg-surface-alt1 p-3 text-sm">
            <span class="font-medium">
              {BLOCK_INFO[node().blockType].label}
            </span>

            <Show when={node().blockType === "groupDoneAndStale"}>
              <label class="flex items-center gap-2 text-xs">
                Days
                <input
                  type="number"
                  class="input input-sm w-20 border border-surface-alt3"
                  value={(node().config.days as number) ?? 30}
                  onInput={(e) =>
                    updateSelectedConfig({
                      days: Number(e.currentTarget.value),
                    })
                  }
                />
              </label>
            </Show>

            <Show when={node().blockType === "setGroupStatus"}>
              <select
                class="select select-sm border border-surface-alt3"
                value={(node().config.status as string) ?? "done"}
                onChange={(e) =>
                  updateSelectedConfig({ status: e.currentTarget.value })
                }
              >
                <option value="pending">pending</option>
                <option value="active">active</option>
                <option value="done">done</option>
              </select>
            </Show>

            <Show when={node().kind !== "trigger"}>
              <button
                type="button"
                title="Remove block"
                class="btn btn-square btn-sm ml-auto border border-surface-alt3"
                onClick={removeSelected}
              >
                <Trash2 size={13} />
              </button>
            </Show>
          </div>
        )}
      </Show>
    </div>
  );
}

export function AutomationsPanel(props: {
  automations: Accessor<Automation[]>;
  onToggleEnabled: (id: string, enabled: boolean) => void;
  onSaveAutomation: (
    id: string,
    patch: Pick<Automation, "nodes" | "edges">,
  ) => void;
  onDeleteAutomation: (id: string) => void;
  // Customizing/toggling/deleting a Shortcut is Pro-only — the two seeded
  // defaults (auto-archive, auto-complete) keep running for every tier
  // regardless (see automationEngine.ts's getEnabledAutomationsFor), this
  // only locks the editing UI itself.
  proActive?: Accessor<boolean>;
}) {
  const locked = () => props.proActive?.() === false;
  const [editingId, setEditingId] = createSignal<string | undefined>();
  const editing = createMemo(() =>
    props.automations().find((a) => a.id === editingId()),
  );

  return (
    <Show
      when={!editing()}
      fallback={
        <AutomationEditor
          automation={editing()!}
          onClose={() => setEditingId(undefined)}
          onSave={(patch) => {
            props.onSaveAutomation(editing()!.id, patch);
            setEditingId(undefined);
          }}
        />
      }
    >
      <div class="flex-1 overflow-y-auto p-6">
        <div class="flex max-w-md flex-col gap-3">
          <h2 class="text-base font-semibold">Shortcuts</h2>
          <Show when={locked()}>
            <p class="text-sm text-surface-txt-hint">
              Shortcuts is a Pro feature — upgrade in Settings to customize,
              toggle, or delete these.
            </p>
          </Show>
          <For each={props.automations()}>
            {(a) => {
              const trigger = a.nodes.find((n) => n.kind === "trigger");
              return (
                <div class="flex items-center gap-2.5 rounded border border-surface-alt3 bg-surface-alt1 p-2.5 shadow-[var(--shadow-card)]">
                  <input
                    type="checkbox"
                    class="toggle toggle-sm"
                    checked={a.enabled}
                    disabled={locked()}
                    onChange={(e) =>
                      props.onToggleEnabled(a.id, e.currentTarget.checked)
                    }
                  />
                  <button
                    type="button"
                    class="min-w-0 flex-1 text-left disabled:cursor-default"
                    disabled={locked()}
                    onClick={() => setEditingId(a.id)}
                  >
                    <div class="truncate text-sm font-medium">{a.name}</div>
                    <div class="truncate text-xs text-surface-txt-hint">
                      {trigger ? summarize(trigger) : "No trigger"}
                    </div>
                  </button>
                  <button
                    type="button"
                    title="Delete shortcut"
                    class="btn btn-square btn-sm border border-surface-alt3 bg-surface-alt2"
                    disabled={locked()}
                    onClick={() => props.onDeleteAutomation(a.id)}
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              );
            }}
          </For>
        </div>
      </div>
    </Show>
  );
}
