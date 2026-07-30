import { expect, test } from "@playwright/test";

const teams = Array.from({ length: 8 }, (_, index) => ({
  id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
  public_name: `צוות ${index + 1}`,
  status: index === 0 ? "solving" : "travelling",
  score: 100 - index * 5,
  completed_count: index % 3,
  current_checkpoint_slug: `checkpoint-${(index % 3) + 1}`,
  wrong_attempts: index,
  hints_used: 0,
  last_progress_at: "2026-07-30T10:00:00.000Z",
  online_count: index === 0 ? 4 : 3,
  minutes_since_progress: index === 0 ? 22 : 4,
  is_stuck: index === 0
}));

const participants = Array.from({ length: 30 }, (_, index) => ({
  id: `10000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
  team_id: teams[index % teams.length].id,
  public_alias: `שחקן ${index + 1}`,
  language: index % 2 ? "en" : "he",
  whatsapp_connected_at: "2026-07-30T09:00:00.000Z",
  last_seen_at: "2026-07-30T10:21:00.000Z"
}));

const organizerState = {
  run: {
    public_code: "OPS30",
    status: "active",
    scheduled_at: null,
    max_participants: 30
  },
  teams,
  participants,
  checkpoints: [
    {
      id: "checkpoint-run-1",
      slug: "checkpoint-1",
      sequence_no: 1,
      kind: "text",
      is_disabled: false,
      source_active: true,
      field_health_status: "verified",
      field_health_notes: null,
      field_last_checked_at: "2026-07-30T08:00:00.000Z",
      fallback_ready: false,
      healthy: true
    },
    {
      id: "checkpoint-run-2",
      slug: "checkpoint-2",
      sequence_no: 2,
      kind: "photo",
      is_disabled: false,
      source_active: true,
      field_health_status: "pending",
      field_health_notes: "נדרשת הליכת אימות",
      field_last_checked_at: null,
      fallback_ready: true,
      healthy: false
    }
  ],
  outbox: [
    {
      id: "20000000-0000-4000-8000-000000000001",
      participant_id: participants[0].id,
      status: "failed",
      attempts: 3,
      last_error: "provider_timeout",
      provider_status: "undelivered",
      provider_error_code: "30003",
      created_at: "2026-07-30T10:00:00.000Z",
      sent_at: null,
      delivered_at: null,
      send_after: "2026-07-30T10:00:00.000Z",
      target_scope: `team:${teams[0].id}`
    }
  ],
  outboxSummary: {
    total: 1,
    queued: 0,
    processing: 0,
    sent: 0,
    delivered: 0,
    failed: 1
  },
  audit: [
    {
      id: 1,
      action: "score",
      actor: "organizer:test",
      reason: "תיקון בדיקת מפעיל",
      before_state: { score: 90 },
      after_state: { score: 100 },
      created_at: "2026-07-30T10:05:00.000Z"
    }
  ],
  goNoGo: {
    ready: false,
    activeCheckpoints: 2,
    verifiedCheckpoints: 1,
    pendingCheckpoints: 1,
    blockedCheckpoints: 0,
    unhealthyCheckpoints: 1,
    missingFallbacks: 0,
    failedMessages: 1,
    stuckThresholdMinutes: 10
  },
  joinUrl: "https://play.example/join/OPS30",
  liveUrl: "https://play.example/live/OPS30"
};

test("an operator can recover a 30-participant event from the dashboard", async ({
  page
}) => {
  const requests: Array<{
    body: Record<string, unknown>;
    idempotencyKey: string | null;
  }> = [];

  await page.route("**/api/organizer/live-ops-e2e", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, data: organizerState })
    });
  });
  await page.route(
    "**/api/organizer/live-ops-e2e/control",
    async (route) => {
      const body = route.request().postDataJSON() as Record<string, unknown>;
      requests.push({
        body,
        idempotencyKey: route.request().headers()["idempotency-key"] ?? null
      });
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          data: {
            action: body.action,
            result: { duplicate: false },
            delivery: {
              queued: body.action === "broadcast" ? 30 : 1,
              processing: 0,
              sent: 0,
              delivered: 0,
              failed: 0
            }
          }
        })
      });
    }
  );

  await page.goto("/organize/live-ops-e2e");

  await expect(page.getByText("30/30")).toBeVisible();
  await expect(page.getByText("נדרשת פעולה")).toBeVisible();
  await expect(page.getByText("תקוע 22 דק׳")).toBeVisible();
  await expect(page.getByText("נדרשת הליכת אימות")).toBeVisible();
  await expect(page.getByText("30003")).toBeVisible();

  await page
    .getByPlaceholder("למשל: חסימת רחוב ליד התחנה")
    .fill("בדיקת התאוששות תפעולית");
  await page.getByPlaceholder("הודעה בעברית").fill("חוזרים למסלול");
  await page
    .getByPlaceholder("Message in English")
    .fill("Return to the route");
  await page.locator('select[name="teamId"]').selectOption(teams[0].id);
  await page.getByRole("button", { name: "שידור מתועד" }).click();

  await expect.poll(() => requests.length).toBe(1);
  expect(requests[0].body).toMatchObject({
    action: "broadcast",
    reason: "בדיקת התאוששות תפעולית",
    teamId: teams[0].id
  });
  expect(requests[0].idempotencyKey).toMatch(/^web-organizer:/);

  await page.getByRole("button", { name: "ניסיון חוזר" }).click();
  await expect.poll(() => requests.length).toBe(2);
  expect(requests[1].body).toMatchObject({
    action: "retry_message",
    messageId: "20000000-0000-4000-8000-000000000001"
  });

  const stuckTeam = page.locator(".team-control-row").filter({
    hasText: "צוות 1"
  });
  await stuckTeam.getByRole("button", { name: "רמז" }).click();
  await expect.poll(() => requests.length).toBe(3);
  expect(requests[2].body).toMatchObject({
    action: "grant_hint",
    teamId: teams[0].id
  });

  const recoveryPanel = page
    .locator(".control-panel")
    .filter({ hasText: "העברת משתתף בין צוותים" });
  await recoveryPanel.locator("select").nth(0).selectOption(participants[0].id);
  await recoveryPanel.locator("select").nth(1).selectOption(teams[1].id);
  await recoveryPanel
    .getByRole("button", { name: "העברה ועדכון הרשאות בזמן אמת" })
    .click();
  await expect.poll(() => requests.length).toBe(4);
  expect(requests[3].body).toMatchObject({
    action: "move_participant",
    participantId: participants[0].id,
    targetTeamId: teams[1].id
  });
});
