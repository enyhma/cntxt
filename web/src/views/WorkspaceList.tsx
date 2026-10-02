import { For, Show, createResource } from "solid-js";
import { WorkspaceDot } from "@cntxt/ui";
import { listWorkspaces } from "../workspaces";

// Deliberately does not reuse @cntxt/ui's WorkspaceRow — its prop surface
// (isCurrent, openElsewhere, onOpenAll, onDisconnect, ...) is shaped by
// extension-only live-window concepts with no column backing them
// server-side (color/icon/syncStatus aren't even in the workspaces table
// read here). Only WorkspaceDot (pure id/color/icon -> a colored dot)
// genuinely fits.
export function WorkspaceList(props: { onOpen: (id: string) => void }) {
  const [workspaces] = createResource(async () => {
    const { data, error } = await listWorkspaces();
    if (error) throw error;
    return data ?? [];
  });

  return (
    <div class="mx-auto max-w-2xl p-6">
      <h1 class="mb-4 text-lg font-semibold">Your workspaces</h1>
      <Show when={workspaces()} fallback={<p>Loading…</p>}>
        {(list) => (
          <Show
            when={list().length > 0}
            fallback={
              <p class="text-sm text-surface-txt-hint">No workspaces yet.</p>
            }
          >
            <div class="flex flex-col gap-1.5">
              <For each={list()}>
                {(w) => (
                  <button
                    type="button"
                    onClick={() => props.onOpen(w.id)}
                    class="flex items-center gap-2.5 rounded border border-surface-alt3 bg-surface-alt1 p-3 text-left shadow-[var(--shadow-card)] hover:bg-surface-alt2"
                  >
                    <WorkspaceDot workspace={{ id: w.id }} />
                    <span class="min-w-0 flex-1 truncate text-sm font-medium">
                      {w.name}
                    </span>
                    <span class="font-mono text-[11px] text-surface-txt-faint">
                      {w.tabs.length} tabs
                    </span>
                    <span class="font-mono text-[11px] text-surface-txt-faint">
                      {new Date(w.updated_at).toLocaleString()}
                    </span>
                  </button>
                )}
              </For>
            </div>
          </Show>
        )}
      </Show>
    </div>
  );
}
