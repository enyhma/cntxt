import { Show } from "solid-js";
import { AppWindow, ArrowRightLeft, Plug, Unplug } from "lucide-solid";
import { WorkspaceDot } from "./WorkspaceDot";
import { SyncBadge, type SyncStatus } from "./SyncBadge";

export function WorkspaceRow(props: {
  workspace: {
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
  onDisconnect: () => void;
}) {
  return (
    <div
      onClick={props.onView}
      class={
        "group flex cursor-pointer items-center gap-2.5 rounded border-l-2 px-2.5 py-2" +
        (props.isViewed
          ? " border-l-accent bg-surface-alt1 font-medium"
          : " border-l-transparent text-surface-txt-hint")
      }
    >
      <WorkspaceDot
        workspace={props.workspace}
        ring={props.isCurrent}
        title={props.isCurrent ? "Active" : undefined}
      />
      <span class="min-w-0 flex-1 truncate text-sm">
        {props.workspace.name}
      </span>
      <span class="font-mono text-[11px] text-surface-txt-faint">
        {props.count}
      </span>
      <SyncBadge status={props.workspace.syncStatus} />
      <Show when={props.isCurrent}>
        <button
          type="button"
          title="Disconnect"
          disabled={props.busy}
          onClick={(e) => {
            e.stopPropagation();
            props.onDisconnect();
          }}
          class="btn btn-square btn-ghost btn-xs shrink-0 text-surface-txt-hint opacity-0 group-hover:opacity-100 focus-visible:opacity-100 hover:text-warning disabled:opacity-40"
        >
          <Unplug size={10} />
        </button>
      </Show>
      <Show when={!props.isCurrent}>
        <Show
          when={!props.openElsewhere}
          fallback={
            <span title="Open elsewhere" class="shrink-0">
              <AppWindow size={10} class="text-surface-txt-faint" />
            </span>
          }
        >
          <button
            type="button"
            title={props.anyActive ? "Switch here" : "Connect here"}
            disabled={props.busy}
            onClick={(e) => {
              e.stopPropagation();
              props.onOpenAll();
            }}
            class="btn btn-square btn-ghost btn-xs shrink-0 text-accent opacity-0 group-hover:opacity-100 focus-visible:opacity-100 disabled:opacity-40"
          >
            <Show when={props.anyActive} fallback={<Plug size={10} />}>
              <ArrowRightLeft size={10} />
            </Show>
          </button>
        </Show>
      </Show>
    </div>
  );
}
