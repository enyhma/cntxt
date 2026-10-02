import { createClient } from "@supabase/supabase-js";

// The publishable key and URL are public identifiers, not secrets —
// Postgres RLS is what protects data, not keeping these hidden. Still
// build-time env vars (not hardcoded) so local dev and production can
// point at different projects without a code change. See .env.example.
const url = import.meta.env.VITE_SUPABASE_URL;
const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

// Deliberately not a top-level throw: that would crash the whole module
// (and with it, the entire app's render) before anything reaches the
// screen. App.tsx checks this flag and renders a missing-config message
// instead.
export const supabaseConfigured = Boolean(url && publishableKey);

// No custom `storage` adapter (unlike the extension's
// utils/supabaseStorage.ts) — a plain browser tab has a real
// window.localStorage, which is supabase-js's default.
export const supabase = supabaseConfigured
  ? createClient(url!, publishableKey!, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        // This page is the redirect target for both the magic-link and
        // Google OAuth flows (see Login.tsx) — true so supabase-js reads
        // the session out of the redirect URL instead of ignoring it.
        detectSessionInUrl: true,
      },
    })
  : null;
