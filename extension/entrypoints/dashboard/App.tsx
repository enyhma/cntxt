import { createSignal, For, Show, onMount } from "solid-js";
import { ensureWorkspaceForWindow } from "@/utils/attach";
import { getWindowWorkspaceMap, setWindowWorkspace } from "@/utils/session";
import {
  type Settings,
  type StartupBehavior,
  getSettings,
  updateSettings,
} from "@/utils/settings";
import { DASHBOARD_URL } from "@/utils/tabs";
import {
  type Workspace,
  deleteWorkspace,
  getWorkspaces,
  updateWorkspace,
} from "@/utils/workspaces";

function App() {
  const [workspaces, setWorkspaces] = createSignal<Workspace[]>([]);
  const [openIds, setOpenIds] = createSignal<Set<string>>(new Set());
  const [currentId, setCurrentId] = createSignal<string>();
  const [name, setName] = createSignal("");
  const [startupBehavior, setStartupBehavior] =
    createSignal<StartupBehavior>("none");

  const current = () => workspaces().find((w) => w.id === currentId());
  const savedWorkspaces = () =>
    workspaces().filter((w) => w.id !== currentId() && !openIds().has(w.id));

  async function refresh() {
    setWorkspaces(await getWorkspaces());
    setOpenIds(new Set(Object.values(await getWindowWorkspaceMap())));
  }

  onMount(async () => {
    const win = await browser.windows.getCurrent();
    if (win.id !== undefined) {
      setCurrentId(await ensureWorkspaceForWindow(win.id));
    }
    await refresh();
    const currentWorkspace = current();
    if (currentWorkspace) setName(currentWorkspace.name);

    const settings: Settings = await getSettings();
    setStartupBehavior(settings.startupBehavior);
  });

  async function handleRename() {
    const id = currentId();
    const trimmed = name().trim();
    if (!id || !trimmed) return;
    await updateWorkspace(id, { name: trimmed });
    await refresh();
  }

  async function handleCloseTabs() {
    const win = await browser.windows.getCurrent();
    if (win.id === undefined) return;
    const tabs = await browser.tabs.query({ windowId: win.id });
    const idsToClose = tabs
      .filter((t) => t.url !== DASHBOARD_URL)
      .map((t) => t.id)
      .filter((id): id is number => id !== undefined);
    if (idsToClose.length > 0) await browser.tabs.remove(idsToClose);
  }

  async function handleRestore(workspace: Workspace) {
    const win = await browser.windows.getCurrent();
    if (win.id === undefined) return;

    const tabs = await browser.tabs.query({ windowId: win.id });
    const idsToClose = tabs
      .filter((t) => t.url !== DASHBOARD_URL)
      .map((t) => t.id)
      .filter((id): id is number => id !== undefined);

    await setWindowWorkspace(win.id, workspace.id);
    if (idsToClose.length > 0) await browser.tabs.remove(idsToClose);
    for (const tab of workspace.tabs) {
      await browser.tabs.create({ windowId: win.id, url: tab.url });
    }

    setCurrentId(workspace.id);
    setName(workspace.name);
    await refresh();
  }

  async function handleDelete(id: string) {
    await deleteWorkspace(id);
    await refresh();
  }

  async function handleStartupBehaviorChange(value: StartupBehavior) {
    setStartupBehavior(value);
    await updateSettings({ startupBehavior: value });
  }

  return (
    <div class="min-h-screen bg-gray-50 p-8 font-sans">
      <div class="mx-auto max-w-2xl">
        <h1 class="mb-6 text-2xl font-semibold">Vistap</h1>

        <Show when={current()}>
          {(workspace) => (
            <div class="mb-6 rounded border border-gray-200 bg-white p-3">
              <div class="mb-2 flex gap-2">
                <input
                  class="min-w-0 flex-1 rounded border border-gray-300 px-3 py-2 text-sm"
                  type="text"
                  value={name()}
                  onInput={(e) => setName(e.currentTarget.value)}
                  onBlur={handleRename}
                  onKeyDown={(e) => e.key === "Enter" && handleRename()}
                />
                <button
                  class="shrink-0 rounded bg-blue-600 px-4 py-2 text-sm text-white"
                  onClick={handleCloseTabs}
                >
                  Close all tabs
                </button>
              </div>
              <div class="text-xs text-gray-500">
                {workspace().tabs.length} tabs synced
              </div>
            </div>
          )}
        </Show>

        <div class="mb-6 flex items-center gap-2 text-sm">
          <label for="startup-behavior" class="text-gray-600">
            On browser start:
          </label>
          <select
            id="startup-behavior"
            class="rounded border border-gray-300 px-2 py-1"
            value={startupBehavior()}
            onChange={(e) =>
              handleStartupBehaviorChange(
                e.currentTarget.value as StartupBehavior,
              )
            }
          >
            <option value="none">Start fresh</option>
            <option value="lastUsed">Resume last used workspace</option>
          </select>
        </div>

        <ul class="flex flex-col gap-2">
          <For each={savedWorkspaces()}>
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
