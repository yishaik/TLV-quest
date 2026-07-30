import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

export default defineConfig({
  // Mirror the tsconfig "@/*" path alias. Without it, any module that imports
  // via "@/lib/..." — which is most of lib/ — is untestable: the suite fails to
  // resolve the package rather than reporting a real failure.
  resolve: {
    alias: {
      "@": fileURLToPath(new URL(".", import.meta.url))
    }
  },
  test: {
    environment: "node",
    env: {
      NEXT_PUBLIC_SUPABASE_URL: "https://your-project-ref.supabase.co",
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test"
    },
    include: ["tests/**/*.test.ts"],
    coverage: {
      reporter: ["text", "json-summary"]
    }
  }
});
