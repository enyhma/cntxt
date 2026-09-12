import { createSignal, For, onMount } from "solid-js";
import {
  type Workspace,
  deleteWorkspace,
  getWorkspaces,
  saveWorkspace,
} from "./workspaces";

const DASHBOARD_URL = browser.runtime.getURL("/dashboard.html");

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
    const tabsToSave = tabs.filter((t) => t.url !== DASHBOARD_URL);
    await saveWorkspace({
      id: crypto.randomUUID(),
      name: workspaceName,
      tabs: tabsToSave.map((t) => ({
        url: t.url ?? "",
        title: t.title ?? "",
      })),
      createdAt: Date.now(),
    });
    setName("");

    const idsToClose = tabsToSave
      .map((t) => t.id)
      .filter((id): id is number => id !== undefined);
    if (idsToClose.length > 0) await browser.tabs.remove(idsToClose);
  }

  async function handleRestore(workspace: Workspace) {
    const win = await browser.windows.create({
      url: workspace.tabs.map((t) => t.url),
    });
    if (win?.id !== undefined) {
      await browser.tabs.create({
        windowId: win.id,
        url: DASHBOARD_URL,
        pinned: true,
        index: 0,
      });
    }
  }

  async function handleDelete(id: string) {
    await deleteWorkspace(id);
    setWorkspaces(await getWorkspaces());
  }

  return (
    <div class="min-h-screen bg-gray-50 p-8 font-sans">
      <div class="mx-auto max-w-2xl">
        <h1 class="mb-6 text-2xl font-semibold">Vistap</h1>

        <div class="mb-6 flex gap-2">
          <input
            class="min-w-0 flex-1 rounded border border-gray-300 px-3 py-2 text-sm"
            type="text"
            placeholder="Workspace name"
            value={name()}
            onInput={(e) => setName(e.currentTarget.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSaveAndClose()}
          />
          <button
            class="shrink-0 rounded bg-blue-600 px-4 py-2 text-sm text-white disabled:opacity-50"
            disabled={!name().trim()}
            onClick={handleSaveAndClose}
          >
            Save & close tabs
          </button>
        </div>

        <ul class="flex flex-col gap-2">
          <For each={workspaces()}>
            {(workspace) => (
              <li class="flex items-center justify-between rounded border border-gray-200 bg-white px-3 py-2">
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
    </div>
  );
}

export default App;
