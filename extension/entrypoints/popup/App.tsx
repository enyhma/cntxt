import { createSignal, For, onMount } from "solid-js";
import {
  type Workspace,
  deleteWorkspace,
  getWorkspaces,
  saveWorkspace,
} from "./workspaces";

function App() {
  const [workspaces, setWorkspaces] = createSignal<Workspace[]>([]);
  const [name, setName] = createSignal("");

  onMount(async () => {
    setWorkspaces(await getWorkspaces());
  });

  async function handleSaveAndClose() {
    const workspaceName = name().trim();
    if (!workspaceName) return;

    const tabs = await browser.tabs.query({ currentWindow: true });
    await saveWorkspace({
      id: crypto.randomUUID(),
      name: workspaceName,
      tabs: tabs.map((t) => ({ url: t.url ?? "", title: t.title ?? "" })),
      createdAt: Date.now(),
    });
    setName("");

    const win = await browser.windows.getCurrent();
    if (win.id !== undefined) await browser.windows.remove(win.id);
  }

  async function handleRestore(workspace: Workspace) {
    await browser.windows.create({ url: workspace.tabs.map((t) => t.url) });
  }

  async function handleDelete(id: string) {
    await deleteWorkspace(id);
    setWorkspaces(await getWorkspaces());
  }

  return (
    <div class="w-80 p-4 font-sans">
      <h1 class="mb-3 text-lg font-semibold">Vistap</h1>

      <div class="mb-4 flex gap-2">
        <input
          class="min-w-0 flex-1 rounded border border-gray-300 px-2 py-1 text-sm"
          type="text"
          placeholder="Workspace name"
          value={name()}
          onInput={(e) => setName(e.currentTarget.value)}
          onKeyDown={(e) => e.key === "Enter" && handleSaveAndClose()}
        />
        <button
          class="shrink-0 rounded bg-blue-600 px-3 py-1 text-sm text-white disabled:opacity-50"
          disabled={!name().trim()}
          onClick={handleSaveAndClose}
        >
          Save & close
        </button>
      </div>

      <ul class="flex flex-col gap-2">
        <For each={workspaces()}>
          {(workspace) => (
            <li class="flex items-center justify-between rounded border border-gray-200 px-2 py-1">
              <div>
                <div class="text-sm font-medium">{workspace.name}</div>
                <div class="text-xs text-gray-500">
                  {workspace.tabs.length} tabs
                </div>
              </div>
              <div class="flex gap-1">
                <button
                  class="rounded px-2 py-1 text-xs text-blue-600 hover:bg-blue-50"
                  onClick={() => handleRestore(workspace)}
                >
                  Restore
                </button>
                <button
                  class="rounded px-2 py-1 text-xs text-red-600 hover:bg-red-50"
                  onClick={() => handleDelete(workspace.id)}
                >
                  Delete
                </button>
              </div>
            </li>
          )}
        </For>
      </ul>
    </div>
  );
}

export default App;
