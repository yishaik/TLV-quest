import { expect, test } from "@playwright/test";

test("landing page presents the autonomous quest product", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "העיר הופכת למשחק." })).toBeVisible();
  await expect(page.getByRole("link", { name: "יצירת פיילוט" })).toBeVisible();
  await expect(page.getByText("בלי מפעיל")).toBeVisible();
});

test("join page exposes bilingual registration and privacy consent", async ({ page }) => {
  await page.goto("/join/ABC123");
  await expect(page.getByRole("heading", { name: "הקפסולה מחכה לכם." })).toBeVisible();
  await expect(page.getByLabel("שם פרטי")).toBeVisible();
  await page.getByLabel("Language / שפה").selectOption("en");
  await expect(page.getByLabel("First name")).toBeVisible();
  await expect(page.getByText(/encrypted storage/i)).toBeVisible();
});

test("create page requires a single-use invitation", async ({ page }) => {
  await page.goto("/create");
  await expect(page.getByText(/חסר קישור הזמנה תקף/)).toBeVisible();
  await expect(page.getByRole("button", { name: "יצירת המשחק" })).toBeDisabled();
});
