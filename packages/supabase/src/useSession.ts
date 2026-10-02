import type {
  AuthChangeEvent,
  Session,
  SupabaseClient,
} from "@supabase/supabase-js";
import { createSignal, onCleanup, onMount } from "solid-js";

// Both apps boot a Solid session signal off supabase-js the same way: read
// the current session once, keep it live via onAuthStateChange, and flip a
// loading flag once the first read resolves. What differs per caller is what
// else happens on sign-in — the extension also refreshes entitlements and
// kicks off a sync pull, the web app does nothing extra — so those stay as
// caller-supplied callbacks instead of being baked in here.
export function useSupabaseSession(
  supabase: SupabaseClient | null,
  options?: {
    // Mirrors the subscription's own first event firing (supabase-js emits
    // "INITIAL_SESSION" the moment onAuthStateChange is registered) — kept
    // separate from onAuthEvent below so a caller can react to "there's
    // already a session on mount" without also matching that native event.
    onInitialSession?: (session: Session) => void;
    onAuthEvent?: (event: AuthChangeEvent, session: Session | null) => void;
  },
) {
  const [session, setSession] = createSignal<Session | null>(null);
  const [authLoading, setAuthLoading] = createSignal(true);

  onMount(() => {
    if (!supabase) {
      setAuthLoading(false);
      return;
    }
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setAuthLoading(false);
      if (data.session) options?.onInitialSession?.(data.session);
    });
    const { data: authListener } = supabase.auth.onAuthStateChange(
      (event, newSession) => {
        setSession(newSession);
        options?.onAuthEvent?.(event, newSession);
      },
    );
    onCleanup(() => authListener.subscription.unsubscribe());
  });

  return { session, authLoading };
}
