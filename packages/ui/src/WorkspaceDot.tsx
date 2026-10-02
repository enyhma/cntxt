import { Show } from "solid-js";
import { workspaceDotClass, workspaceTxtClass } from "./colors";
import { Icon, type IconName } from "./icon";

export function WorkspaceDot(props: {
  workspace: { id: string; color?: string; icon?: string } | undefined;
  ring?: boolean;
  title?: string;
}) {
  const icon = () => props.workspace?.icon as IconName | undefined;
  return (
    <span
      title={props.title}
      class={
        "grid h-3.5 w-3.5 shrink-0 place-items-center rounded-full " +
        workspaceDotClass(props.workspace) +
        (props.ring ? " ring-2 ring-accent" : "")
      }
    >
      <Show when={icon()}>
        <Icon
          name={icon()!}
          size={9}
          class={workspaceTxtClass(props.workspace)}
        />
      </Show>
    </span>
  );
}
