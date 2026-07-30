import { expect, test } from "@playwright/test";

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

test("critical player flow joins, solves exactly once, and reaches the finale", async ({
  page
}) => {
  let finished = false;
  let answerCalls = 0;

  await page.route("**/api/runs/LOAD30/join", async (route) => {
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        data: {
          participantId: "11111111-1111-4111-8111-111111111111",
          participantToken: "player-test-token",
          recoveryCode: "Q7W9KP",
          teamName: "Signal Team",
          playUrl: "/play/player-test-token",
          sandboxJoinUrl: null,
          gameLinkUrl: "https://wa.me/14155238886"
        }
      })
    });
  });

  await page.route("**/api/participants/player-test-token/state", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        data: {
          participant: {
            id: "11111111-1111-4111-8111-111111111111",
            firstName: "Noa",
            language: "en",
            whatsappConnected: false,
            recoveryUrl: "/resume?run=LOAD30"
          },
          run: {
            id: "22222222-2222-4222-8222-222222222222",
            publicCode: "LOAD30",
            status: "active",
            scheduledAt: null,
            totalCheckpoints: 1
          },
          team: {
            id: "33333333-3333-4333-8333-333333333333",
            name: "Signal Team",
            status: finished ? "finished" : "solving",
            score: finished ? 100 : 0,
            completedCount: finished ? 1 : 0
          },
          members: [
            {
              id: "11111111-1111-4111-8111-111111111111",
              firstName: "Noa"
            }
          ],
          activity: [],
          presence: [],
          banners: [],
          branding: {
            productName: "TLV Quest",
            primaryColor: "#f6c35b",
            surfaceColor: "#08131f",
            logoUrl: "/visuals/quest-mark.svg"
          },
          difficulty: {
            level: "standard",
            wrongAttemptsToUnlock: 2,
            inactivityMinutesToUnlock: 7,
            rewardMultiplier: 1,
            penaltyMultiplier: 1,
            reason: "steady_progress"
          },
          hintOffer: null,
          checkpoint: finished
            ? null
            : {
                id: "44444444-4444-4444-8444-444444444444",
                slug: "signal-gate",
                sequenceNo: 1,
                kind: "choice",
                content: {
                  en: {
                    title: "Signal gate",
                    story: "The final signal is waiting.",
                    prompt: "Choose the blue signal.",
                    success: "Signal accepted."
                  }
                },
                choiceOptions: ["Red", "Blue"],
                fallbackPrompt: null,
                hasFallback: false,
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
        }
      })
    });
  });

  await page.route(
    "**/api/participants/player-test-token/realtime-auth",
    async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          data: {
            accessToken: "test-access-token",
            expiresAt: Date.now() + 3_600_000,
            participantId: "11111111-1111-4111-8111-111111111111"
          }
        })
      });
    }
  );

  await page.route("**/api/leaderboard/LOAD30", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, data: [] })
    });
  });

  await page.route("**/rest/v1/quest_presence**", async (route) => {
    await route.fulfill({ status: 204, body: "" });
  });

  await page.route(
    "**/api/participants/player-test-token/answer",
    async (route) => {
      answerCalls += 1;
      const headers = route.request().headers();
      expect(headers["idempotency-key"]).toMatch(/^web-answer:/);
      finished = true;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          data: {
            evaluation: { correct: true },
            scoreDelta: 100,
            result: { duplicate: false }
          }
        })
      });
    }
  );

  await page.goto("/join/LOAD30");
  await page.getByRole("button", { name: "EN", exact: true }).click();
  await page.getByLabel("First name").fill("Noa");
  await page.getByLabel(/I consent/).check();
  await page.getByRole("button", { name: /Open invitation/ }).click();
  await expect(page.getByText("Q7W9KP")).toBeVisible();
  await page.getByRole("link", { name: /Enter the quest/ }).click();

  await expect(
    page.getByRole("heading", { name: "Signal gate" })
  ).toBeVisible();
  await page.getByRole("button", { name: "Blue", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "The story is complete." })
  ).toBeVisible();
  expect(answerCalls).toBe(1);
});
