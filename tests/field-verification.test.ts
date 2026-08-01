import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  appendGalleryEntry,
  calibrationProgress,
  galleryEntries,
  removeGalleryEntry,
  type GalleryEntry
} from "../lib/station-gallery";

const entry = (over: Partial<GalleryEntry> = {}): GalleryEntry => ({
  path: "stations/a/gallery/1.jpg",
  url: "https://example.test/1.jpg",
  verdict: "accept",
  note: "",
  capturedAt: "2026-08-01T00:00:00.000Z",
  capturedBy: "editor@example.test",
  ...over
});

describe("station gallery", () => {
  it("normalises whatever is actually in the jsonb column", () => {
    // The column is free-form and predates this shape, so a read must survive
    // nulls, scalars and half-written objects rather than trusting it.
    expect(galleryEntries(null)).toEqual([]);
    expect(galleryEntries("not an array")).toEqual([]);
    expect(galleryEntries([1, "x", null])).toEqual([]);

    const parsed = galleryEntries([
      { path: "p.jpg", url: "u", verdict: "nonsense" },
      { url: "no path here" }
    ]);
    expect(parsed).toHaveLength(1);
    // An unknown verdict degrades to reference rather than throwing.
    expect(parsed[0].verdict).toBe("reference");
    // A pathless entry can never be deleted through the UI, so it is dropped.
    expect(parsed.some((item) => !item.path)).toBe(false);
  });

  it("replaces rather than duplicates when the same path is appended twice", () => {
    const first = appendGalleryEntry([], entry());
    const second = appendGalleryEntry(first, entry({ verdict: "reject" }));
    expect(second).toHaveLength(1);
    expect(second[0].verdict).toBe("reject");
  });

  it("removes only the requested photo", () => {
    const list = [entry(), entry({ path: "b.jpg" })];
    expect(removeGalleryEntry(list, "b.jpg")).toHaveLength(1);
    expect(removeGalleryEntry(list, "missing.jpg")).toHaveLength(2);
  });

  it("refuses to call calibration ready without rejected examples", () => {
    // A pile of good photos cannot locate a threshold — the negative examples
    // are what define the boundary. Eight accepts and nothing else is not
    // calibration, and the UI must not imply otherwise.
    const onlyGood = Array.from({ length: 12 }, (_, index) =>
      entry({ path: `good-${index}.jpg`, verdict: "accept" })
    );
    const progress = calibrationProgress(onlyGood);
    expect(progress.accept).toBe(12);
    expect(progress.reject).toBe(0);
    expect(progress.ready).toBe(false);
    expect(progress.missingReject).toBeGreaterThan(0);

    const mixed = [
      ...onlyGood,
      ...Array.from({ length: 5 }, (_, index) =>
        entry({ path: `bad-${index}.jpg`, verdict: "reject" })
      )
    ];
    expect(calibrationProgress(mixed).ready).toBe(true);
  });
});

describe("field verification surface", () => {
  const component = readFileSync("components/FieldVerification.tsx", "utf8");
  const route = readFileSync(
    "app/api/admin/content/stations/[stationId]/gallery/route.ts",
    "utf8"
  );

  it("walks the route south to north rather than alphabetically", () => {
    expect(component).toContain("(a.latitude ?? 0) - (b.latitude ?? 0)");
  });

  it("warns before saving a low-accuracy fix", () => {
    // Writing a bad coordinate silently breaks location verification for every
    // future player, and nobody would know until a live run.
    expect(component).toContain("fix.accuracy > 25");
    expect(component).toContain("enableHighAccuracy: true");
    expect(component).toContain("maximumAge: 0");
  });

  it("shows drift against the stored coordinate", () => {
    expect(component).toContain("routeDistanceMeters");
    expect(component).toContain("drift");
  });

  it("keeps gallery uploads additive and authorised", () => {
    expect(route).toContain("requireAdmin");
    expect(route).toContain("appendGalleryEntry");
    // The hero-image route deletes the previous file; calibration needs the
    // opposite, so this route must never remove on upload.
    expect(route).not.toContain("hero_image_path");
  });

  it("rolls the upload back when the row update fails", () => {
    // A stored object with no row pointing at it is invisible in the UI and
    // cannot be deleted from it.
    const update = route.indexOf(".update(");
    const rollback = route.indexOf('.remove([path])');
    expect(update).toBeGreaterThan(-1);
    expect(rollback).toBeGreaterThan(update);
  });
});
