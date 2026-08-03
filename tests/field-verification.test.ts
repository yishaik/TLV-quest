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

describe("field capture surface", () => {
  const component = readFileSync("components/FieldVerification.tsx", "utf8");
  const route = readFileSync(
    "app/api/admin/content/stations/[stationId]/gallery/route.ts",
    "utf8"
  );

  it("captures a fix before asking for a name", () => {
    // Standing at the point is the only moment the coordinate is free. Asking
    // for the name first invites capturing it from the wrong place later.
    const locate = component.indexOf("לכוד את הנקודה הזו");
    const nameField = component.indexOf("שם התחנה");
    expect(locate).toBeGreaterThan(-1);
    expect(nameField).toBeGreaterThan(locate);
  });

  it("generates a Latin slug so a Hebrew name is accepted", () => {
    // The create API rejects a slug that normalises to empty, which is what a
    // Hebrew title would produce.
    expect(component).toContain("const generateSlug");
    expect(component).toContain("poi-");
  });

  it("warns on a poor fix instead of saving it silently", () => {
    expect(component).toContain("ACCURACY_LIMIT");
    expect(component).toContain("enableHighAccuracy: true");
    expect(component).toContain("maximumAge: 0");
  });

  it("offers photos on every station, not only ones with photo riddles", () => {
    // A freshly captured point has no riddles at all; gating photos on them
    // would make the capture flow useless.
    const photoButton = component.indexOf("הוסף תמונה");
    const gate = component.indexOf("hasPhotoRiddle && (");
    expect(photoButton).toBeGreaterThan(-1);
    // The gate exists, but only around the calibration verdict selector.
    expect(gate).toBeGreaterThan(-1);
    expect(gate).toBeLessThan(photoButton);
  });

  it("shows drift before replacing a stored coordinate", () => {
    expect(component).toContain("routeDistanceMeters");
    expect(component).toContain("drift");
  });

  it("keeps gallery uploads additive and authorised", () => {
    expect(route).toContain("requireAdmin");
    expect(route).toContain("appendGalleryEntry");
    expect(route).not.toContain("hero_image_path");
  });

  it("rolls the upload back when the row update fails", () => {
    const update = route.indexOf(".update(");
    const rollback = route.indexOf('.remove([path])');
    expect(update).toBeGreaterThan(-1);
    expect(rollback).toBeGreaterThan(update);
  });
});
