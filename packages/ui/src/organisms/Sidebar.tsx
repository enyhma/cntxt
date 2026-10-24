import { For, Show, type Accessor } from "solid-js";
import { FolderPlus, Plus, PanelLeftClose } from "lucide-solid";
import { FolderRow } from "../molecules/FolderRow";
import { GroupRow } from "../GroupRow";

export type SidebarFolder = {
  id: string;
  name: string;
  kind: "area" | "project";
};
export type SidebarGroup = {
  id: string;
  name: string;
  color?: string;
  icon?: string;
  tabCount: number;
};

// The Area > Project > Group tree, mirroring
// extension/entrypoints/dashboard/App.tsx:1199-1289's sidebar structure:
// Areas (each expandable, nesting child Projects and direct child
// Groups), then a flat "PROJECTS" section for standalone Projects (each
// also expandable, nesting their own Groups), then a flat "UNGROUPED"
// section for Groups with no parent folder at all. Pure props-in/
// callbacks-out — no Supabase calls in here, same convention as every
// other organism in this package.
//
// GroupRow is reused as-is for every Group row: isCurrent/openElsewhere/
// anyActive/busy are extension-only live-window concepts web has nothing
// to report for them, so they're always passed as false/inert here;
// onOpenAll (double-click-to-switch) is a no-op for the same reason —
// single-click (onView) still works normally.
export function Sidebar(props: {
  areas: Accessor<SidebarFolder[]>;
  standaloneProjects: Accessor<SidebarFolder[]>;
  ungroupedGroups: Accessor<SidebarGroup[]>;
  childProjectsOf: (areaId: string) => SidebarFolder[];
  groupsIn: (folderId: string) => SidebarGroup[];
  expanded: Accessor<Set<string>>;
  onToggle: (id: string) => void;
  activeFolderId?: string;
  activeGroupId?: string;
  onOpenFolder: (id: string) => void;
  onOpenGroup: (id: string) => void;
  onAddArea: () => void;
  onAddGroup: () => void;
  // Per-row hover actions (FolderRow), mirroring FolderHeader's
  // group-hover reveal: add a child Project under this Area, or a child
  // Group under this Area/Project.
  onAddProjectTo: (areaId: string) => void;
  onAddGroupTo: (folderId: string) => void;
  onCollapseRail: () => void;
}) {
  function groupRow(group: SidebarGroup, depth: number) {
    return (
      <div
        style={depth ? { "padding-left": `${depth * 0.875}rem` } : undefined}
      >
        <GroupRow
          group={group}
          count={group.tabCount}
          isViewed={props.activeGroupId === group.id}
          isCurrent={false}
          openElsewhere={false}
          anyActive={false}
          busy={false}
          onView={() => props.onOpenGroup(group.id)}
          onOpenAll={() => {}}
          onContextMenu={() => {}}
          dblClickSwitch={false}
        />
      </div>
    );
  }

  function folderBlock(folder: SidebarFolder, depth: number) {
    const expanded = () => props.expanded().has(folder.id);
    return (
      <>
        <FolderRow
          kind={folder.kind}
          name={folder.name}
          depth={depth}
          expanded={expanded()}
          active={props.activeFolderId === folder.id}
          onToggle={() => props.onToggle(folder.id)}
          onOpen={() => props.onOpenFolder(folder.id)}
          onAddProject={
            folder.kind === "area"
              ? () => props.onAddProjectTo(folder.id)
              : undefined
          }
          onAddGroup={() => props.onAddGroupTo(folder.id)}
        />
        <Show when={expanded()}>
          <For each={props.childProjectsOf(folder.id)}>
            {(project) => folderBlock(project, depth + 1)}
          </For>
          <For each={props.groupsIn(folder.id)}>
            {(group) => groupRow(group, depth + 1)}
          </For>
        </Show>
      </>
    );
  }

  return (
    <nav class="flex w-60 shrink-0 flex-col border-r border-surface-alt2 bg-surface-alt1">
      <div class="flex h-11 shrink-0 items-center gap-2 border-b border-surface-alt2 pr-2.5 pl-3.5">
        <span class="flex-1 font-mono text-[11px] tracking-wider text-surface-txt-faint">
          AREAS
        </span>
        <button
          type="button"
          title="New area"
          onClick={props.onAddArea}
          class="btn btn-square btn-ghost btn-xs"
        >
          <FolderPlus size={14} />
        </button>
        <button
          type="button"
          title="New group"
          onClick={props.onAddGroup}
          class="btn btn-square btn-ghost btn-xs"
        >
          <Plus size={14} />
        </button>
        <button
          type="button"
          title="Collapse"
          onClick={props.onCollapseRail}
          class="btn btn-square btn-ghost btn-xs border border-surface-alt3"
        >
          <PanelLeftClose size={13} />
        </button>
      </div>
      <div class="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto p-1.5">
        <For each={props.areas()}>{(area) => folderBlock(area, 0)}</For>

        <Show when={props.standaloneProjects().length > 0}>
          <div class="mt-1 px-2 py-1 font-mono text-[10px] tracking-wider text-surface-txt-faint">
            PROJECTS
          </div>
          <For each={props.standaloneProjects()}>
            {(project) => folderBlock(project, 0)}
          </For>
        </Show>

        <Show
          when={
            (props.areas().length > 0 ||
              props.standaloneProjects().length > 0) &&
            props.ungroupedGroups().length > 0
          }
        >
          <div class="mt-1 px-2 py-1 font-mono text-[10px] tracking-wider text-surface-txt-faint">
            UNGROUPED
          </div>
        </Show>
        <For each={props.ungroupedGroups()}>
          {(group) => groupRow(group, 0)}
        </For>
      </div>
    </nav>
  );
}
