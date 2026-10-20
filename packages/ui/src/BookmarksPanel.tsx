import { For, Show, type Accessor } from "solid-js";
import { Link as LinkIcon, X } from "lucide-solid";

// Inline shape, not imported from extension/utils/resources.ts — same
// package-decoupling precedent as TimelinePanel's SessionLeg: this package
// stays ignorant of the extension's storage schema, only the structural
// shape it actually renders. A bookmark that has neither a url nor a note
// doesn't happen in practice (resources.ts always sets one), but the type
// doesn't need to assert that here.
type Bookmark = {
  id: string;
  url?: string;
  note?: string;
  folderId?: string;
};

// The flat, global list of every Project/Area-scoped Resource across the
// account — pulled out of App.tsx so a non-extension caller (web/'s
// standalone dashboard) can render the same list without re-implementing
// it. Bookmarks are ungated by plan (free for every tier), so unlike
// TimelinePanel/AutomationsPanel there's no proActive prop here.
export function BookmarksPanel(props: {
  bookmarks: Accessor<Bookmark[]>;
  folderNameFor: (id?: string) => string | undefined;
  onDelete: (id: string) => void;
}) {
  return (
    <div class="flex-1 overflow-y-auto p-6">
      <div class="flex max-w-md flex-col gap-3">
        <h2 class="text-base font-semibold">Bookmarks</h2>
        <Show
          when={props.bookmarks().length > 0}
          fallback={
            <p class="text-sm text-surface-txt-hint">No bookmarks yet.</p>
          }
        >
          <section class="overflow-hidden rounded border border-surface-alt2 bg-surface-alt1 shadow-[var(--shadow-card)]">
            <For each={props.bookmarks()}>
              {(r) => (
                <div class="group flex items-center gap-2.5 border-b border-surface-alt2 px-3.5 py-2.5 last:border-b-0">
                  <LinkIcon size={13} class="shrink-0 text-surface-txt-faint" />
                  <Show
                    when={r.url}
                    fallback={
                      <span class="min-w-0 flex-1 truncate text-sm">
                        {r.note}
                      </span>
                    }
                  >
                    <a
                      href={r.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      class="min-w-0 flex-1 truncate text-sm hover:underline"
                    >
                      {r.note || r.url}
                    </a>
                  </Show>
                  <span class="max-w-[30%] shrink-0 truncate font-mono text-[11px] text-surface-txt-faint">
                    {props.folderNameFor(r.folderId)}
                  </span>
                  <button
                    type="button"
                    title="Remove"
                    onClick={() => props.onDelete(r.id)}
                    class="btn btn-square btn-ghost btn-xs shrink-0 text-surface-txt-hint opacity-0 group-hover:opacity-100 hover:text-danger focus-visible:opacity-100"
                  >
                    <X size={11} />
                  </button>
                </div>
              )}
            </For>
          </section>
        </Show>
      </div>
    </div>
  );
}
