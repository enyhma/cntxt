import { For, Show, createResource, createSignal } from "solid-js";
import { TabRow } from "@cntxt/ui";
import { getWorkspace } from "../workspaces";
import { addResource, deleteResource, listResources } from "../resources";

export function WorkspaceDetail(props: { id: string; onBack: () => void }) {
  const [workspace] = createResource(
    () => props.id,
    async (id) => {
      const { data, error } = await getWorkspace(id);
      if (error) throw error;
      return data;
    },
  );
  const [resources, { refetch }] = createResource(
    () => props.id,
    async (id) => {
      const { data, error } = await listResources(id);
      if (error) throw error;
      return data ?? [];
    },
  );

  const [url, setUrl] = createSignal("");
  const [note, setNote] = createSignal("");

  async function handleAdd(e: Event) {
    e.preventDefault();
    if (!url().trim()) return;
    await addResource(props.id, url().trim(), note().trim());
    setUrl("");
    setNote("");
    await refetch();
  }

  async function handleDelete(id: string) {
    await deleteResource(id);
    await refetch();
  }

  return (
    <div class="mx-auto max-w-2xl p-6">
      <button
        type="button"
        onClick={props.onBack}
        class="btn btn-sm mb-4 border border-surface-alt3"
      >
        ← Back
      </button>

      <Show when={workspace()} fallback={<p>Loading…</p>}>
        {(w) => (
          <>
            <h1 class="mb-3 text-lg font-semibold">{w().name}</h1>

            <h2 class="mb-1.5 font-mono text-[11px] tracking-wider text-surface-txt-faint">
              TABS
            </h2>
            <Show
              when={w().tabs.length > 0}
              fallback={
                <p class="mb-5 text-sm text-surface-txt-hint">
                  No tabs in this workspace.
                </p>
              }
            >
              <section class="mb-5 overflow-hidden rounded border border-surface-alt2 bg-surface-alt1 shadow-[var(--shadow-card)]">
                <For each={w().tabs}>
                  {(tab, i) => (
                    <TabRow
                      tab={tab}
                      index={i()}
                      selected={false}
                      selectable={false}
                      onToggle={() => {}}
                      onOpen={() => window.open(tab.url, "_blank")}
                    />
                  )}
                </For>
              </section>
            </Show>
          </>
        )}
      </Show>

      <h2 class="mb-1.5 font-mono text-[11px] tracking-wider text-surface-txt-faint">
        LINKS
      </h2>
      <Show when={resources()}>
        {(list) => (
          <div class="mb-3 flex flex-col gap-1.5">
            <For each={list()}>
              {(r) => (
                <div class="flex items-center gap-2.5 rounded border border-surface-alt3 bg-surface-alt1 p-2.5 shadow-[var(--shadow-card)]">
                  <div class="flex min-w-0 flex-1 flex-col">
                    <a
                      href={r.url ?? "#"}
                      target="_blank"
                      rel="noopener noreferrer"
                      class="truncate text-sm text-accent underline"
                    >
                      {r.url}
                    </a>
                    <Show when={r.note}>
                      <span class="truncate text-xs text-surface-txt-hint">
                        {r.note}
                      </span>
                    </Show>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleDelete(r.id)}
                    class="btn btn-square btn-sm border border-surface-alt3 text-danger"
                  >
                    ✕
                  </button>
                </div>
              )}
            </For>
            <Show when={list().length === 0}>
              <p class="text-sm text-surface-txt-hint">No links yet.</p>
            </Show>
          </div>
        )}
      </Show>

      <form class="flex flex-col gap-2" onSubmit={handleAdd}>
        <input
          type="url"
          required
          placeholder="https://…"
          class="input bg-surface-alt2"
          value={url()}
          onInput={(e) => setUrl(e.currentTarget.value)}
        />
        <input
          type="text"
          placeholder="Note (optional)"
          class="input bg-surface-alt2"
          value={note()}
          onInput={(e) => setNote(e.currentTarget.value)}
        />
        <button
          type="submit"
          class="btn border-none bg-accent text-accent-txt hover:bg-accent-alt1"
        >
          Add link
        </button>
      </form>
    </div>
  );
}
