export const OUTBOX_MAX_ATTEMPTS = 5;

export type OutboxMessage = {
  id: string;
  runId: string | null;
  participantId: string | null;
  channel: "whatsapp" | "email";
  recipientCiphertext: string;
  payload: Record<string, unknown>;
  attempts: number;
  leaseToken: string;
};

export type OutboxDelivery = {
  providerMessageId: string;
  providerStatus: "sent" | "mocked";
};

export type OutboxResultStatus =
  | "sent"
  | "mocked"
  | "retry_scheduled"
  | "failed"
  | "superseded"
  | "settlement_failed";

export type OutboxResult = {
  id: string;
  status: OutboxResultStatus;
  errorCode?: string;
};

export type OutboxStore = {
  claimBatch: (input: {
    limit: number;
    outboxIds?: string[];
  }) => Promise<OutboxMessage[]>;
  completeAttempt: (input: {
    id: string;
    leaseToken: string;
    providerMessageId: string;
    providerStatus: string;
  }) => Promise<boolean>;
  failAttempt: (input: {
    id: string;
    leaseToken: string;
    errorCode: string;
    retryAt: Date;
    terminal: boolean;
  }) => Promise<boolean>;
};

type OutboxLogger = {
  info: (event: string, fields: Record<string, unknown>) => void;
  error: (event: string, fields: Record<string, unknown>) => void;
};

type RunOutboxBatchInput = {
  store: OutboxStore;
  deliver: (message: OutboxMessage) => Promise<OutboxDelivery>;
  limit?: number;
  outboxIds?: string[];
  maxAttempts?: number;
  concurrency?: number;
  now?: () => Date;
  monotonicNow?: () => number;
  logger?: OutboxLogger;
};

const defaultLogger: OutboxLogger = {
  info: (event, fields) => console.info(event, fields),
  error: (event, fields) => console.error(event, fields)
};

const safeProviderCode = (value: unknown): string | null => {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const normalized = String(value)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "_")
    .slice(0, 80);
  return normalized || null;
};

export const outboxErrorCode = (error: unknown): string => {
  if (error && typeof error === "object") {
    const providerCode = safeProviderCode(
      "code" in error ? (error as { code?: unknown }).code : undefined
    );
    if (providerCode) return `provider_${providerCode}`;

    const statusCode = safeProviderCode(
      "status" in error ? (error as { status?: unknown }).status : undefined
    );
    if (statusCode) return `provider_http_${statusCode}`;
  }

  if (error instanceof Error) {
    if (/credentials?.*(missing|not configured)/i.test(error.message)) {
      return "provider_credentials_missing";
    }
    if (/decrypt|authentication failed/i.test(error.message)) {
      return "recipient_decryption_failed";
    }
  }

  return "delivery_error";
};

export const retryDelayMs = (attempt: number): number =>
  Math.min(60, 2 ** Math.max(0, attempt - 1)) * 60_000;

export const runOutboxBatch = async ({
  store,
  deliver,
  limit = 20,
  outboxIds,
  maxAttempts = OUTBOX_MAX_ATTEMPTS,
  concurrency = 10,
  now = () => new Date(),
  monotonicNow = () => Date.now(),
  logger = defaultLogger
}: RunOutboxBatchInput): Promise<OutboxResult[]> => {
  const batchLimit = Math.max(1, Math.min(Math.trunc(limit), 100));
  const rows = await store.claimBatch({
    limit: batchLimit,
    outboxIds: outboxIds?.slice(0, batchLimit)
  });
  const processRow = async (row: OutboxMessage): Promise<OutboxResult> => {
    const startedAt = monotonicNow();
    let delivery: OutboxDelivery;

    try {
      delivery = await deliver(row);
    } catch (error) {
      const errorCode = outboxErrorCode(error);
      const terminal = row.attempts >= maxAttempts;
      const retryAt = new Date(now().getTime() + retryDelayMs(row.attempts));
      let updated: boolean;
      try {
        updated = await store.failAttempt({
          id: row.id,
          leaseToken: row.leaseToken,
          errorCode,
          retryAt,
          terminal
        });
      } catch (settlementError) {
        const settlementErrorCode = outboxErrorCode(settlementError);
        logger.error("outbox.settlement_failed", {
          runId: row.runId,
          outboxId: row.id,
          attempt: row.attempts,
          durationMs: Math.max(0, monotonicNow() - startedAt),
          errorCode: settlementErrorCode,
          deliveryErrorCode: errorCode
        });
        return {
          id: row.id,
          status: "settlement_failed",
          errorCode: settlementErrorCode
        };
      }
      const durationMs = Math.max(0, monotonicNow() - startedAt);

      logger.error("outbox.delivery_failed", {
        runId: row.runId,
        outboxId: row.id,
        attempt: row.attempts,
        durationMs,
        errorCode,
        terminal,
        leaseCurrent: updated
      });
      return {
        id: row.id,
        status: updated
          ? terminal
            ? "failed"
            : "retry_scheduled"
          : "superseded",
        errorCode
      };
    }

    try {
      const updated = await store.completeAttempt({
        id: row.id,
        leaseToken: row.leaseToken,
        providerMessageId: delivery.providerMessageId,
        providerStatus: delivery.providerStatus
      });
      const durationMs = Math.max(0, monotonicNow() - startedAt);
      const status = updated ? delivery.providerStatus : "superseded";

      logger.info("outbox.delivery_completed", {
        runId: row.runId,
        outboxId: row.id,
        attempt: row.attempts,
        providerMessageId: delivery.providerMessageId,
        durationMs,
        status
      });
      return { id: row.id, status };
    } catch (error) {
      const errorCode = outboxErrorCode(error);
      const durationMs = Math.max(0, monotonicNow() - startedAt);
      logger.error("outbox.settlement_failed", {
        runId: row.runId,
        outboxId: row.id,
        attempt: row.attempts,
        providerMessageId: delivery.providerMessageId,
        durationMs,
        errorCode
      });
      return { id: row.id, status: "settlement_failed", errorCode };
    }
  };

  const results = new Array<OutboxResult>(rows.length);
  const workerCount = Math.max(
    1,
    Math.min(Math.trunc(concurrency), rows.length || 1)
  );
  let nextIndex = 0;
  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (nextIndex < rows.length) {
        const currentIndex = nextIndex;
        nextIndex += 1;
        results[currentIndex] = await processRow(rows[currentIndex]);
      }
    })
  );

  return results;
};
