"use client";

import { FormEvent, useMemo, useState } from "react";
import { useQuestRealtime } from "@/components/QuestRealtimeProvider";
import styles from "./QuestRuntimeSafetyNet.module.css";

type Locale = "he" | "en";
type RuntimeState = {
  participant: { language: Locale };
  run: { status: string };
  team: { status: string };
  checkpoint: null | {
    slug: string;
    kind: string;
    fallback: Record<string, unknown> | null;
    isOptional: boolean;
    scanVerified: boolean;
    photoFallbackAvailable: boolean;
  };
};

const localizedFallback = (
  fallback: Record<string, unknown> | null,
  language: Locale
) => {
  if (!fallback) return "";
  const value = fallback[language];
  return typeof value === "string" ? value.trim() : "";
};

const hasFallbackAnswers = (fallback: Record<string, unknown> | null) =>
  Boolean(
    fallback &&
      Array.isArray(fallback.accepted) &&
      fallback.accepted.some(
        (answer) => typeof answer === "string" && Boolean(answer.trim())
      )
  );

export function QuestRuntimeSafetyNet({ token }: { token: string }) {
  const { state: realtimeState, refresh } = useQuestRealtime();
  const state = realtimeState as RuntimeState | null;
  const [answer, setAnswer] = useState("");
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const checkpoint = state?.checkpoint ?? null;
  const language = state?.participant.language ?? "he";
  const isHebrew = language === "he";
  const fallbackPrompt = useMemo(
    () => localizedFallback(checkpoint?.fallback ?? null, language),
    [checkpoint?.fallback, language]
  );
  const fallbackReady = Boolean(
    checkpoint?.kind === "photo" &&
      checkpoint.photoFallbackAvailable &&
      fallbackPrompt &&
      hasFallbackAnswers(checkpoint.fallback)
  );
  const relevant = Boolean(
    state?.run.status === "active" &&
      checkpoint &&
      (checkpoint.isOptional || checkpoint.kind === "hybrid" || fallbackReady)
  );

  async function skipCheckpoint() {
    if (!checkpoint?.isOptional) return;
    const confirmed = window.confirm(
      isHebrew
        ? "לדלג על התחנה האופציונלית? לא יתווספו נקודות עבור התחנה הזו."
        : "Skip this optional checkpoint? No points will be awarded for it."
    );
    if (!confirmed) return;

    setBusy("skip");
    setError("");
    setMessage("");
    try {
      const response = await fetch(
        `/api/participants/${encodeURIComponent(token)}/skip`,
        {
          method: "POST",
          headers: {
            "idempotency-key": `web-optional-skip:${checkpoint.slug}:${crypto.randomUUID()}`
          }
        }
      );
      const payload = await response.json();
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error?.message ?? "Skip failed");
      }
      setMessage(
        isHebrew
          ? "התחנה דולגה. עוברים הלאה…"
          : "Checkpoint skipped. Moving on…"
      );
      window.setTimeout(() => void refresh(), 250);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unexpected error");
    } finally {
      setBusy("");
    }
  }

  async function submitFallback(event: FormEvent) {
    event.preventDefault();
    const submitted = answer.trim();
    if (!submitted || !checkpoint) return;

    setBusy("fallback");
    setError("");
    setMessage("");
    try {
      const response = await fetch(
        `/api/participants/${encodeURIComponent(token)}/answer`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "idempotency-key": `web-photo-fallback:${crypto.randomUUID()}`
          },
          body: JSON.stringify({ answer: submitted })
        }
      );
      const payload = await response.json();
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error?.message ?? "Fallback answer failed");
      }
      if (!payload.data.evaluation.correct) {
        setError(
          isHebrew
            ? "התשובה עדיין לא נכונה. בדקו שוב את הפרטים סביבכם."
            : "That answer is not correct yet. Check the details around you again."
        );
        return;
      }

      setAnswer("");
      setMessage(
        isHebrew
          ? "שאלת הגיבוי נפתרה. ממשיכים…"
          : "Fallback solved. Continuing…"
      );
      window.setTimeout(() => void refresh(), 250);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unexpected error");
    } finally {
      setBusy("");
    }
  }

  if (!relevant || !checkpoint) return null;

  return (
    <aside className={styles.panel} dir={isHebrew ? "rtl" : "ltr"} aria-live="polite">
      {checkpoint.kind === "hybrid" && (
        <section className={styles.step}>
          <span className={checkpoint.scanVerified ? styles.goodBadge : styles.pendingBadge}>
            {checkpoint.scanVerified
              ? isHebrew
                ? "הסריקה אושרה"
                : "Scan verified"
              : isHebrew
                ? "נדרשת סריקה"
                : "Scan required"}
          </span>
          <div>
            <strong>
              {checkpoint.scanVerified
                ? isHebrew
                  ? "שלב 1 הושלם — עכשיו פותרים את החידה"
                  : "Step 1 complete — now solve the riddle"
                : isHebrew
                  ? "סרקו את קוד ה־QR או תג ה־NFC של התחנה"
                  : "Scan the checkpoint QR code or NFC tag"}
            </strong>
            <small>
              {isHebrew
                ? "בחידה משולבת נדרשים גם זיהוי התחנה וגם פתרון נכון."
                : "Hybrid checkpoints require both presence verification and a correct solution."}
            </small>
          </div>
        </section>
      )}

      {fallbackReady && (
        <section className={styles.fallback}>
          <span className={styles.fallbackBadge}>
            {isHebrew ? "שאלת גיבוי" : "Fallback question"}
          </span>
          <strong>{fallbackPrompt}</strong>
          <form onSubmit={submitFallback}>
            <input
              value={answer}
              onChange={(event) => setAnswer(event.target.value)}
              placeholder={isHebrew ? "הקלידו תשובה" : "Enter your answer"}
              autoComplete="off"
              enterKeyHint="send"
            />
            <button type="submit" disabled={busy === "fallback" || !answer.trim()}>
              {busy === "fallback"
                ? isHebrew
                  ? "בודק…"
                  : "Checking…"
                : isHebrew
                  ? "שליחת תשובת גיבוי"
                  : "Submit fallback"}
            </button>
          </form>
        </section>
      )}

      {checkpoint.isOptional && (
        <section className={styles.optional}>
          <div>
            <strong>{isHebrew ? "תחנה אופציונלית" : "Optional checkpoint"}</strong>
            <small>
              {isHebrew
                ? "אפשר לדלג ולהמשיך ללא נקודות עבור התחנה."
                : "You may skip it and continue without earning its points."}
            </small>
          </div>
          <button type="button" onClick={skipCheckpoint} disabled={busy === "skip"}>
            {busy === "skip"
              ? isHebrew
                ? "מדלג…"
                : "Skipping…"
              : isHebrew
                ? "דילוג"
                : "Skip"}
          </button>
        </section>
      )}

      {message && <div className={styles.success}>{message}</div>}
      {error && <div className={styles.error}>{error}</div>}
    </aside>
  );
}
