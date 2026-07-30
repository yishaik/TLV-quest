import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  runOutboxBatch,
  type OutboxMessage,
  type OutboxStore
} from "../lib/outbox-core";

const migration = readFileSync(
  "supabase/migrations/20260730150000_reliable_outbox_worker.sql",
  "utf8"
);

type MemoryRow = OutboxMessage & {
  status: "pending" | "processing" | "sent" | "failed";
  sendAfter: Date;
  providerMessageId: string | null;
  errorCode: string | null;
};

const quietLogger = {
  info: () => undefined,
  error: () => undefined
};

const createMemoryStore = (clock: () => Date) => {
  const rows = new Map<string, MemoryRow>();
  let leaseSequence = 0;

  const enqueue = (id: string) => {
    rows.set(id, {
      id,
      runId: "run-1",
      participantId: "participant-1",
      channel: "whatsapp",
      recipientCiphertext: "encrypted-phone",
      payload: { body: "Safe test message" },
      attempts: 0,
      leaseToken: "",
      status: "pending",
      sendAfter: clock(),
      providerMessageId: null,
      errorCode: null
    });
  };

  const store: OutboxStore = {
    claimBatch: async ({ limit, outboxIds }) => {
      const allowedIds = outboxIds ? new Set(outboxIds) : null;
      const claimed: OutboxMessage[] = [];
      for (const row of rows.values()) {
        if (claimed.length >= limit) break;
        if (allowedIds && !allowedIds.has(row.id)) continue;
        if (row.status !== "pending" || row.sendAfter > clock()) continue;

        row.status = "processing";
        row.attempts += 1;
        row.leaseToken = `lease-${++leaseSequence}`;
        claimed.push({
          id: row.id,
          runId: row.runId,
          participantId: row.participantId,
          channel: row.channel,
          recipientCiphertext: row.recipientCiphertext,
          payload: row.payload,
          attempts: row.attempts,
          leaseToken: row.leaseToken
        });
      }
      return claimed;
    },
    completeAttempt: async ({
      id,
      leaseToken,
      providerMessageId
    }) => {
      const row = rows.get(id);
      if (
        !row ||
        row.status !== "processing" ||
        row.leaseToken !== leaseToken
      ) {
        return false;
      }
      row.status = "sent";
      row.leaseToken = "";
      row.providerMessageId = providerMessageId;
      row.errorCode = null;
      return true;
    },
    failAttempt: async ({
      id,
      leaseToken,
      errorCode,
      retryAt,
      terminal
    }) => {
      const row = rows.get(id);
      if (
        !row ||
        row.status !== "processing" ||
        row.leaseToken !== leaseToken
      ) {
        return false;
      }
      row.status = terminal ? "failed" : "pending";
      row.leaseToken = "";
      row.errorCode = errorCode;
      row.sendAfter = retryAt;
      return true;
    }
  };

  return { enqueue, rows, store };
};

describe("reliable outbox worker", () => {
  it("schedules a one-minute recovery sweep with service-role-only claims", () => {
    expect(migration).toContain("'outbox-worker-every-minute'");
    expect(migration).toContain("'* * * * *'");
    expect(migration).toContain("for update skip locked");
    expect(migration).toContain("lease_token = gen_random_uuid()");
    expect(migration).toContain("from public, anon, authenticated");
    expect(migration).toContain("to service_role");
    expect(migration).toContain("consume_outbox_worker_token");
  });

  it("covers enqueue → atomic claim → Twilio mock → sent", async () => {
    const current = new Date("2026-07-30T12:00:00.000Z");
    const memory = createMemoryStore(() => current);
    memory.enqueue("outbox-1");
    const twilioMock = vi.fn().mockResolvedValue({
      providerMessageId: "SM-test-1",
      providerStatus: "sent" as const
    });

    const results = await runOutboxBatch({
      store: memory.store,
      deliver: twilioMock,
      now: () => current,
      logger: quietLogger
    });

    expect(results).toEqual([{ id: "outbox-1", status: "sent" }]);
    expect(twilioMock).toHaveBeenCalledOnce();
    expect(memory.rows.get("outbox-1")).toMatchObject({
      status: "sent",
      attempts: 1,
      providerMessageId: "SM-test-1"
    });
  });

  it("retries transient provider failures and later succeeds", async () => {
    let current = new Date("2026-07-30T12:00:00.000Z");
    const memory = createMemoryStore(() => current);
    memory.enqueue("outbox-retry");
    const transientError = Object.assign(new Error("rate limited"), {
      code: 20429
    });
    const twilioMock = vi
      .fn()
      .mockRejectedValueOnce(transientError)
      .mockResolvedValueOnce({
        providerMessageId: "SM-test-retry",
        providerStatus: "sent" as const
      });

    const first = await runOutboxBatch({
      store: memory.store,
      deliver: twilioMock,
      now: () => current,
      logger: quietLogger
    });
    expect(first).toEqual([
      {
        id: "outbox-retry",
        status: "retry_scheduled",
        errorCode: "provider_20429"
      }
    ]);

    const tooSoon = await runOutboxBatch({
      store: memory.store,
      deliver: twilioMock,
      now: () => current,
      logger: quietLogger
    });
    expect(tooSoon).toEqual([]);

    current = new Date("2026-07-30T12:01:01.000Z");
    const retried = await runOutboxBatch({
      store: memory.store,
      deliver: twilioMock,
      now: () => current,
      logger: quietLogger
    });
    expect(retried).toEqual([{ id: "outbox-retry", status: "sent" }]);
    expect(memory.rows.get("outbox-retry")).toMatchObject({
      status: "sent",
      attempts: 2,
      providerMessageId: "SM-test-retry"
    });
  });

  it("becomes terminal after five failed attempts", async () => {
    let current = new Date("2026-07-30T12:00:00.000Z");
    const memory = createMemoryStore(() => current);
    memory.enqueue("outbox-terminal");

    for (let attempt = 1; attempt <= 5; attempt += 1) {
      const results = await runOutboxBatch({
        store: memory.store,
        deliver: async () => {
          throw new Error("temporary provider failure");
        },
        now: () => current,
        logger: quietLogger
      });
      expect(results[0]?.status).toBe(
        attempt === 5 ? "failed" : "retry_scheduled"
      );
      current = new Date(current.getTime() + 61 * 60_000);
    }

    expect(memory.rows.get("outbox-terminal")).toMatchObject({
      status: "failed",
      attempts: 5,
      errorCode: "delivery_error"
    });
  });

  it("does not let concurrent workers deliver the same claim", async () => {
    const current = new Date("2026-07-30T12:00:00.000Z");
    const memory = createMemoryStore(() => current);
    memory.enqueue("outbox-concurrent");
    const deliver = vi.fn().mockResolvedValue({
      providerMessageId: "SM-concurrent",
      providerStatus: "sent" as const
    });

    const batches = await Promise.all([
      runOutboxBatch({
        store: memory.store,
        deliver,
        now: () => current,
        logger: quietLogger
      }),
      runOutboxBatch({
        store: memory.store,
        deliver,
        now: () => current,
        logger: quietLogger
      })
    ]);

    expect(batches.flat()).toHaveLength(1);
    expect(deliver).toHaveBeenCalledOnce();
    expect(memory.rows.get("outbox-concurrent")?.status).toBe("sent");
  });
});
