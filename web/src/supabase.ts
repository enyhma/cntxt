import { createCntxtSupabaseClient } from "@cntxt/supabase";

// No custom `storage` adapter (unlike the extension's
// utils/supabaseStorage.ts) — a plain browser tab has a real
// window.localStorage, which is supabase-js's default.
export const { supabase, supabaseConfigured } = createCntxtSupabaseClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
);
