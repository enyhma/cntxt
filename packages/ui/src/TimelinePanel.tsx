import { For, Show, type Accessor } from "solid-js";
import { RotateCcw, FolderClosed } from "lucide-solid";
import { GroupDot } from "./GroupDot";

// Inline shapes (not imported from the extension's utils/) — matches
// TrashPanel's own precedent of a minimal structural type, keeping this
// package decoupled from the extension's internal storage schema. Carries
// entityTable/entityId even though this panel only reads entityName/tabs,
// so a caller can pass its real restoreSession(session) straight through
// as onRestoreSession without a narrowing mismatch.
type SessionLeg = {
  entityTable: "groups" | "folders";
  entityId: string;
  entityName: string;
  tabs: Array<{ url: string; title: string }>;
};
type TimelineSession = {
  id: string;
  capturedAt: number;
  windows: SessionLeg[];
};

function timeAgo(ms: number): string {
  const diff = Date.now() - ms;
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export function TimelinePanel(props: {
  archivedGroups: Accessor<
    Array<{ id: string; name: string; color?: string; icon?: string }>
  >;
  archivedFolders: Accessor<
    Array<{ id: string; name: string; color?: string; kind: string }>
  >;
  onUnarchiveGroup: (id: string) => void;
  onUnarchiveFolder: (id: string) => void;
  sessions: Accessor<TimelineSession[]>;
  onRestoreSession: (session: TimelineSession) => void;
  jumpToSessionId?: Accessor<string | undefined>;
  // Sessions (Timeline) is Pro-only — sessions() is simply always empty for
  // Free/Basic (capture is skipped at the source, see
  // extension/utils/sessions.ts), this just makes the empty state explain
  // why instead of reading like a bug.
  proActive?: Accessor<boolean>;
}) {
  const hasArchived = () =>
    props.archivedGroups().length > 0 || props.archivedFolders().length > 0;

  return (
    <div class="flex-1 overflow-y-auto p-6">
      <div class="flex max-w-md flex-col gap-6">
        <div class="flex flex-col gap-3">
          <h2 class="text-base font-semibold">Archived</h2>
          <Show
            when={hasArchived()}
            fallback={
              <p class="text-sm text-surface-txt-hint">Nothing archived.</p>
            }
          >
            <For each={props.archivedFolders()}>
              {(f) => (
                <div class="flex items-center gap-2.5 rounded border border-surface-alt3 bg-surface-alt1 p-2.5 shadow-[var(--shadow-card)]">
                  <FolderClosed
                    size={14}
                    class="shrink-0 text-surface-txt-faint"
                  />
                  <span class="min-w-0 flex-1 truncate text-sm font-medium">
                    {f.name}
                  </span>
                  <button
                    type="button"
                    title="Unarchive"
                    onClick={() => props.onUnarchiveFolder(f.id)}
                    class="btn btn-square btn-sm border border-surface-alt3 bg-surface-alt2"
                  >
                    <RotateCcw size={13} />
                  </button>
                </div>
              )}
            </For>
            <For each={props.archivedGroups()}>
              {(q) => (
                <div class="flex items-center gap-2.5 rounded border border-surface-alt3 bg-surface-alt1 p-2.5 shadow-[var(--shadow-card)]">
                  <GroupDot group={q} />
                  <span class="min-w-0 flex-1 truncate text-sm font-medium">
                    {q.name}
                  </span>
                  <button
                    type="button"
                    title="Unarchive"
                    onClick={() => props.onUnarchiveGroup(q.id)}
                    class="btn btn-square btn-sm border border-surface-alt3 bg-surface-alt2"
                  >
                    <RotateCcw size={13} />
                  </button>
                </div>
              )}
            </For>
          </Show>
        </div>

        <div class="flex flex-col gap-3">
          <h2 class="text-base font-semibold">Sessions</h2>
          <Show
            when={props.sessions().length > 0}
            fallback={
              <p class="text-sm text-surface-txt-hint">
                {props.proActive?.() === false
                  ? "Timeline is a Pro feature — upgrade in Settings to start capturing sessions."
                  : "No sessions captured yet."}
              </p>
            }
          >
            <For each={props.sessions()}>
              {(s) => (
                <div
                  class={
                    "flex flex-col gap-1.5 rounded border p-2.5 shadow-[var(--shadow-card)]" +
                    (props.jumpToSessionId?.() === s.id
                      ? " border-accent bg-surface-alt2"
                      : " border-surface-alt3 bg-surface-alt1")
                  }
                >
                  <div class="flex items-center gap-2.5">
                    <span class="min-w-0 flex-1 truncate text-xs font-mono text-surface-txt-faint">
                      {timeAgo(s.capturedAt)} &middot; {s.windows.length} window
                      {s.windows.length === 1 ? "" : "s"}
                    </span>
                    <button
                      type="button"
                      title="Restore"
                      onClick={() => props.onRestoreSession(s)}
                      class="btn btn-square btn-sm border border-surface-alt3 bg-surface-alt2"
                    >
                      <RotateCcw size={13} />
                    </button>
                  </div>
                  <div class="flex flex-col gap-0.5">
                    <For each={s.windows}>
                      {(w) => (
                        <span class="truncate text-sm">
                          {w.entityName}
                          <span class="text-surface-txt-faint">
                            {" "}
                            &middot; {w.tabs.length} tab
                            {w.tabs.length === 1 ? "" : "s"}
                          </span>
                        </span>
                      )}
                    </For>
                  </div>
                </div>
              )}
            </For>
          </Show>
        </div>
      </div>
    </div>
  );
}
