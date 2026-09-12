import { useMachine } from "@xstate/solid";
import type { Session } from "@supabase/supabase-js";
import {
  createEffect,
  createSignal,
  For,
  Show,
  onCleanup,
  onMount,
  untrack,
} from "solid-js";
import { ensureWorkspaceForWindow } from "@/utils/attach";
import { restoreMachine } from "@/utils/restoreMachine";
import { getWindowWorkspaceMap } from "@/utils/session";
import {
  type Settings,
  type StartupBehavior,
  getSettings,
  updateSettings,
} from "@/utils/settings";
import { supabase } from "@/utils/supabase";
import {
  type Workspace,
  deleteWorkspace,
  getWorkspaces,
  updateWorkspace,
} from "@/utils/workspaces";

function App() {
  const [workspaces, setWorkspaces] = createSignal<Workspace[]>([]);
  const [windowMap, setWindowMap] = createSignal<Record<number, string>>({});
  const [myWindowId, setMyWindowId] = createSignal<number>();
  const [name, setName] = createSignal("");
  const [startupBehavior, setStartupBehavior] =
    createSignal<StartupBehavior>("none");
  const [state, send] = useMachine(restoreMachine);

  const [session, setSession] = createSignal<Session | null>(null);
  const [authLoading, setAuthLoading] = createSignal(true);
  const [email, setEmail] = createSignal("");
  const [magicLinkSent, setMagicLinkSent] = createSignal(false);
  const [authError, setAuthError] = createSignal("");

  const openIds = () => new Set(Object.values(windowMap()));
  const currentId = () => {
    const windowId = myWindowId();
    return windowId !== undefined ? windowMap()[windowId] : undefined;
  };
  const current = () => workspaces().find((w) => w.id === currentId());
  const savedWorkspaces = () =>
    workspaces().filter((w) => w.id !== currentId() && !openIds().has(w.id));

  async function refresh() {
    setWorkspaces(await getWorkspaces());
    setWindowMap(await getWindowWorkspaceMap());
  }

  // Reseed the rename input only when switching to a different workspace,
  // not on every routine refresh (which would clobber an in-progress edit).
  createEffect(() => {
    const id = currentId();
    const workspace = untrack(() => workspaces().find((w) => w.id === id));
    if (workspace) setName(workspace.name);
  });

  onMount(async () => {
    const { data } = await supabase.auth.getSession();
    setSession(data.session);
    setAuthLoading(false);

    const { data: authListener } = supabase.auth.onAuthStateChange(
      (_event, newSession) => setSession(newSession),
    );
    onCleanup(() => authListener.subscription.unsubscribe());

    const win = await browser.windows.getCurrent();
    if (win.id !== undefined) {
      setMyWindowId(win.id);
      await ensureWorkspaceForWindow(win.id);
    }
    await refresh();

    const settings: Settings = await getSettings();
    setStartupBehavior(settings.startupBehavior);

    const handleStorageChange = () => refresh();
    browser.storage.onChanged.addListener(handleStorageChange);
    onCleanup(() =>
      browser.storage.onChanged.removeListener(handleStorageChange),
    );
  });

  async function handleMagicLink(e: Event) {
    e.preventDefault();
    setAuthError("");
    const { error } = await supabase.auth.signInWithOtp({ email: email() });
    if (error) setAuthError(error.message);
    else setMagicLinkSent(true);
  }

  async function handleGoogleSignIn() {
    setAuthError("");
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
    });
    if (error) setAuthError(error.message);
  }

  async function handleRename() {
    const id = currentId();
    const trimmed = name().trim();
    if (!id || !trimmed) return;
    await updateWorkspace(id, { name: trimmed });
    await refresh();
  }

  function handleCloseTabs() {
    send({ type: "CLOSE_TABS" });
  }

  function handleRestore(workspace: Workspace) {
    send({ type: "RESTORE", workspace });
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

        <Show when={!authLoading()}>
          <Show
            when={session()}
            fallback={
              <div class="rounded border border-gray-200 bg-white p-6">
                <h2 class="mb-4 text-lg font-medium">Sign in to Vistap</h2>
                <Show
                  when={!magicLinkSent()}
                  fallback={
                    <p class="text-sm text-gray-600">
                      Check {email()} for a sign-in link.
                    </p>
                  }
                >
                  <form class="flex flex-col gap-2" onSubmit={handleMagicLink}>
                    <input
                      type="email"
                      required
                      placeholder="you@example.com"
                      class="rounded border border-gray-300 px-3 py-2 text-sm"
                      value={email()}
                      onInput={(e) => setEmail(e.currentTarget.value)}
                    />
                    <button
                      type="submit"
                      class="rounded bg-blue-600 px-4 py-2 text-sm text-white"
                    >
                      Send magic link
                    </button>
                  </form>
                  <div class="my-3 text-center text-xs text-gray-400">or</div>
                  <button
                    onClick={handleGoogleSignIn}
                    class="w-full rounded border border-gray-300 px-4 py-2 text-sm"
                  >
                    Continue with Google
                  </button>
                </Show>
                <Show when={authError()}>
                  <p class="mt-3 text-sm text-red-600">{authError()}</p>
                </Show>
              </div>
            }
          >
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
                      class="shrink-0 rounded bg-blue-600 px-4 py-2 text-sm text-white disabled:opacity-50"
                      disabled={!state.matches("idle")}
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
                        class="rounded px-2 py-1 text-xs text-blue-600 hover:bg-blue-50 disabled:opacity-50"
                        disabled={!state.matches("idle")}
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
          </Show>
        </Show>
      </div>
    </div>
  );
}

export default App;
