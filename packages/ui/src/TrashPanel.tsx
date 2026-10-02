import { For, Show, type Accessor } from "solid-js";
import { RotateCcw, Trash2 } from "lucide-solid";
import { WorkspaceDot } from "./WorkspaceDot";

// Days left before purge_trashed_workspaces (supabase/migrations) removes
// this for good. Floored, not rounded, so "0 days left" means "could be
// gone any time now" rather than implying a few more hours of safety.
export function daysRemaining(
  deletedAt: number | undefined,
  retentionDays: number,
): number {
  const elapsedMs = Date.now() - (deletedAt ?? Date.now());
  return Math.max(0, retentionDays - Math.floor(elapsedMs / 86_400_000));
}

export function TrashPanel(props: {
  workspaces: Accessor<
    Array<{
      id: string;
      name: string;
      color?: string;
      icon?: string;
      deletedAt?: number;
    }>
  >;
  retentionDays: Accessor<number>;
  onRestore: (id: string) => void;
  onDeleteForever: (id: string) => void;
}) {
  return (
    <div class="flex-1 overflow-y-auto p-6">
      <div class="flex max-w-md flex-col gap-3">
        <h2 class="text-base font-semibold">Trash</h2>
        <Show
          when={props.workspaces().length > 0}
          fallback={
            <p class="text-sm text-surface-txt-hint">Trash is empty.</p>
          }
        >
          <For each={props.workspaces()}>
            {(w) => (
              <div class="flex items-center gap-2.5 rounded border border-surface-alt3 bg-surface-alt1 p-2.5 shadow-[var(--shadow-card)]">
                <WorkspaceDot workspace={w} />
                <div class="flex min-w-0 flex-1 flex-col">
                  <span class="truncate text-sm font-medium">{w.name}</span>
                  <span class="text-xs text-surface-txt-hint">
                    {daysRemaining(w.deletedAt, props.retentionDays())} day
                    {daysRemaining(w.deletedAt, props.retentionDays()) === 1
                      ? ""
                      : "s"}{" "}
                    left
                  </span>
                </div>
                <button
                  type="button"
                  title="Restore"
                  onClick={() => props.onRestore(w.id)}
                  class="btn btn-square btn-sm border border-surface-alt3 bg-surface-alt2"
                >
                  <RotateCcw size={13} />
                </button>
                <button
                  type="button"
                  title="Delete forever"
                  onClick={() => props.onDeleteForever(w.id)}
                  class="btn btn-square btn-sm border border-surface-alt3 text-danger"
                >
                  <Trash2 size={13} />
                </button>
              </div>
            )}
          </For>
        </Show>
      </div>
    </div>
  );
}
