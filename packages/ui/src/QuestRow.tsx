import { Show } from "solid-js";
import { AppWindow } from "lucide-solid";
import { QuestDot } from "./QuestDot";
import { SyncBadge, type SyncStatus } from "./SyncBadge";

export function QuestRow(props: {
  quest: {
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
}) {
  const canSwitch = () => !props.isCurrent && !props.openElsewhere;
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
      <QuestDot
        quest={props.quest}
        ring={props.isCurrent}
        title={props.isCurrent ? "Active" : undefined}
      />
      <span class="min-w-0 flex-1 truncate text-sm">{props.quest.name}</span>
      <span class="font-mono text-[11px] text-surface-txt-faint">
        {props.count}
      </span>
      <SyncBadge status={props.quest.syncStatus} />
      <Show when={props.openElsewhere}>
        <span title="Open elsewhere" class="shrink-0">
          <AppWindow size={10} class="text-surface-txt-faint" />
        </span>
      </Show>
    </div>
  );
}
