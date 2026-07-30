"use client";

import { createClient } from "@supabase/supabase-js";
import { publicEnv } from "@/lib/env";

let questRealtimeClient: ReturnType<typeof createClient> | undefined;

export const getQuestRealtimeClient = () => {
  if (!publicEnv.supabasePublishableKey) {
    throw new Error("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY is not configured");
  }

  questRealtimeClient ??= createClient(
    publicEnv.supabaseUrl,
    publicEnv.supabasePublishableKey,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
        detectSessionInUrl: false
      }
    }
  );

  return questRealtimeClient;
};
