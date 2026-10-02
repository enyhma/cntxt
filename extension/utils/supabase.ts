import { createClient } from "@supabase/supabase-js";
import { extensionStorage } from "./supabaseStorage";

// The publishable key and URL are public identifiers, not secrets —
// Postgres RLS is what protects data, not keeping these hidden. Still
// build-time env vars (not hardcoded) so local dev and production can
// point at different projects without a code change. See .env.example.
const url = import.meta.env.WXT_SUPABASE_URL;
const publishableKey = import.meta.env.WXT_SUPABASE_PUBLISHABLE_KEY;

// Deliberately not a top-level throw: that would crash the whole module
// (and with it, the entire dashboard render) before anything reaches the
// screen — a blank page with the actual reason visible only in devtools,
// which isn't "failing loudly" so much as failing invisibly. App.tsx
// checks this flag and renders the missing-config message on the page
// instead.
export const supabaseConfigured = Boolean(url && publishableKey);

export const supabase = supabaseConfigured
  ? createClient(url!, publishableKey!, {
      auth: {
        storage: extensionStorage,
        persistSession: true,
        autoRefreshToken: true,
        // The dashboard page IS the redirect target for magic-link/OAuth
        // sign-in (see DASHBOARD_URL usage in App.tsx) — this has to be
        // true so supabase-js reads the access_token out of the redirect
        // URL's hash instead of silently doing nothing with it.
        detectSessionInUrl: true,
      },
    })
  : null;
