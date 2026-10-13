import { For, Show, type Accessor } from "solid-js";
import { Plus } from "lucide-solid";
import { GroupDot } from "./GroupDot";

// Area landing page — the main pane shows this instead of a group's tabs
// when the sidebar's FolderHeader name (not its chevron) is clicked for an
// Area. A Project's name click goes straight to its own live-tabs view
// instead (see App.tsx's showProjectTabs) — a Project is window-bound, so
// there's no separate "organizational" page for it the way an Area has
// one. `groups` here only ever lists groups directly ungrouped-under-this-
// Area (a Project's own groups show in its live-tabs view instead).
export function FolderPage(props: {
  folder: { id: string; name: string };
  breadcrumb: Array<{ id: string; name: string }>;
  groups: Accessor<
    Array<{
      id: string;
      name: string;
      tabs: unknown[];
      color?: string;
      icon?: string;
    }>
  >;
  projects?: Accessor<Array<{ id: string; name: string }>>;
  onOpenProject?: (id: string) => void;
  onOpenGroup: (id: string) => void;
  onAddGroup: () => void;
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
              GROUPS
            </span>
            <button
              type="button"
              title="New group"
              onClick={props.onAddGroup}
              class="btn btn-square btn-ghost btn-xs"
            >
              <Plus size={12} />
            </button>
          </div>
          <Show
            when={props.groups().length > 0}
            fallback={
              <p class="text-sm text-surface-txt-hint">No groups yet.</p>
            }
          >
            <For each={props.groups()}>
              {(m) => (
                <button
                  type="button"
                  onClick={() => props.onOpenGroup(m.id)}
                  class="flex items-center gap-2.5 rounded border border-surface-alt3 bg-surface-alt1 p-2.5 text-left shadow-[var(--shadow-card)] hover:bg-surface-alt2"
                >
                  <GroupDot group={m} />
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
