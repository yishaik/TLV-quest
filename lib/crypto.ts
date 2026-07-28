import "server-only";

import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes
} from "node:crypto";
import { getServerEnv } from "@/lib/env";

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

const encryptionKey = (): Buffer => {
  const key = Buffer.from(getServerEnv().piiEncryptionKey, "base64");
  if (key.length !== 32) {
    throw new Error("PII_ENCRYPTION_KEY must decode to exactly 32 bytes");
  }
  return key;
};

export const encryptPii = (value: string): string => {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const ciphertext = Buffer.concat([
    cipher.update(value, "utf8"),
    cipher.final()
  ]);
  const tag = cipher.getAuthTag();
  return [iv, tag, ciphertext]
    .map((part) => part.toString("base64url"))
    .join(".");
};

export const decryptPii = (payload: string): string => {
  const [ivEncoded, tagEncoded, ciphertextEncoded] = payload.split(".");
  if (!ivEncoded || !tagEncoded || !ciphertextEncoded) {
    throw new Error("Invalid encrypted payload");
  }

  const decipher = createDecipheriv(
    "aes-256-gcm",
    encryptionKey(),
    Buffer.from(ivEncoded, "base64url")
  );
  decipher.setAuthTag(Buffer.from(tagEncoded, "base64url"));

  return Buffer.concat([
    decipher.update(Buffer.from(ciphertextEncoded, "base64url")),
    decipher.final()
  ]).toString("utf8");
};

export const hashSecret = (value: string): string =>
  createHmac("sha256", getServerEnv().tokenPepper)
    .update(value)
    .digest("hex");

export const randomToken = (bytes = 24): string =>
  randomBytes(bytes).toString("base64url");

export const randomCode = (length = 6): string => {
  const bytes = randomBytes(length);
  return Array.from(bytes, (byte) => ALPHABET[byte % ALPHABET.length]).join("");
};

export const normalizePhone = (input: string): string => {
  let digits = input.replace(/\D/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.startsWith("0")) digits = `972${digits.slice(1)}`;
  if (digits.length < 8 || digits.length > 15) {
    throw new Error("Invalid phone number");
  }
  return `+${digits}`;
};
