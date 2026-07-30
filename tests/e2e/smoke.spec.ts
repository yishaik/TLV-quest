import { expect, test, type Page } from "@playwright/test";

const photoState = {
  participant: {
    id: "11111111-1111-4111-8111-111111111111",
    firstName: "בודק",
    language: "he",
    whatsappConnected: false
  },
  run: {
    id: "22222222-2222-4222-8222-222222222222",
    publicCode: "PHOTO1",
    status: "active",
    scheduledAt: null,
    totalCheckpoints: 3
  },
  team: {
    id: "33333333-3333-4333-8333-333333333333",
    name: "צוות צילום",
    status: "solving",
    score: 10,
    completedCount: 1
  },
  members: [
    {
      id: "11111111-1111-4111-8111-111111111111",
      firstName: "בודק"
    }
  ],
  activity: [],
  presence: [],
  checkpoint: {
    id: "44444444-4444-4444-8444-444444444444",
    slug: "photo-checkpoint",
    sequenceNo: 2,
    kind: "photo",
    content: {
      he: {
        title: "משימת צילום",
        story: "המצלמה מוכנה.",
        prompt: "צלמו את הרגע.",
        success: "התמונה אושרה בהצלחה."
      },
      en: {
        title: "Photo mission",
        story: "The camera is ready.",
        prompt: "Capture the moment.",
        success: "Photo approved successfully."
      }
    },
    validationType: "photo",
    choiceOptions: [],
    hasFallback: true,
    fallbackPrompt: "שאלת גיבוי",
    latitude: null,
    longitude: null,
    radiusMeters: null,
    isOptional: false,
    scanVerified: false,
    photoFallbackAvailable: false
  },
  realtime: {
    teamTopic: "team:test",
    runTopic: "run:test"
  }
};

const setupPhotoPlayer = async (page: Page) => {
  await page.route("**/api/participants/photo-e2e/state", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, data: photoState })
    });
  });
  await page.route("**/api/leaderboard/PHOTO1", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, data: [] })
    });
  });
  await page.route(
    "**/api/participants/photo-e2e/realtime-auth",
    async (route) => {
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({
          ok: false,
          error: { message: "Realtime disabled in photo upload test" }
        })
      });
    }
  );
  await page.goto("/play/photo-e2e");
  await expect(
    page.getByRole("heading", { name: "משימת צילום" })
  ).toBeVisible();
  await expect(page.getByText("JPG, PNG או WebP · עד 10MB")).toBeVisible();
};

const jpegBuffer = (size: number) => {
  const buffer = Buffer.alloc(size);
  buffer.set([0xff, 0xd8, 0xff, 0xe0], 0);
  return buffer;
};

test("landing page presents the cinematic quest in Hebrew and English", async ({ page }) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: /הנמל זוכר.*אתם באים לגלות/ })
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "בקשת הזמנה" }).first()).toBeVisible();
  await expect(page.getByText("זה לא סיור. זה לא חדר בריחה.")).toBeVisible();

  await page.getByRole("link", { name: "EN" }).click();
  await expect(
    page.getByRole("heading", { name: /The port remembers.*Will you uncover it/ })
  ).toBeVisible();
  await expect(page.getByText("Not a tour. Not an escape room.")).toBeVisible();
});

test("join page exposes guided bilingual registration and privacy consent", async ({ page }) => {
  await page.goto("/join/ABC123");
  await expect(page.getByRole("heading", { name: "לפני שהאות נפתח" })).toBeVisible();
  await expect(page.getByLabel(/שם פרטי/)).toBeVisible();
  await page.locator(".language-segment").getByRole("button", { name: "EN", exact: true }).click();
  await expect(page.getByLabel(/First name/)).toBeVisible();
  await expect(page.getByText(/encrypted storage/i)).toBeVisible();
});

test("create page requires a single-use invitation", async ({ page }) => {
  await page.route("**/api/routes", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        data: [
          {
            slug: "test-route",
            title: { he: "מסלול בדיקה", en: "Test route" },
            description: { he: "מסלול לצורכי בדיקה", en: "A route for tests" },
            version: 1,
            checkpointCount: 3,
            releaseName: "Test release"
          }
        ]
      })
    });
  });

  await page.goto("/create");
  await expect(page.getByRole("heading", { name: "מסלול בדיקה" })).toBeVisible();
  await page.getByRole("button", { name: "המשך" }).click();
  await page.getByRole("button", { name: "המשך" }).click();
  await expect(page.getByText(/חסר קישור הזמנה תקף/)).toBeVisible();
  await expect(page.getByRole("button", { name: "יצירת ההרצה" })).toBeDisabled();
});

test("content operating system requires an authenticated admin session", async ({ page }) => {
  await page.goto("/admin/content");
  await expect(page.getByRole("heading", { name: "נדרשת כניסת מנהל" })).toBeVisible();
  await expect(page.getByRole("link", { name: "מעבר לכניסה" })).toHaveAttribute("href", "/admin");
});

test("optional checkpoint skip advances the web player and sends a stable action key", async ({
  page
}) => {
  let skipped = false;
  let skipCalls = 0;
  const initialState = {
    ...photoState,
    run: { ...photoState.run, publicCode: "SKIP1" },
    team: {
      ...photoState.team,
      name: "צוות דילוג",
      completedCount: 1
    },
    checkpoint: {
      ...photoState.checkpoint,
      id: "66666666-6666-4666-8666-666666666666",
      slug: "optional-checkpoint",
      sequenceNo: 2,
      kind: "text",
      content: {
        he: {
          title: "תחנה אופציונלית",
          story: "אפשר לבחור אם להמשיך.",
          prompt: "מצאו את הסימן."
        },
        en: {
          title: "Optional checkpoint",
          story: "You may choose whether to continue.",
          prompt: "Find the sign."
        }
      },
      validationType: "text",
      hasFallback: false,
      fallbackPrompt: null,
      isOptional: true,
      photoFallbackAvailable: false
    }
  };
  const advancedState = {
    ...initialState,
    team: { ...initialState.team, completedCount: 2 },
    checkpoint: {
      ...initialState.checkpoint,
      id: "77777777-7777-4777-8777-777777777777",
      slug: "after-skip",
      sequenceNo: 3,
      content: {
        he: {
          title: "התחנה הבאה",
          story: "הקבוצה המשיכה יחד.",
          prompt: "המשיכו אל המגדל."
        },
        en: {
          title: "Next checkpoint",
          story: "The team continued together.",
          prompt: "Continue to the tower."
        }
      },
      isOptional: false
    }
  };

  await page.route(
    "**/api/participants/optional-skip-e2e/state",
    async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          data: skipped ? advancedState : initialState
        })
      });
    }
  );
  await page.route(
    "**/api/participants/optional-skip-e2e/skip",
    async (route) => {
      skipCalls += 1;
      expect(route.request().headers()["idempotency-key"]).toMatch(
        /^web-optional-skip:optional-checkpoint:/
      );
      skipped = true;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          data: {
            skipped: true,
            transition: {
              duplicate: false,
              outcome: "advanced",
              previousCheckpointSlug: "optional-checkpoint",
              nextCheckpointSlug: "after-skip"
            },
            delivery: { queued: 1 }
          }
        })
      });
    }
  );
  await page.route("**/api/leaderboard/SKIP1", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, data: [] })
    });
  });
  await page.route(
    "**/api/participants/optional-skip-e2e/realtime-auth",
    async (route) => {
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({
          ok: false,
          error: { message: "Realtime disabled in skip test" }
        })
      });
    }
  );

  page.on("dialog", (dialog) => void dialog.accept());
  await page.goto("/play/optional-skip-e2e");
  await expect(
    page.getByRole("heading", { name: "תחנה אופציונלית" })
  ).toBeVisible();
  await page.getByRole("button", { name: "דילוג", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "התחנה הבאה" })
  ).toBeVisible();
  expect(skipCalls).toBe(1);
});

for (const scenario of [
  { label: "small", size: 128 * 1024 },
  { label: "5 MB", size: 5 * 1024 * 1024 }
]) {
  test(`participant uploads a ${scenario.label} photo directly to storage`, async ({
    page
  }) => {
    await setupPhotoPlayer(page);
    let authorizationBodyBytes = 0;
    let finalizeBodyBytes = 0;
    let storageBodyBytes = 0;
    const path =
      "22222222-2222-4222-8222-222222222222/33333333-3333-4333-8333-333333333333/11111111-1111-4111-8111-111111111111/44444444-4444-4444-8444-444444444444/photo.jpg";

    await page.route(
      "**/api/participants/photo-e2e/photo/upload",
      async (route) => {
        authorizationBodyBytes =
          route.request().postDataBuffer()?.byteLength ?? 0;
        expect(route.request().postDataJSON()).toEqual({
          mimeType: "image/jpeg",
          size: scenario.size
        });
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            ok: true,
            data: {
              uploadId: "55555555-5555-4555-8555-555555555555",
              bucket: "game-media",
              path,
              uploadToken: "signed-upload-token",
              expiresAt: "2026-07-30T18:00:00.000Z",
              maxBytes: 10 * 1024 * 1024
            }
          })
        });
      }
    );
    await page.route(
      "**/storage/v1/object/upload/sign/game-media/**",
      async (route) => {
        storageBodyBytes = route.request().postDataBuffer()?.byteLength ?? 0;
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ Key: `game-media/${path}` })
        });
      }
    );
    await page.route(
      "**/api/participants/photo-e2e/photo",
      async (route) => {
        finalizeBodyBytes = route.request().postDataBuffer()?.byteLength ?? 0;
        expect(route.request().postDataJSON()).toEqual({
          uploadId: "55555555-5555-4555-8555-555555555555"
        });
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            ok: true,
            data: {
              approved: true,
              confidence: 0.98,
              reason: "The image matches"
            }
          })
        });
      }
    );

    await page.locator('input[type="file"]').setInputFiles({
      name: `${scenario.label}.jpg`,
      mimeType: "image/jpeg",
      buffer: jpegBuffer(scenario.size)
    });
    await page.getByRole("button", { name: "שליחת התמונה" }).click();

    await expect(page.getByText("התמונה אושרה בהצלחה.")).toBeVisible();
    expect(authorizationBodyBytes).toBeGreaterThan(0);
    expect(authorizationBodyBytes).toBeLessThan(1_000);
    expect(finalizeBodyBytes).toBeGreaterThan(0);
    expect(finalizeBodyBytes).toBeLessThan(1_000);
    expect(storageBodyBytes).toBeGreaterThan(scenario.size);
  });
}

test("participant gets local feedback for an oversized photo", async ({ page }) => {
  await setupPhotoPlayer(page);
  let apiCalls = 0;
  await page.route(
    "**/api/participants/photo-e2e/photo/upload",
    async (route) => {
      apiCalls += 1;
      await route.abort();
    }
  );

  await page.locator('input[type="file"]').setInputFiles({
    name: "too-large.jpg",
    mimeType: "image/jpeg",
    buffer: jpegBuffer(10 * 1024 * 1024 + 1)
  });
  await page.getByRole("button", { name: "שליחת התמונה" }).click();

  await expect(
    page.getByText("התמונה גדולה מדי. ניתן להעלות תמונה בגודל של עד 10MB.")
  ).toBeVisible();
  expect(apiCalls).toBe(0);
});

test("participant gets local feedback for an unsupported file", async ({ page }) => {
  await setupPhotoPlayer(page);
  let apiCalls = 0;
  await page.route(
    "**/api/participants/photo-e2e/photo/upload",
    async (route) => {
      apiCalls += 1;
      await route.abort();
    }
  );

  await page.locator('input[type="file"]').setInputFiles({
    name: "not-an-image.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("not an image")
  });
  await page.getByRole("button", { name: "שליחת התמונה" }).click();

  await expect(
    page.getByText("אפשר להעלות תמונה בפורמט JPG, PNG או WebP בלבד.")
  ).toBeVisible();
  expect(apiCalls).toBe(0);
});

test("participant sees localized copy for a non-JSON upstream 413", async ({
  page
}) => {
  await setupPhotoPlayer(page);
  await page.route(
    "**/api/participants/photo-e2e/photo/upload",
    async (route) => {
      await route.fulfill({
        status: 413,
        contentType: "text/plain",
        body: "Request Entity Too Large"
      });
    }
  );

  await page.locator('input[type="file"]').setInputFiles({
    name: "camera.jpg",
    mimeType: "image/jpeg",
    buffer: jpegBuffer(128 * 1024)
  });
  await page.getByRole("button", { name: "שליחת התמונה" }).click();

  await expect(
    page.getByText("התמונה גדולה מדי. ניתן להעלות תמונה בגודל של עד 10MB.")
  ).toBeVisible();
  await expect(page.getByText(/Unexpected token/)).toHaveCount(0);
});
