import { Show } from "solid-js";
import { questDotClass, questTxtClass } from "./colors";
import { Icon, type IconName } from "./icon";

export function QuestDot(props: {
  quest: { id: string; color?: string; icon?: string } | undefined;
  ring?: boolean;
  title?: string;
}) {
  const icon = () => props.quest?.icon as IconName | undefined;
  return (
    <span
      title={props.title}
      class={
        "grid h-3.5 w-3.5 shrink-0 place-items-center rounded-full " +
        questDotClass(props.quest) +
        (props.ring ? " ring-2 ring-accent" : "")
      }
    >
      <Show when={icon()}>
        <Icon name={icon()!} size={9} class={questTxtClass(props.quest)} />
      </Show>
    </span>
  );
}
