import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const web = readFileSync("lib/physical-actions.ts", "utf8");
const whatsapp = readFileSync("lib/whatsapp-attachments.ts", "utf8");

describe("non-blocking photo validation", () => {
  it("records AI quality without rejecting a valid web upload", () => {
    expect(web).toContain("photo_received_soft_validation");
    expect(web).toContain("criteriaMatched");
    expect(web).not.toContain("approved: false");
  });

  it("uses the same soft-validation policy on WhatsApp", () => {
    expect(whatsapp).toContain("photo_received_soft_validation");
    expect(whatsapp).toContain("התמונה התקבלה והמשחק ממשיך");
    expect(whatsapp).not.toContain("לא ניתן לאמת את התמונה");
  });
});
