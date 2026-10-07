import { createSignal, For, Show, type Accessor } from "solid-js";
import { Check, Plus } from "lucide-solid";

export type QuestStatus = "pending" | "active" | "done";
export type QuestBoardItem = {
  id: string;
  name: string;
  status?: QuestStatus;
  tabCount: number;
};

const STATUS_LABEL: Record<QuestStatus, string> = {
  pending: "PENDING",
  active: "ACTIVE",
  done: "DONE",
};

// A Project's roadmap: its child quests as ordered cards, one swapped into
// the Project's window at a time. Absent/empty quests (handled by the
// caller, not here) means nothing is nested under this Project yet — this
// only ever renders once there's at least one.
export function QuestBoardPanel(props: {
  quests: Accessor<QuestBoardItem[]>;
  busy: boolean;
  onActivate: (questId: string) => void;
  onComplete: (questId: string) => void;
  onAddQuest: (name: string) => void;
}) {
  const [adding, setAdding] = createSignal(false);
  const [name, setName] = createSignal("");

  function commitAdd() {
    const trimmed = name().trim();
    setAdding(false);
    setName("");
    if (trimmed) props.onAddQuest(trimmed);
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
              placeholder="Quest name"
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
            title="Add quest"
            onClick={() => setAdding(true)}
            class="btn btn-square btn-ghost btn-xs"
          >
            <Plus size={12} />
          </button>
        </Show>
      </div>

      <Show when={props.quests().length === 0}>
        <p class="text-sm text-surface-txt-hint">
          No other quests in this project yet.
        </p>
      </Show>
      <div class="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
        <For each={props.quests()}>
          {(quest) => {
            const status = () => quest.status ?? "pending";
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
                    {quest.tabCount} tabs
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
                  {quest.name}
                </span>
                <Show when={status() !== "active"}>
                  <button
                    type="button"
                    disabled={props.busy}
                    onClick={() => props.onActivate(quest.id)}
                    class="btn btn-xs self-start border-none bg-accent text-accent-txt hover:bg-accent-alt1 disabled:opacity-50"
                  >
                    Activate
                  </button>
                </Show>
                <Show when={status() === "active"}>
                  <button
                    type="button"
                    disabled={props.busy}
                    onClick={() => props.onComplete(quest.id)}
                    class="btn btn-xs gap-1 self-start border border-surface-alt3 disabled:opacity-50"
                  >
                    <Check size={11} />
                    Complete quest
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
