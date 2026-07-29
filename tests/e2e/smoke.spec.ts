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
  await page.goto("/create");
  await page.getByRole("button", { name: "המשך" }).click();
  await page.getByRole("button", { name: "המשך" }).click();
  await expect(page.getByText(/חסר קישור הזמנה תקף/)).toBeVisible();
  await expect(page.getByRole("button", { name: "יצירת ההרצה" })).toBeDisabled();
});
