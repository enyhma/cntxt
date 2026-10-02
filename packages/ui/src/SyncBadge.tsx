import { Show } from "solid-js";
import { CloudOff, RefreshCw } from "lucide-solid";

// See docs/workspace-sync-semantics.md (extension repo) — the fixed
// vocabulary this draws from. "synced" and legacy-undefined both render
// nothing, matching the activation table's "Dormant" baseline: only the
// exceptional cases draw the eye.
export type SyncStatus =
  "synced" | "syncing" | "offline" | "signed-out" | "limit-reached" | "expired";

const SYNC_COPY: Partial<Record<SyncStatus, string>> = {
  syncing: "Syncing…",
  offline: "Not synced — offline",
  "signed-out": "Not synced — sign in to sync",
  "limit-reached": "Not synced — plan limit reached",
  expired: "Not synced — plan expired",
};

export function SyncBadge(props: { status: SyncStatus | undefined }) {
  const warn = () =>
    props.status === "limit-reached" || props.status === "expired";
  return (
    <Show when={props.status && props.status !== "synced"}>
      <span
        title={SYNC_COPY[props.status!]}
        class={
          "shrink-0 " + (warn() ? "text-warning" : "text-surface-txt-hint")
        }
      >
        <Show
          when={props.status === "syncing"}
          fallback={<CloudOff size={10} />}
        >
          <RefreshCw size={10} class="animate-spin" />
        </Show>
      </span>
    </Show>
  );
}
