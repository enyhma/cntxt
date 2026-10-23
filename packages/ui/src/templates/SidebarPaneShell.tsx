import type { JSX } from "solid-js";
import { Show } from "solid-js";
import { PanelLeftOpen } from "lucide-solid";

// Layout for the Tabs view only: Sidebar on the left when open, a main
// pane (children) on the right. When collapsed, a small icon button
// stands in for the sidebar — a simplified stand-in for the extension's
// collapsed-rail chip, not a pixel copy.
export function SidebarPaneShell(props: {
  railOpen: boolean;
  onOpenRail: () => void;
  sidebar: JSX.Element;
  children: JSX.Element;
}) {
  return (
    <div class="flex min-h-0 flex-1">
      <Show
        when={props.railOpen}
        fallback={
          <button
            type="button"
            title="Open sidebar"
            onClick={props.onOpenRail}
            class="btn btn-square btn-ghost btn-sm m-1.5 self-start text-surface-txt-hint"
          >
            <PanelLeftOpen size={14} />
          </button>
        }
      >
        {props.sidebar}
      </Show>
      <div class="min-w-0 flex-1 overflow-y-auto">{props.children}</div>
    </div>
  );
}
