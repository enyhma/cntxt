import { ChevronRight } from "lucide-solid";

// The expand/collapse toggle for a sidebar tree row (FolderRow). Rotates
// 90deg when expanded — same visual as
// extension/entrypoints/dashboard/App.tsx's inline FolderHeader.
export function ExpandCaret(props: { expanded: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={props.onClick}
      class="btn btn-square btn-ghost btn-xs shrink-0 text-surface-txt-hint"
    >
      <ChevronRight
        size={11}
        class={"transition-transform" + (props.expanded ? " rotate-90" : "")}
      />
    </button>
  );
}
