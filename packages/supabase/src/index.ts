import {
  createClient,
  type SupabaseClientOptions,
} from "@supabase/supabase-js";

type AuthStorage = NonNullable<
  NonNullable<SupabaseClientOptions<"public">["auth"]>["storage"]
>;

// The publishable key and URL are public identifiers, not secrets — Postgres
// RLS is what protects data, not keeping these hidden. Callers still read
// them from their own build-time env vars (VITE_ vs WXT_ prefixes differ per
// bundler) so local dev and production can point at different projects
// without a code change.
//
// `storage` is the one real difference between callers: a plain web tab has
// a real window.localStorage (supabase-js's default, pass nothing); the
// extension has none and adapts browser.storage.local instead (see
// extension/utils/supabaseStorage.ts).
export function createCntxtSupabaseClient(
  url: string | undefined,
  publishableKey: string | undefined,
  authStorage?: AuthStorage,
) {
  const configured = Boolean(url && publishableKey);
  const supabase = configured
    ? createClient(url!, publishableKey!, {
        auth: {
          storage: authStorage,
          persistSession: true,
          autoRefreshToken: true,
          // Both callers' entry page is the redirect target for the
          // magic-link and Google OAuth flows — this has to be true so
          // supabase-js reads the session out of the redirect URL instead
          // of silently ignoring it.
          detectSessionInUrl: true,
        },
      })
    : null;
  return { supabase, supabaseConfigured: configured };
}

export { useSupabaseSession } from "./useSession";
