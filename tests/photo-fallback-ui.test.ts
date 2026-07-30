import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const safetyNet = readFileSync(
  "components/QuestRuntimeSafetyNet.tsx",
  "utf8"
);
const safetyNetStyles = readFileSync(
  "components/QuestRuntimeSafetyNet.module.css",
  "utf8"
);
const player = readFileSync("components/PremiumQuestPlayer.tsx", "utf8");
const runtimeEvents = readFileSync("lib/quest-runtime-events.ts", "utf8");

describe("non-blocking photo fallback controls", () => {
  it("supports compact, expanded, and checkpoint-scoped dismissed states", () => {
    expect(safetyNet).toContain(
      'type FallbackMode = "minimized" | "expanded" | "dismissed"'
    );
    expect(safetyNet).toContain("fallbackStorageKey(token, checkpointSlug)");
    expect(safetyNet).toContain("window.sessionStorage.setItem");
    expect(safetyNet).toContain("previousCheckpointSlugRef");
    expect(safetyNet).toContain('aria-controls="photo-fallback-panel"');
  });

  it("restores focus and supports Escape without presenting a modal", () => {
    expect(safetyNet).toContain('event.key !== "Escape"');
    expect(safetyNet).toContain("minimizedButtonRef.current?.focus()");
    expect(safetyNet).toContain("launcherButtonRef.current?.focus()");
    expect(safetyNet).toContain('role="region"');
    expect(safetyNet).not.toContain('aria-modal="true"');
  });

  it("turns prerequisite failures into direct actions", () => {
    expect(safetyNet).toContain('"location_verification_required"');
    expect(safetyNet).toContain('"quest-location-verify"');
    expect(safetyNet).toContain("target.click()");
    expect(player).toContain('id="quest-location-verify"');
  });

  it("hides or minimizes fallback UI around photo retries", () => {
    expect(runtimeEvents).toContain("tlvquest:photo-retry");
    expect(runtimeEvents).toContain("tlvquest:photo-approved");
    expect(player).toContain("announcePhotoRetry");
    expect(player).toContain("announcePhotoApproved");
    expect(safetyNet).toContain("setResolvedFallbackSlug(checkpointSlug)");
  });

  it("accounts for the mobile dock, safe areas, and dynamic keyboard height", () => {
    expect(safetyNetStyles).toContain("env(safe-area-inset-bottom)");
    expect(safetyNetStyles).toContain("100dvh");
    expect(safetyNetStyles).toContain("@media (max-width: 350px)");
    expect(safetyNetStyles).toContain("overscroll-behavior: contain");
  });
});
