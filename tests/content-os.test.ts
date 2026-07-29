import { describe, expect, it } from "vitest";
import {
  buildContentValidationReport,
  type ContentCheckpoint,
  type ContentHealth
} from "../lib/content-os";

const checkpoint = (
  overrides: Partial<ContentCheckpoint> = {}
): ContentCheckpoint => ({
  id: "checkpoint-1",
  template_id: "template-1",
  version: 2,
  slug: "port-origin",
  sequence_no: 1,
  kind: "text",
  latitude: 32.0965,
  longitude: 34.7742,
  radius_meters: 100,
  accessibility: { field_verification_required: true },
  config: {
    field_verification_required: true,
    content: {
      he: { title: "האות הראשון", prompt: "מצאו את השנה" },
      en: { title: "The first signal", prompt: "Find the year" }
    }
  },
  is_optional: false,
  is_active: true,
  ...overrides
});

const verifiedHealth = (checkpointId: string): ContentHealth => ({
  checkpoint_id: checkpointId,
  status: "verified",
  checklist: { signageVisible: true, accessClear: true, safetyOk: true },
  notes: null,
  last_checked_at: "2026-07-29T12:00:00.000Z",
  verified_at: "2026-07-29T12:00:00.000Z",
  verified_by: "admin@example.com",
  updated_at: "2026-07-29T12:00:00.000Z",
  updated_by: "admin@example.com"
});

describe("content operating system publish gates", () => {
  it("accepts a bilingual route with one final verified finale", () => {
    const first = checkpoint();
    const finale = checkpoint({
      id: "checkpoint-2",
      slug: "lighthouse-finale",
      sequence_no: 2,
      kind: "finale"
    });
    const health = new Map([
      [first.id, verifiedHealth(first.id)],
      [finale.id, verifiedHealth(finale.id)]
    ]);

    const report = buildContentValidationReport({
      checkpoints: [first, finale],
      healthByCheckpoint: health
    });

    expect(report.ok).toBe(true);
    expect(report.errors).toEqual([]);
    expect(report.unverifiedCount).toBe(0);
  });

  it("blocks publishing when bilingual content is incomplete", () => {
    const first = checkpoint({
      config: {
        field_verification_required: false,
        content: {
          he: { title: "האות הראשון", prompt: "מצאו את השנה" },
          en: { title: "", prompt: "" }
        }
      },
      accessibility: {}
    });
    const finale = checkpoint({
      id: "checkpoint-2",
      slug: "finale",
      sequence_no: 2,
      kind: "finale",
      accessibility: {},
      config: {
        content: {
          he: { title: "סיום", prompt: "פתחו את הקפסולה" },
          en: { title: "Finale", prompt: "Open the capsule" }
        }
      }
    });

    const report = buildContentValidationReport({
      checkpoints: [first, finale],
      healthByCheckpoint: new Map()
    });

    expect(report.ok).toBe(false);
    expect(report.errors.some((issue) => issue.code === "missing_bilingual_content")).toBe(true);
  });

  it("blocks publishing when the finale is not last or field checks are pending", () => {
    const finale = checkpoint({ kind: "finale", sequence_no: 1 });
    const later = checkpoint({
      id: "checkpoint-2",
      slug: "later-station",
      sequence_no: 2,
      kind: "text"
    });

    const report = buildContentValidationReport({
      checkpoints: [finale, later],
      healthByCheckpoint: new Map()
    });

    expect(report.ok).toBe(false);
    expect(report.errors.some((issue) => issue.code === "finale_not_last")).toBe(true);
    expect(report.unverifiedCount).toBe(2);
    expect(report.warnings).toHaveLength(2);
  });
});
