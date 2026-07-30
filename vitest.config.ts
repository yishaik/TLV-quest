import { defineConfig } from "vitest/config";

export default defineConfig({
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
