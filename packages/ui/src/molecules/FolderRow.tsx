import { Show } from "solid-js";
import { Layers, FolderClosed, FolderPlus, Plus } from "lucide-solid";
import { ExpandCaret } from "../atoms/ExpandCaret";

// An Area or Project row in the sidebar tree — mirrors
// extension/entrypoints/dashboard/App.tsx's inline FolderHeader (depth
// indentation, active fill, expand caret, hover-revealed add-project/
// add-group actions), minus what doesn't apply to a thin web client: no
// inline rename (editing), no right-click context menu, and no
// open/closed icon swap (that tracks which Project is currently bound to
// *this* browser window — a live-window concept web has no equivalent
// of, so Projects always show the plain closed-folder icon here).
export function FolderRow(props: {
  kind: "area" | "project";
  name: string;
  depth: number;
  expanded: boolean;
  active: boolean;
  onToggle: () => void;
  onOpen: () => void;
  // Area-only (mirrors FolderHeader: a Project can't nest another
  // Project) and only rendered on hover, exactly like the extension.
  onAddProject?: () => void;
  onAddGroup?: () => void;
}) {
  return (
    <div
      class={
        "group flex items-center gap-1 rounded py-1.5 pr-1.5" +
        (props.active ? " bg-surface-alt2" : "")
      }
      style={{ "padding-left": `${0.5 + props.depth * 0.875}rem` }}
    >
      <ExpandCaret expanded={props.expanded} onClick={props.onToggle} />
      {props.kind === "area" ? (
        <Layers size={12} class="shrink-0 text-surface-txt-faint" />
      ) : (
        <FolderClosed size={12} class="shrink-0 text-surface-txt-faint" />
      )}
      <span
        onClick={props.onOpen}
        class={
          "min-w-0 flex-1 cursor-pointer truncate text-[12px] font-semibold tracking-wide" +
          (props.active ? " text-surface-txt" : " text-surface-txt-hint")
        }
      >
        {props.name}
      </span>
      <div class="hidden shrink-0 items-center gap-0.5 group-hover:flex">
        <Show when={props.onAddProject}>
          <button
            type="button"
            title="New project"
            onClick={props.onAddProject}
            class="btn btn-square btn-ghost btn-xs text-surface-txt-hint"
          >
            <FolderPlus size={11} />
          </button>
        </Show>
        <Show when={props.onAddGroup}>
          <button
            type="button"
            title="New group"
            onClick={props.onAddGroup}
            class="btn btn-square btn-ghost btn-xs text-surface-txt-hint"
          >
            <Plus size={11} />
          </button>
        </Show>
      </div>
    </div>
  );
}
