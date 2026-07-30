"use client";

type CreateUuid = () => string;
type ActionEntry = {
  key: string;
  active: number;
  uncertain: boolean;
  resolved: boolean;
};

const defaultUuid: CreateUuid = () => crypto.randomUUID();

export class ClientIdempotencyKeys {
  private readonly keys = new Map<string, ActionEntry>();

  constructor(private readonly createUuid: CreateUuid = defaultUuid) {}

  acquire(scope: string, prefix: string): string {
    const current = this.keys.get(scope);
    if (current) {
      current.active += 1;
      return current.key;
    }

    const key = `${prefix}:${this.createUuid()}`;
    this.keys.set(scope, {
      key,
      active: 1,
      uncertain: false,
      resolved: false
    });
    return key;
  }

  release(scope: string, key: string): void {
    if (this.keys.get(scope)?.key === key) {
      this.keys.delete(scope);
    }
  }

  settle(scope: string, key: string, status: number | undefined): void {
    const current = this.keys.get(scope);
    if (!current || current.key !== key) return;

    current.active = Math.max(0, current.active - 1);
    if (typeof status === "number" && status >= 200 && status < 300) {
      current.resolved = true;
      current.uncertain = false;
    } else if (
      !current.resolved &&
      (status === undefined || status >= 500)
    ) {
      current.uncertain = true;
    }

    if (
      current.active === 0 &&
      (current.resolved || !current.uncertain)
    ) {
      this.keys.delete(scope);
    }
  }

  settleError(scope: string, key: string, error: unknown): void {
    if (!error || typeof error !== "object") return;
    if (
      "retryable" in error &&
      (error as { retryable?: unknown }).retryable === true
    ) {
      this.settle(scope, key, undefined);
      return;
    }
    const status =
      "status" in error ? (error as { status?: unknown }).status : undefined;
    if (
      typeof status === "number" &&
      Number.isFinite(status) &&
      status >= 400
    ) {
      this.settle(scope, key, status);
    } else {
      this.settle(scope, key, undefined);
    }
  }
}

export const idempotencyAnswerScope = (
  checkpointSlug: string,
  answer: string
): string =>
  `answer:${checkpointSlug}:${answer
    .normalize("NFKC")
    .trim()
    .toLowerCase()}`;

export const idempotencyPhotoScope = (
  checkpointSlug: string,
  file: File
): string =>
  [
    "photo",
    checkpointSlug,
    file.name,
    file.size,
    file.lastModified,
    file.type
  ].join(":");
