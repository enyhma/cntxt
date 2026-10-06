import { Show } from "solid-js";
import { BookmarkPlus } from "lucide-solid";
import { colorFor, domainOf, textColorFor } from "./colors";

export function TabRow(props: {
  tab: { url: string; title: string };
  index: number;
  selected: boolean;
  selectable: boolean;
  onToggle: () => void;
  onOpen: () => void;
  // Optional: omit to render the row exactly as before. Only the extension
  // dashboard wires this up (see docs/capabilities.md's "Manually-added
  // links/notes as workspace resources").
  onSaveAsResource?: () => void;
}) {
  const domain = () => domainOf(props.tab.url);
  return (
    <div
      onClick={props.selectable ? props.onToggle : props.onOpen}
      class={
        "group flex cursor-pointer items-center gap-[11px] border-b border-surface-alt2 px-3.5 py-2.5 last:border-b-0 hover:bg-surface-alt2" +
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
      <Show when={props.onSaveAsResource}>
        <button
          type="button"
          title="Save as resource"
          onClick={(e) => {
            e.stopPropagation();
            props.onSaveAsResource?.();
          }}
          class="btn btn-square btn-ghost btn-xs shrink-0 text-surface-txt-hint opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
        >
          <BookmarkPlus size={12} />
        </button>
      </Show>
    </div>
  );
}
