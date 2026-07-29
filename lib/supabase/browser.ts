"use client";

import {
  createClient,
  type AuthChangeEvent,
  type Session
} from "@supabase/supabase-js";
import { publicEnv } from "@/lib/env";

type RawBrowserClient = ReturnType<typeof createClient>;
type RawAuth = RawBrowserClient["auth"];
type RawAuthStateResult = ReturnType<RawAuth["onAuthStateChange"]>;
type RawSubscription = RawAuthStateResult["data"]["subscription"];
type BrowserClient = Omit<RawBrowserClient, "auth"> & {
  auth: Omit<RawAuth, "onAuthStateChange"> & {
    onAuthStateChange: (
      callback: (event: AuthChangeEvent, session: Session | null) => void | Promise<void>
    ) => Omit<RawAuthStateResult, "data"> & {
      data: Omit<RawAuthStateResult["data"], "subscription"> & {
        subscription: Omit<RawSubscription, "unsubscribe"> & {
          unsubscribe: () => undefined;
        };
      };
    };
  };
};

let browserClient: RawBrowserClient | undefined;

export const getBrowserClient = (): BrowserClient => {
  if (!publicEnv.supabasePublishableKey) {
    throw new Error("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY is not configured");
  }

  browserClient ??= createClient(
    publicEnv.supabaseUrl,
    publicEnv.supabasePublishableKey
  );

  return browserClient as BrowserClient;
};
