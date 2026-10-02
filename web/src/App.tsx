import type { Session } from "@supabase/supabase-js";
import {
  Match,
  Show,
  Switch,
  createSignal,
  onCleanup,
  onMount,
} from "solid-js";
import { supabase, supabaseConfigured } from "./supabase";
import { Login } from "./views/Login";
import { WorkspaceList } from "./views/WorkspaceList";
import { WorkspaceDetail } from "./views/WorkspaceDetail";

type View = { type: "list" } | { type: "detail"; id: string };

function App() {
  const [session, setSession] = createSignal<Session | null>(null);
  const [authLoading, setAuthLoading] = createSignal(true);
  const [view, setView] = createSignal<View>({ type: "list" });

  onMount(() => {
    if (!supabaseConfigured) {
      setAuthLoading(false);
      return;
    }
    supabase!.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setAuthLoading(false);
    });
    const { data: authListener } = supabase!.auth.onAuthStateChange(
      (_event, newSession) => setSession(newSession),
    );
    onCleanup(() => authListener.subscription.unsubscribe());
  });

  async function handleSignOut() {
    await supabase!.auth.signOut();
  }

  return (
    <Show
      when={supabaseConfigured}
      fallback={
        <div class="min-h-screen bg-surface p-8 font-sans text-surface-txt">
          <div class="mx-auto max-w-2xl rounded border border-warning bg-warning/10 p-4 text-sm shadow-[var(--shadow-card)]">
            <p class="font-medium">Supabase isn't configured yet.</p>
            <p class="mt-1">
              Copy <code>web/.env.example</code> to <code>web/.env</code> and
              fill in <code>VITE_SUPABASE_URL</code> /{" "}
              <code>VITE_SUPABASE_PUBLISHABLE_KEY</code>, then restart{" "}
              <code>pnpm dev</code>.
            </p>
          </div>
        </div>
      }
    >
      <Show when={!authLoading()}>
        <Show when={session()} fallback={<Login />}>
          <div class="min-h-screen bg-surface font-sans text-surface-txt">
            <header class="flex h-13 items-center justify-between border-b border-surface-alt2 bg-surface-alt1 px-3.5">
              <span class="font-semibold">cntxt</span>
              <button
                type="button"
                onClick={handleSignOut}
                class="btn btn-sm border border-surface-alt3"
              >
                Sign out
              </button>
            </header>
            <Switch>
              <Match when={view().type === "list"}>
                <WorkspaceList
                  onOpen={(id) => setView({ type: "detail", id })}
                />
              </Match>
              <Match when={view().type === "detail"}>
                <WorkspaceDetail
                  id={(view() as { type: "detail"; id: string }).id}
                  onBack={() => setView({ type: "list" })}
                />
              </Match>
            </Switch>
          </div>
        </Show>
      </Show>
    </Show>
  );
}

export default App;
