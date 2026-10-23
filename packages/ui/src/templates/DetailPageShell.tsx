import type { JSX } from "solid-js";
import { Show } from "solid-js";

// Page-level chrome for a detail view shown in a sidebar+pane layout (a
// Project, a standalone Group, ...): consistent padding/max-width plus an
// optional row of trailing actions (e.g. "Delete forever", "Move to
// trash") at the top. No Back button — a persistent sidebar
// (organisms/Sidebar) stays visible alongside this, so there's nothing to
// go back from; you just select something else in the sidebar instead.
// (An earlier version of this template had a Back button, built around a
// drill-down-pages navigation model web no longer uses — see
// web/src/App.tsx.)
export function DetailPageShell(props: {
  headerActions?: JSX.Element;
  children: JSX.Element;
}) {
  return (
    <div class="p-6">
      <Show when={props.headerActions}>
        <div class="mb-4 flex items-center justify-end gap-2">
          {props.headerActions}
        </div>
      </Show>
      <div class="flex max-w-2xl flex-col gap-5">{props.children}</div>
    </div>
  );
}
