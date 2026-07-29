import { expect, test } from "@playwright/test";

test("landing page sells the live Tel Aviv Port quest in Hebrew and English", async ({ page }) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: /הנמל מסתיר סיפור.*אתם צריכים לפתוח אותו/ })
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "צאו למסע" }).first()).toBeVisible();
  await expect(page.getByText("לא עוד סיור. לא עוד חדר בריחה.")).toBeVisible();

  await page.getByRole("link", { name: "EN" }).click();
  await expect(
    page.getByRole("heading", { name: /The port is hiding a story.*You have to unlock it/ })
  ).toBeVisible();
  await expect(page.getByText("Not another tour. Not another escape room.")).toBeVisible();
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
