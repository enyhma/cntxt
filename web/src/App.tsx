import { Match, Show, Switch, createSignal } from "solid-js";
import { useSupabaseSession } from "@cntxt/supabase";
import { ConfigWarning } from "@cntxt/ui";
import { supabase, supabaseConfigured } from "./supabase";
import { Login } from "./views/Login";
import { WorkspaceList } from "./views/WorkspaceList";
import { WorkspaceDetail } from "./views/WorkspaceDetail";

type View = { type: "list" } | { type: "detail"; id: string };

function App() {
  const { session, authLoading } = useSupabaseSession(supabase);
  const [view, setView] = createSignal<View>({ type: "list" });

  async function handleSignOut() {
    await supabase!.auth.signOut();
  }

  return (
    <Show
      when={supabaseConfigured}
      fallback={
        <ConfigWarning>
          Copy <code>web/.env.example</code> to <code>web/.env</code> and fill
          in <code>VITE_SUPABASE_URL</code> /{" "}
          <code>VITE_SUPABASE_PUBLISHABLE_KEY</code>, then restart{" "}
          <code>pnpm dev</code>.
        </ConfigWarning>
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
