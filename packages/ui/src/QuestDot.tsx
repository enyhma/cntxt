import { questDotClass, questTxtClass } from "./colors";
import { Icon, type IconName } from "./icon";

export function QuestDot(props: {
  quest: { id: string; color?: string; icon?: string } | undefined;
  ring?: boolean;
  title?: string;
}) {
  // A chosen icon wins; otherwise every quest still shows a consistent
  // kind icon (a target — matching Area/Project each always showing their
  // own kind icon in the sidebar) rather than a blank dot.
  const icon = () => (props.quest?.icon as IconName | undefined) ?? "target";
  return (
    <span
      title={props.title}
      class={
        "grid h-3.5 w-3.5 shrink-0 place-items-center rounded-full " +
        questDotClass(props.quest) +
        (props.ring ? " ring-2 ring-accent" : "")
      }
    >
      <Icon name={icon()} size={9} class={questTxtClass(props.quest)} />
    </span>
  );
}
