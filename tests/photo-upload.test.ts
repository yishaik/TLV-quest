import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { readPhotoApiData } from "../lib/photo-upload-response";
import {
  detectPhotoMimeType,
  PHOTO_UPLOAD_MAX_BYTES
} from "../lib/photo-upload-shared";

const migration = readFileSync(
  "supabase/migrations/20260730160000_direct_participant_photo_uploads.sql",
  "utf8"
);
const finalizeRoute = readFileSync(
  "app/api/participants/[token]/photo/route.ts",
  "utf8"
);
const premiumPlayer = readFileSync(
  "components/PremiumQuestPlayer.tsx",
  "utf8"
);
const legacyPlayer = readFileSync("components/QuestPlayer.tsx", "utf8");
const photoUploadClient = readFileSync("lib/photo-upload-client.ts", "utf8");
const photoUploadService = readFileSync("lib/photo-uploads.ts", "utf8");

describe("direct participant photo uploads", () => {
  it("detects supported image signatures instead of trusting the MIME header", () => {
    expect(
      detectPhotoMimeType(
        Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0x00])
      )
    ).toBe("image/jpeg");
    expect(
      detectPhotoMimeType(
        Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
      )
    ).toBe("image/png");
    expect(
      detectPhotoMimeType(
        Uint8Array.from([
          0x52, 0x49, 0x46, 0x46, 0x10, 0x00, 0x00, 0x00, 0x57, 0x45,
          0x42, 0x50
        ])
      )
    ).toBe("image/webp");
    expect(
      detectPhotoMimeType(
        Uint8Array.from([0x3c, 0x73, 0x63, 0x72, 0x69, 0x70, 0x74])
      )
    ).toBeNull();
  });

  it("parses JSON success responses without assuming every response is JSON", async () => {
    await expect(
      readPhotoApiData<{ uploadId: string }>(
        new Response(
          JSON.stringify({ ok: true, data: { uploadId: "upload-1" } }),
          { headers: { "content-type": "application/json; charset=utf-8" } }
        ),
        "en"
      )
    ).resolves.toEqual({ uploadId: "upload-1" });
  });

  it("turns a non-JSON 413 into localized size copy", async () => {
    await expect(
      readPhotoApiData(
        new Response("Request Entity Too Large", {
          status: 413,
          headers: { "content-type": "text/plain" }
        }),
        "he"
      )
    ).rejects.toMatchObject({
      status: 413,
      message: `התמונה גדולה מדי. ניתן להעלות תמונה בגודל של עד 10MB.`
    });
  });

  it("keeps processing conflicts retryable with the same upload key", async () => {
    await expect(
      readPhotoApiData(
        new Response(
          JSON.stringify({
            ok: false,
            error: {
              message: "Still processing",
              details: { code: "photo_upload_not_ready" }
            }
          }),
          {
            status: 409,
            headers: { "content-type": "application/json" }
          }
        ),
        "en"
      )
    ).rejects.toMatchObject({
      status: 409,
      code: "photo_upload_not_ready",
      retryable: true
    });
  });

  it("uses small JSON finalize requests and direct browser storage uploads", () => {
    expect(finalizeRoute).not.toContain("request.formData()");
    expect(premiumPlayer).toContain("uploadParticipantPhoto");
    expect(legacyPlayer).toContain("uploadParticipantPhoto");
    expect(premiumPlayer).not.toContain('form.set("photo"');
    expect(legacyPlayer).not.toContain('form.set("photo"');
    expect(photoUploadClient).toContain("activePhotoUploads");
    expect(photoUploadClient).toContain("authorization.uploaded");
    expect(photoUploadClient).not.toContain("crypto.randomUUID()");
    expect(PHOTO_UPLOAD_MAX_BYTES).toBe(10 * 1024 * 1024);
  });

  it("can resume finalization after the checkpoint already advanced", () => {
    const existingLookup = photoUploadService.indexOf(
      '.eq("idempotency_key", idempotencyKey)'
    );
    const activeCheckpointGuard = photoUploadService.indexOf(
      'state.run.status !== "active"',
      existingLookup
    );

    expect(existingLookup).toBeGreaterThan(0);
    expect(photoUploadService).toContain(
      'row.status === "completed" || row.status === "processing"'
    );
    expect(photoUploadService).toContain("uploaded: true");
    expect(existingLookup).toBeLessThan(activeCheckpointGuard);
  });

  it("keeps grants service-role-only and excludes attached media from cleanup", () => {
    expect(migration).toContain(
      "revoke all on public.photo_uploads from public, anon, authenticated"
    );
    expect(migration).toContain("to service_role");
    expect(migration).toContain("for update of p skip locked");
    expect(migration).toContain("not exists (");
    expect(migration).toContain("public.media_assets");
    expect(migration).toContain("expected_size <= 10485760");
  });
});

describe("player photo intake", () => {
  const player = readFileSync("components/PremiumQuestPlayer.tsx", "utf8");

  it("re-encodes before upload so HEIC and oversized photos survive", () => {
    // All three first real runs show zero upload intents: phone photos were
    // rejected client-side (HEIC / >10 MB) before any request, which played as
    // "the photo button just doesn't work" and forced organizer skips.
    expect(player).toContain("downscaleImage(photo)");
    const shrink = player.indexOf("downscaleImage(photo)");
    const upload = player.indexOf("uploadParticipantPhoto({");
    expect(shrink).toBeGreaterThan(-1);
    expect(shrink).toBeLessThan(upload);
    expect(player).toContain("file: prepared");
  });

  it("lets players pick from the library, not only the camera", () => {
    expect(player).not.toContain('capture="environment"');
    expect(player).toContain('accept="image/*"');
  });

  it("keys idempotency off the prepared file, so a retry reuses the key", () => {
    const scope = player.indexOf("idempotencyPhotoScope(");
    const preparedArg = player.indexOf("prepared\n    );", scope);
    expect(scope).toBeGreaterThan(-1);
    expect(preparedArg).toBeGreaterThan(scope);
  });
});
