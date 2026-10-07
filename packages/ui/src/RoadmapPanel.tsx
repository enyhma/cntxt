import { createSignal, For, Show, type Accessor } from "solid-js";
import { Check, Plus } from "lucide-solid";

export type PhaseStatus = "pending" | "active" | "done";
export type Phase = { id: string; name: string; status: PhaseStatus };

const STATUS_LABEL: Record<PhaseStatus, string> = {
  pending: "PENDING",
  active: "ACTIVE",
  done: "DONE",
};

// The stage-gated roadmap: ordered phase cards above a mission's tab list.
// Absent/empty phases (handled by the caller, not here) means a mission has
// no roadmap at all — this only ever renders once there's at least one.
export function RoadmapPanel(props: {
  phases: Accessor<Phase[]>;
  tabCount: (phaseId: string) => number;
  busy: boolean;
  onActivate: (phaseId: string) => void;
  onComplete: (phaseId: string) => void;
  onAddPhase: (name: string) => void;
}) {
  const [adding, setAdding] = createSignal(false);
  const [name, setName] = createSignal("");

  function commitAdd() {
    const trimmed = name().trim();
    setAdding(false);
    setName("");
    if (trimmed) props.onAddPhase(trimmed);
  }

  return (
    <div class="mb-5 flex flex-col gap-1.5">
      <div class="flex items-center gap-2">
        <span class="flex-1 font-mono text-[11px] tracking-wider text-surface-txt-faint">
          ROADMAP
        </span>
        <Show
          when={!adding()}
          fallback={
            <input
              autofocus
              placeholder="Phase name"
              class="input input-xs w-36 bg-surface-alt2"
              value={name()}
              onInput={(e) => setName(e.currentTarget.value)}
              onBlur={commitAdd}
              onKeyDown={(e) => e.key === "Enter" && commitAdd()}
            />
          }
        >
          <button
            type="button"
            title="Add phase"
            onClick={() => setAdding(true)}
            class="btn btn-square btn-ghost btn-xs"
          >
            <Plus size={12} />
          </button>
        </Show>
      </div>

      <Show when={props.phases().length === 0}>
        <p class="text-sm text-surface-txt-hint">
          No roadmap — add a phase to stage-gate this mission's tabs.
        </p>
      </Show>
      <div class="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
        <For each={props.phases()}>
          {(phase) => (
            <div
              class={
                "flex flex-col gap-2 rounded border p-3" +
                (phase.status === "active"
                  ? " border-accent bg-surface-alt1"
                  : " border-surface-alt3 bg-surface-alt1")
              }
            >
              <div class="flex items-center justify-between gap-2">
                <span class="font-mono text-[10px] tracking-wider text-surface-txt-faint">
                  {STATUS_LABEL[phase.status]}
                </span>
                <span class="font-mono text-[11px] text-surface-txt-faint">
                  {props.tabCount(phase.id)} tabs
                </span>
              </div>
              <span
                class={
                  "truncate text-sm font-medium" +
                  (phase.status === "done"
                    ? " text-surface-txt-hint line-through"
                    : "")
                }
              >
                {phase.name}
              </span>
              <Show when={phase.status === "pending"}>
                <button
                  type="button"
                  disabled={props.busy}
                  onClick={() => props.onActivate(phase.id)}
                  class="btn btn-xs self-start border-none bg-accent text-accent-txt hover:bg-accent-alt1 disabled:opacity-50"
                >
                  Activate
                </button>
              </Show>
              <Show when={phase.status === "active"}>
                <button
                  type="button"
                  disabled={props.busy}
                  onClick={() => props.onComplete(phase.id)}
                  class="btn btn-xs gap-1 self-start border border-surface-alt3 disabled:opacity-50"
                >
                  <Check size={11} />
                  Complete phase
                </button>
              </Show>
            </div>
          )}
        </For>
      </div>
    </div>
  );
}
