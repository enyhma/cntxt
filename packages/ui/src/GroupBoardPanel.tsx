import { createSignal, For, Show, type Accessor } from "solid-js";
import { Check, Plus } from "lucide-solid";

export type GroupStatus = "pending" | "active" | "done";
export type GroupBoardItem = {
  id: string;
  name: string;
  status?: GroupStatus;
  tabCount: number;
};

const STATUS_LABEL: Record<GroupStatus, string> = {
  pending: "PENDING",
  active: "ACTIVE",
  done: "DONE",
};

// A Project's roadmap: its child groups as ordered cards, one swapped into
// the Project's window at a time. Absent/empty groups (handled by the
// caller, not here) means nothing is nested under this Project yet — this
// only ever renders once there's at least one.
export function GroupBoardPanel(props: {
  groups: Accessor<GroupBoardItem[]>;
  busy: boolean;
  onActivate: (groupId: string) => void;
  onComplete: (groupId: string) => void;
  onAddGroup: (name: string) => void;
}) {
  const [adding, setAdding] = createSignal(false);
  const [name, setName] = createSignal("");

  function commitAdd() {
    const trimmed = name().trim();
    setAdding(false);
    setName("");
    if (trimmed) props.onAddGroup(trimmed);
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
              placeholder="Group name"
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
            title="Add group"
            onClick={() => setAdding(true)}
            class="btn btn-square btn-ghost btn-xs"
          >
            <Plus size={12} />
          </button>
        </Show>
      </div>

      <Show when={props.groups().length === 0}>
        <p class="text-sm text-surface-txt-hint">
          No other groups in this project yet.
        </p>
      </Show>
      <div class="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
        <For each={props.groups()}>
          {(group) => {
            const status = () => group.status ?? "pending";
            return (
              <div
                class={
                  "flex flex-col gap-2 rounded border p-3" +
                  (status() === "active"
                    ? " border-accent bg-surface-alt1"
                    : " border-surface-alt3 bg-surface-alt1")
                }
              >
                <div class="flex items-center justify-between gap-2">
                  <span class="font-mono text-[10px] tracking-wider text-surface-txt-faint">
                    {STATUS_LABEL[status()]}
                  </span>
                  <span class="font-mono text-[11px] text-surface-txt-faint">
                    {group.tabCount} tabs
                  </span>
                </div>
                <span
                  class={
                    "truncate text-sm font-medium" +
                    (status() === "done"
                      ? " text-surface-txt-hint line-through"
                      : "")
                  }
                >
                  {group.name}
                </span>
                <Show when={status() !== "active"}>
                  <button
                    type="button"
                    disabled={props.busy}
                    onClick={() => props.onActivate(group.id)}
                    class="btn btn-xs self-start border-none bg-accent text-accent-txt hover:bg-accent-alt1 disabled:opacity-50"
                  >
                    Activate
                  </button>
                </Show>
                <Show when={status() === "active"}>
                  <button
                    type="button"
                    disabled={props.busy}
                    onClick={() => props.onComplete(group.id)}
                    class="btn btn-xs gap-1 self-start border border-surface-alt3 disabled:opacity-50"
                  >
                    <Check size={11} />
                    Complete group
                  </button>
                </Show>
              </div>
            );
          }}
        </For>
      </div>
    </div>
  );
}
