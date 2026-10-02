import { createCntxtSupabaseClient } from "@cntxt/supabase";
import { extensionStorage } from "./supabaseStorage";

export const { supabase, supabaseConfigured } = createCntxtSupabaseClient(
  import.meta.env.WXT_SUPABASE_URL,
  import.meta.env.WXT_SUPABASE_PUBLISHABLE_KEY,
  extensionStorage,
);
