import { Show } from "solid-js";
import { missionDotClass, missionTxtClass } from "./colors";
import { Icon, type IconName } from "./icon";

export function MissionDot(props: {
  mission: { id: string; color?: string; icon?: string } | undefined;
  ring?: boolean;
  title?: string;
}) {
  const icon = () => props.mission?.icon as IconName | undefined;
  return (
    <span
      title={props.title}
      class={
        "grid h-3.5 w-3.5 shrink-0 place-items-center rounded-full " +
        missionDotClass(props.mission) +
        (props.ring ? " ring-2 ring-accent" : "")
      }
    >
      <Show when={icon()}>
        <Icon name={icon()!} size={9} class={missionTxtClass(props.mission)} />
      </Show>
    </span>
  );
}
