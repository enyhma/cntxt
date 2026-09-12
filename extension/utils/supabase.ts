import { createClient } from "@supabase/supabase-js";
import { extensionStorage } from "./supabaseStorage";

// The anon key and URL are public identifiers, not secrets — Postgres RLS
// is what protects data, not keeping these hidden. Still build-time env
// vars (not hardcoded) so local dev and production can point at different
// projects without a code change. See .env.example.
const url = import.meta.env.WXT_SUPABASE_URL;
const anonKey = import.meta.env.WXT_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  throw new Error(
    "Missing WXT_SUPABASE_URL / WXT_SUPABASE_ANON_KEY — copy .env.example to .env and fill them in (see supabase status for local dev values).",
  );
}

export const supabase = createClient(url, anonKey, {
  auth: {
    storage: extensionStorage,
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
  },
});
