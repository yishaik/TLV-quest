import "server-only";

import { createClient } from "@supabase/supabase-js";
import { getServerEnv, publicEnv } from "@/lib/env";

export const createAdminClient = () =>
  createClient(publicEnv.supabaseUrl, getServerEnv().supabaseSecretKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false
    }
  });
