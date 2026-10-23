import { Show } from "solid-js";
import { AppWindow } from "lucide-solid";
import { GroupDot } from "./GroupDot";
import { SyncBadge, type SyncStatus } from "./SyncBadge";

export function GroupRow(props: {
  group: {
    id: string;
    name: string;
    color?: string;
    icon?: string;
    syncStatus?: SyncStatus;
  };
  count: number;
  isViewed: boolean;
  isCurrent: boolean;
  openElsewhere: boolean;
  anyActive: boolean;
  busy: boolean;
  onView: () => void;
  onOpenAll: () => void;
  onContextMenu: (e: MouseEvent) => void;
  // Double-click-to-switch is a live-browser-window concept (restoreMachine
  // closes/opens real tabs) that a thin client like web has nothing behind
  // — there, onOpenAll is wired as a no-op, so the "Double-click to switch"
  // hint would be actively misleading. Defaults to true so every existing
  // (extension) call site is unaffected.
  dblClickSwitch?: boolean;
}) {
  const canSwitch = () =>
    props.dblClickSwitch !== false && !props.isCurrent && !props.openElsewhere;
  return (
    <div
      onClick={props.onView}
      onDblClick={() => canSwitch() && !props.busy && props.onOpenAll()}
      onContextMenu={(e) => {
        e.preventDefault();
        props.onContextMenu(e);
      }}
      data-tip={canSwitch() ? "Double-click to switch" : undefined}
      class={
        "group flex cursor-pointer items-center gap-2.5 rounded border-l-2 px-2.5 py-2" +
        (props.isViewed
          ? " border-l-accent bg-surface-alt1 font-medium"
          : " border-l-transparent text-surface-txt-hint") +
        (canSwitch() ? " tooltip" : "")
      }
    >
      <GroupDot
        group={props.group}
        ring={props.isCurrent}
        title={props.isCurrent ? "Active" : undefined}
      />
      <span class="min-w-0 flex-1 truncate text-sm">{props.group.name}</span>
      <span class="font-mono text-[11px] text-surface-txt-faint">
        {props.count}
      </span>
      <SyncBadge status={props.group.syncStatus} />
      <Show when={props.openElsewhere}>
        <span title="Open elsewhere" class="shrink-0">
          <AppWindow size={10} class="text-surface-txt-faint" />
        </span>
      </Show>
    </div>
  );
}
