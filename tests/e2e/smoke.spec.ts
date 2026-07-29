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
