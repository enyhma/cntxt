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
import { parseTokensFromRedirectUrl } from "@/utils/oauthRedirect";
import { supabase, supabaseConfigured } from "@/utils/supabase";
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
  const [otpSent, setOtpSent] = createSignal(false);
  const [otpCode, setOtpCode] = createSignal("");
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
    if (supabaseConfigured) {
      const { data } = await supabase!.auth.getSession();
      setSession(data.session);

      const { data: authListener } = supabase!.auth.onAuthStateChange(
        (_event, newSession) => setSession(newSession),
      );
      onCleanup(() => authListener.subscription.unsubscribe());
    }
    setAuthLoading(false);

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

  // Email OTP as a typed code, not a clicked link: a link can't reliably
  // redirect back into an extension page across browsers (Chrome's id can
  // be pinned, but Edge assigns its own unpredictably and Firefox
  // randomizes moz-extension://'s uuid per profile to prevent
  // fingerprinting — see docs/architecture-sync.md). A code typed into the
  // extension's own UI sidesteps all of that: no redirect, no per-browser
  // config.
  async function handleSendCode(e: Event) {
    e.preventDefault();
    setAuthError("");
    const { error } = await supabase!.auth.signInWithOtp({ email: email() });
    if (error) setAuthError(error.message);
    else setOtpSent(true);
  }

  async function handleVerifyCode(e: Event) {
    e.preventDefault();
    setAuthError("");
    const { error } = await supabase!.auth.verifyOtp({
      email: email(),
      token: otpCode(),
      type: "email",
    });
    if (error) setAuthError(error.message);
  }

  // browser.identity.launchWebAuthFlow is the extension-native way to do
  // OAuth: its redirect target (getRedirectURL()) is a reserved URL the
  // browser intercepts before ever loading a page, so the result comes
  // back directly as a return value — chrome-extension://, moz-extension://
  // and their per-browser id problems never enter the picture.
  async function handleGoogleSignIn() {
    setAuthError("");
    const redirectTo = browser.identity.getRedirectURL();
    const { data, error } = await supabase!.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo, skipBrowserRedirect: true },
    });
    if (error) {
      setAuthError(error.message);
      return;
    }
    if (!data.url) {
      setAuthError("Supabase didn't return an OAuth URL.");
      return;
    }

    let resultUrl: string | undefined;
    try {
      resultUrl = await browser.identity.launchWebAuthFlow({
        url: data.url,
        interactive: true,
      });
    } catch {
      // User closed the auth window — not an error worth surfacing.
      return;
    }

    const tokens = parseTokensFromRedirectUrl(resultUrl);
    if (!tokens) {
      setAuthError("Google sign-in didn't return a valid session.");
      return;
    }

    const { error: setSessionError } = await supabase!.auth.setSession({
      access_token: tokens.accessToken,
      refresh_token: tokens.refreshToken,
    });
    if (setSessionError) setAuthError(setSessionError.message);
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

        <Show when={!supabaseConfigured}>
          <div class="rounded border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
            <p class="font-medium">Supabase isn't configured yet.</p>
            <p class="mt-1">
              Copy <code>extension/.env.example</code> to{" "}
              <code>extension/.env</code> and fill in
              <code> WXT_SUPABASE_URL</code> /
              <code> WXT_SUPABASE_ANON_KEY</code>, then restart{" "}
              <code>pnpm dev</code>. Local dev values come from{" "}
              <code>npx supabase status</code> (run <code>supabase start</code>{" "}
              from the repo root first).
            </p>
          </div>
        </Show>

        <Show when={supabaseConfigured && !authLoading()}>
          <Show
            when={session()}
            fallback={
              <div class="rounded border border-gray-200 bg-white p-6">
                <h2 class="mb-4 text-lg font-medium">Sign in to Vistap</h2>
                <Show
                  when={!otpSent()}
                  fallback={
                    <form
                      class="flex flex-col gap-2"
                      onSubmit={handleVerifyCode}
                    >
                      <p class="text-sm text-gray-600">
                        Enter the code sent to {email()}.
                      </p>
                      <input
                        type="text"
                        inputmode="numeric"
                        autocomplete="one-time-code"
                        required
                        placeholder="123456"
                        class="rounded border border-gray-300 px-3 py-2 text-sm"
                        value={otpCode()}
                        onInput={(e) => setOtpCode(e.currentTarget.value)}
                      />
                      <button
                        type="submit"
                        class="rounded bg-blue-600 px-4 py-2 text-sm text-white"
                      >
                        Verify code
                      </button>
                    </form>
                  }
                >
                  <form class="flex flex-col gap-2" onSubmit={handleSendCode}>
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
                      Send sign-in code
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
