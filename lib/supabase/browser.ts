"use client";

import { createClient } from "@supabase/supabase-js";
import { publicEnv } from "@/lib/env";

let browserClient: ReturnType<typeof createClient> | undefined;

export const getBrowserClient = () => {
  if (!publicEnv.supabasePublishableKey) {
    throw new Error("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY is not configured");
  }

  browserClient ??= createClient(
    publicEnv.supabaseUrl,
    publicEnv.supabasePublishableKey
  );

  return browserClient;
};
