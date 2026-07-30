import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { requirePublicEnvValue } from "../lib/env";

describe("environment configuration", () => {
  it("requires public Supabase values", () => {
    expect(() =>
      requirePublicEnvValue("NEXT_PUBLIC_SUPABASE_URL", undefined, false)
    ).toThrow("Missing required environment variable");
    expect(
      requirePublicEnvValue(
        "NEXT_PUBLIC_SUPABASE_URL",
        " https://example.supabase.co ",
        false
      )
    ).toBe("https://example.supabase.co");
  });

  it("rejects committed placeholders in production", () => {
    expect(() =>
      requirePublicEnvValue(
        "NEXT_PUBLIC_SUPABASE_URL",
        "https://your-project-ref.supabase.co",
        true
      )
    ).toThrow("Placeholder value is not allowed in production");
    expect(() =>
      requirePublicEnvValue(
        "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
        "sb_publishable_replace_me",
        true
      )
    ).toThrow("Placeholder value is not allowed in production");
    expect(() =>
      requirePublicEnvValue(
        "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
        "sb_publishable_test",
        true
      )
    ).toThrow("Placeholder value is not allowed in production");
  });

  it("keeps production configuration out of tracked source", () => {
    const envSource = readFileSync("lib/env.ts", "utf8");
    expect(envSource).not.toMatch(/[a-z0-9]{20}\.supabase\.co/);
    expect(envSource).toContain(
      'requirePublicEnvValue(\n    "NEXT_PUBLIC_SUPABASE_URL"'
    );
    expect(envSource).toContain(
      'requirePublicEnvValue(\n    "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"'
    );
  });
});
