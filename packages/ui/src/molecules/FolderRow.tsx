import { Layers, FolderClosed } from "lucide-solid";
import { ExpandCaret } from "../atoms/ExpandCaret";

// An Area or Project row in the sidebar tree — mirrors
// extension/entrypoints/dashboard/App.tsx's inline FolderHeader (depth
// indentation, active fill, expand caret), minus what doesn't apply to a
// thin web client: no inline rename (editing), no right-click context
// menu, and no open/closed icon swap (that tracks which Project is
// currently bound to *this* browser window — a live-window concept web
// has no equivalent of, so Projects always show the plain closed-folder
// icon here).
export function FolderRow(props: {
  kind: "area" | "project";
  name: string;
  depth: number;
  expanded: boolean;
  active: boolean;
  onToggle: () => void;
  onOpen: () => void;
}) {
  return (
    <div
      class={
        "flex items-center gap-1 rounded py-1.5 pr-1.5" +
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
    </div>
  );
}
