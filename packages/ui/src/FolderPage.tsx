import { For, Show, type Accessor } from "solid-js";
import { Plus } from "lucide-solid";
import { QuestDot } from "./QuestDot";

// Area/Project landing page — the main pane shows this instead of a
// quest's tabs when the sidebar's FolderHeader name (not its chevron) is
// clicked. `projects` is only passed for an Area page (an Area's own
// children); `sections` is only passed for a Project page (a Project's
// depth-2 folders) — a folder only ever has one or the other.
export function FolderPage(props: {
  folder: { id: string; name: string };
  breadcrumb: Array<{ id: string; name: string }>;
  quests: Accessor<
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
  sections?: Accessor<
    Array<{ id: string; name: string; resourceCount: number }>
  >;
  onOpenSection?: (id: string) => void;
  onAddSection?: () => void;
  onOpenQuest: (id: string) => void;
  onAddQuest: () => void;
}) {
  const projectsList = () => props.projects?.() ?? [];
  const sectionsList = () => props.sections?.() ?? [];

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

        <Show when={props.sections}>
          <div class="flex flex-col gap-1.5">
            <div class="flex items-center gap-2">
              <span class="flex-1 font-mono text-[11px] tracking-wider text-surface-txt-faint">
                SECTIONS
              </span>
              <button
                type="button"
                title="New section"
                onClick={props.onAddSection}
                class="btn btn-square btn-ghost btn-xs"
              >
                <Plus size={12} />
              </button>
            </div>
            <Show
              when={sectionsList().length > 0}
              fallback={
                <p class="text-sm text-surface-txt-hint">No sections yet.</p>
              }
            >
              <For each={sectionsList()}>
                {(s) => (
                  <button
                    type="button"
                    onClick={() => props.onOpenSection?.(s.id)}
                    class="flex items-center gap-2.5 rounded border border-surface-alt3 bg-surface-alt1 p-2.5 text-left shadow-[var(--shadow-card)] hover:bg-surface-alt2"
                  >
                    <span class="min-w-0 flex-1 truncate text-sm font-medium">
                      {s.name}
                    </span>
                    <span class="font-mono text-[11px] text-surface-txt-faint">
                      {s.resourceCount}
                    </span>
                  </button>
                )}
              </For>
            </Show>
          </div>
        </Show>

        <div class="flex flex-col gap-1.5">
          <div class="flex items-center gap-2">
            <span class="flex-1 font-mono text-[11px] tracking-wider text-surface-txt-faint">
              MISSIONS
            </span>
            <button
              type="button"
              title="New quest"
              onClick={props.onAddQuest}
              class="btn btn-square btn-ghost btn-xs"
            >
              <Plus size={12} />
            </button>
          </div>
          <Show
            when={props.quests().length > 0}
            fallback={
              <p class="text-sm text-surface-txt-hint">No quests yet.</p>
            }
          >
            <For each={props.quests()}>
              {(m) => (
                <button
                  type="button"
                  onClick={() => props.onOpenQuest(m.id)}
                  class="flex items-center gap-2.5 rounded border border-surface-alt3 bg-surface-alt1 p-2.5 text-left shadow-[var(--shadow-card)] hover:bg-surface-alt2"
                >
                  <QuestDot quest={m} />
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
