import { Show } from "solid-js";
import { colorFor, domainOf, textColorFor } from "./colors";

export function TabRow(props: {
  tab: { url: string; title: string };
  index: number;
  selected: boolean;
  selectable: boolean;
  onToggle: () => void;
  onOpen: () => void;
}) {
  const domain = () => domainOf(props.tab.url);
  return (
    <div
      onClick={props.selectable ? props.onToggle : props.onOpen}
      class={
        "flex cursor-pointer items-center gap-[11px] border-b border-surface-alt2 px-3.5 py-2.5 last:border-b-0 hover:bg-surface-alt2" +
        (props.selected ? " bg-accent/20" : "")
      }
    >
      <Show when={props.selectable}>
        <input
          type="checkbox"
          class="checkbox checkbox-xs"
          checked={props.selected}
          onClick={(e) => e.stopPropagation()}
          onChange={props.onToggle}
        />
      </Show>
      <span
        class={
          "grid h-4.5 w-4.5 shrink-0 place-items-center rounded text-[10px] font-bold " +
          colorFor(props.tab.url) +
          " " +
          textColorFor(props.tab.url)
        }
      >
        {domain()[0]?.toUpperCase()}
      </span>
      <span class="min-w-0 flex-1 truncate text-sm">
        {props.tab.title || props.tab.url}
      </span>
      <span class="max-w-[38%] shrink-0 truncate font-mono text-[11px] text-surface-txt-faint">
        {domain()}
      </span>
    </div>
  );
}
