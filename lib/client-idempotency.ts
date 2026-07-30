"use client";

const STORAGE_PREFIX = "tlvQuest:pending-action:";

const storage = () => {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
};

export const actionFingerprint = (value: string) => {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
};

export const pendingIdempotencyKey = (prefix: string, scope: string) => {
  const key = `${STORAGE_PREFIX}${prefix}:${scope}`;
  const store = storage();
  const existing = store?.getItem(key);
  if (existing) return existing;

  const created = `${prefix}:${crypto.randomUUID()}`;
  store?.setItem(key, created);
  return created;
};

export const settleIdempotencyKey = (
  prefix: string,
  scope: string,
  response: Response
) => {
  if (response.status >= 500) return;
  storage()?.removeItem(`${STORAGE_PREFIX}${prefix}:${scope}`);
};
