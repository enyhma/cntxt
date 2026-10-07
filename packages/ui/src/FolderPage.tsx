import { For, Show, type Accessor } from "solid-js";
import { Plus } from "lucide-solid";
import { MissionDot } from "./MissionDot";

// Area/Project landing page — the main pane shows this instead of a
// mission's tabs when the sidebar's FolderHeader name (not its chevron) is
// clicked. `projects` is only passed for an Area page (a Project has no
// children of its own yet; Sections land in a later pass).
export function FolderPage(props: {
  folder: { id: string; name: string };
  breadcrumb: Array<{ id: string; name: string }>;
  missions: Accessor<
    Array<{
      id: string;
      name: string;
      tabs: unknown[];
      color?: string;
      icon?: string;
    }>
  >;
  projects?: Accessor<Array<{ id: string; name: string }>>;
  onOpenMission: (id: string) => void;
  onOpenProject?: (id: string) => void;
  onAddMission: () => void;
}) {
  const projectsList = () => props.projects?.() ?? [];

  return (
    <div class="flex-1 overflow-y-auto p-6">
      <div class="flex max-w-2xl flex-col gap-6">
        <div>
          <Show when={props.breadcrumb.length > 0}>
            <div class="mb-1 font-mono text-[11px] text-surface-txt-faint">
              <For each={props.breadcrumb}>{(b) => <span>{b.name}</span>}</For>
            </div>
          </Show>
          <h1 class="text-lg font-semibold">{props.folder.name}</h1>
        </div>

        <Show when={props.projects && projectsList().length > 0}>
          <div class="flex flex-col gap-1.5">
            <span class="font-mono text-[11px] tracking-wider text-surface-txt-faint">
              PROJECTS
            </span>
            <For each={projectsList()}>
              {(p) => (
                <button
                  type="button"
                  onClick={() => props.onOpenProject?.(p.id)}
                  class="flex items-center gap-2.5 rounded border border-surface-alt3 bg-surface-alt1 p-2.5 text-left shadow-[var(--shadow-card)] hover:bg-surface-alt2"
                >
                  <span class="min-w-0 flex-1 truncate text-sm font-medium">
                    {p.name}
                  </span>
                </button>
              )}
            </For>
          </div>
        </Show>

        <div class="flex flex-col gap-1.5">
          <div class="flex items-center gap-2">
            <span class="flex-1 font-mono text-[11px] tracking-wider text-surface-txt-faint">
              MISSIONS
            </span>
            <button
              type="button"
              title="New mission"
              onClick={props.onAddMission}
              class="btn btn-square btn-ghost btn-xs"
            >
              <Plus size={12} />
            </button>
          </div>
          <Show
            when={props.missions().length > 0}
            fallback={
              <p class="text-sm text-surface-txt-hint">No missions yet.</p>
            }
          >
            <For each={props.missions()}>
              {(m) => (
                <button
                  type="button"
                  onClick={() => props.onOpenMission(m.id)}
                  class="flex items-center gap-2.5 rounded border border-surface-alt3 bg-surface-alt1 p-2.5 text-left shadow-[var(--shadow-card)] hover:bg-surface-alt2"
                >
                  <MissionDot mission={m} />
                  <span class="min-w-0 flex-1 truncate text-sm font-medium">
                    {m.name}
                  </span>
                  <span class="font-mono text-[11px] text-surface-txt-faint">
                    {m.tabs.length} tabs
                  </span>
                </button>
              )}
            </For>
          </Show>
        </div>
      </div>
    </div>
  );
}
