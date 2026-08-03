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

  it("uploads straight to storage instead of through the function", () => {
    // Vercel rejects a body over 4.5 MB before any handler runs and answers
    // with HTML, which is smaller than a phone photo and unparseable as JSON.
    const upload = readFileSync(
      "app/api/admin/content/stations/[stationId]/gallery/upload/route.ts",
      "utf8"
    );
    expect(upload).toContain("createSignedUploadUrl");
    expect(component).toContain("uploadToSignedUrl");
    // The attach step must stay a small JSON request.
    expect(route).not.toContain("formData");
  });

  it("refuses a path from another station", () => {
    // A signed URL is scoped to one object, but the station is named again on
    // attach; without this a token for station A could land on station B.
    expect(route).toContain("galleryPrefix(stationId)");
    expect(route).toContain("does not belong to this station");
  });

  it("survives a non-JSON platform error", () => {
    expect(component).toContain("await response.text()");
    expect(component).toContain("JSON.parse(raw)");
    expect(component).toContain("הקובץ גדול מדי לשרת");
  });

  it("converges the fix rather than trusting the first reading", () => {
    // A phone's first fix is routinely 50-100 m out and tightens over seconds.
    expect(component).toContain("watchPosition");
    expect(component).toContain("GOOD_ENOUGH_METRES");
    expect(component).toContain("fix.accuracy < best.accuracy");
    expect(component).toContain("clearWatch");
  });

  it("confirms before deleting a captured point", () => {
    expect(component).toContain("window.confirm");
    expect(component).toContain("מחק תחנה");
  });

  it("removes gallery objects when the station is deleted", () => {
    // Otherwise up to sixty objects per station are stranded with nothing in
    // the database pointing at them.
    const stationRoute = readFileSync(
      "app/api/admin/content/stations/[stationId]/route.ts",
      "utf8"
    );
    expect(stationRoute).toContain("galleryEntries(station?.gallery)");
    expect(stationRoute).toContain("orphans");
  });
});

describe("route-design survey", () => {
  const component = readFileSync("components/FieldVerification.tsx", "utf8");

  it("captures what a point can host, not only where it is", () => {
    // Coordinates alone cannot answer "which points can carry a text riddle",
    // which is the question route design starts from.
    expect(component).toContain("factOnSite");
    expect(component).toContain("visualSubject");
    expect(component).toContain("tagSurface");
    expect(component).toContain("findable");
  });

  it("records capacity, because thirty participants is the design constraint", () => {
    expect(component).toContain("CAPACITIES");
    expect(component).toContain("צוואר בקבוק");
  });

  it("asks for the signage verbatim", () => {
    // Text answers are derived from signage; a paraphrase in the notes is not
    // enough to author one from, and a transcription error breaks the riddle.
    expect(component).toContain("signText");
    expect(component).toContain("מילה במילה");
  });

  it("shows what is still missing on the collapsed card", () => {
    // A gap has to be visible while standing at the point. Discovering it at
    // design time means another trip.
    expect(component).toContain("missingSurvey");
    expect(component).toContain("חסר:");
  });

  it("stores the survey without needing a migration", () => {
    // health_checklist is an existing jsonb column that nothing else writes.
    expect(component).toContain("healthChecklist");
  });
});
