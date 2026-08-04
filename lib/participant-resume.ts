import "server-only";

import { timingSafeEqual } from "node:crypto";
import { hashSecret } from "@/lib/crypto";
import { publicEnv } from "@/lib/env";

type ResumePayload = {
  participantId: string;
  expiresAt: number;
};

const signatureFor = (payload: string) =>
  hashSecret(`participant-resume:${payload}`);

export const createParticipantResumeToken = (
  participantId: string,
  expiresInSeconds = 7 * 24 * 60 * 60
): string => {
  const payload: ResumePayload = {
    participantId,
    expiresAt: Math.floor(Date.now() / 1000) + expiresInSeconds
  };
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `${encoded}.${signatureFor(encoded)}`;
};

export const verifyParticipantResumeToken = (token: string): ResumePayload => {
  const [encoded, signature] = token.split(".");
  if (!encoded || !signature) throw new Error("Invalid resume link");

  const expected = signatureFor(encoded);
  const receivedBuffer = Buffer.from(signature, "utf8");
  const expectedBuffer = Buffer.from(expected, "utf8");
  if (
    receivedBuffer.length !== expectedBuffer.length ||
    !timingSafeEqual(receivedBuffer, expectedBuffer)
  ) {
    throw new Error("Invalid resume link");
  }

  let payload: ResumePayload;
  try {
    payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as ResumePayload;
  } catch {
    throw new Error("Invalid resume link");
  }

  if (
    typeof payload.participantId !== "string" ||
    typeof payload.expiresAt !== "number" ||
    payload.expiresAt < Math.floor(Date.now() / 1000)
  ) {
    throw new Error("Resume link has expired");
  }

  return payload;
};

export const participantResumeUrl = (participantId: string): string =>
  `${publicEnv.appUrl}/resume/${createParticipantResumeToken(participantId)}`;

/** Stable for the participant's retained lifetime. Opening a WhatsApp return
 * link must not invalidate an already-open game tab. */
export const stableParticipantPlayToken = (participantId: string): string =>
  hashSecret(`participant-play:${participantId}`);
