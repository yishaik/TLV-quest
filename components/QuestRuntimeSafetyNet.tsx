"use client";

import {
  FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";
import { useQuestRealtime } from "@/components/QuestRealtimeProvider";
import {
  ClientIdempotencyKeys,
  idempotencyAnswerScope
} from "@/lib/idempotency-client";
import {
  QUEST_PHOTO_APPROVED_EVENT,
  QUEST_PHOTO_RETRY_EVENT,
  type QuestPhotoEventDetail
} from "@/lib/quest-runtime-events";
import styles from "./QuestRuntimeSafetyNet.module.css";

type Locale = "he" | "en";
type FallbackMode = "minimized" | "expanded" | "dismissed";
type PrerequisiteAction = "location" | "scan" | null;
type RuntimeState = {
  participant: { language: Locale };
  run: { status: string };
  team: { status: string };
  checkpoint: null | {
    slug: string;
    kind: string;
    hasFallback: boolean;
    fallbackPrompt: string | null;
    isOptional: boolean;
    scanVerified: boolean;
    photoFallbackAvailable: boolean;
  };
};

const fallbackStorageKey = (token: string, checkpointSlug: string) =>
  `tlvQuest:photoFallback:${token}:${checkpointSlug}`;

const errorDetailsCode = (payload: unknown) => {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return "";
  }
  const error = (payload as Record<string, unknown>).error;
  if (!error || typeof error !== "object" || Array.isArray(error)) return "";
  const details = (error as Record<string, unknown>).details;
  if (!details || typeof details !== "object" || Array.isArray(details)) {
    return "";
  }
  const code = (details as Record<string, unknown>).code;
  return typeof code === "string" ? code : "";
};

const errorMessage = (payload: unknown, fallback: string) => {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return fallback;
  }
  const error = (payload as Record<string, unknown>).error;
  if (!error || typeof error !== "object" || Array.isArray(error)) {
    return fallback;
  }
  const message = (error as Record<string, unknown>).message;
  return typeof message === "string" && message.trim() ? message : fallback;
};

export function QuestRuntimeSafetyNet({ token }: { token: string }) {
  const { state: realtimeState, refresh } = useQuestRealtime();
  const state = realtimeState as RuntimeState | null;
  const [answer, setAnswer] = useState("");
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [prerequisite, setPrerequisite] =
    useState<PrerequisiteAction>(null);
  const [fallbackUi, setFallbackUi] = useState<{
    slug: string;
    mode: FallbackMode;
  }>({ slug: "", mode: "minimized" });
  const [resolvedFallbackSlug, setResolvedFallbackSlug] = useState("");
  const [fallbackSuccess, setFallbackSuccess] = useState("");
  const [idempotencyKeys] = useState(() => new ClientIdempotencyKeys());
  const answerInputRef = useRef<HTMLInputElement>(null);
  const minimizedButtonRef = useRef<HTMLButtonElement>(null);
  const launcherButtonRef = useRef<HTMLButtonElement>(null);
  const previousCheckpointSlugRef = useRef("");
  const successTimerRef = useRef<number | undefined>(undefined);

  const checkpoint = state?.checkpoint ?? null;
  const checkpointSlug = checkpoint?.slug ?? "";
  const language = state?.participant.language ?? "he";
  const isHebrew = language === "he";
  const fallbackPrompt = useMemo(
    () => checkpoint?.fallbackPrompt?.trim() ?? "",
    [checkpoint?.fallbackPrompt]
  );
  const fallbackReady = Boolean(
    checkpoint?.kind === "photo" &&
      checkpoint.photoFallbackAvailable &&
      fallbackPrompt &&
      checkpoint.hasFallback
  );
  const fallbackAvailable = Boolean(
    fallbackReady && resolvedFallbackSlug !== checkpointSlug
  );
  const fallbackMode =
    fallbackUi.slug === checkpointSlug ? fallbackUi.mode : "minimized";
  const relevant = Boolean(
    state?.run.status === "active" &&
      state?.team.status !== "finished" &&
      checkpoint &&
      (checkpoint.isOptional ||
        checkpoint.kind === "hybrid" ||
        fallbackAvailable)
  );

  const updateFallbackMode = useCallback(
    (mode: FallbackMode) => {
      if (!checkpointSlug) return;
      setFallbackUi({ slug: checkpointSlug, mode });
      const key = fallbackStorageKey(token, checkpointSlug);
      if (mode === "dismissed") {
        window.sessionStorage.setItem(key, mode);
      } else {
        window.sessionStorage.removeItem(key);
      }
    },
    [checkpointSlug, token]
  );

  const openFallback = useCallback(() => {
    updateFallbackMode("expanded");
    window.requestAnimationFrame(() => answerInputRef.current?.focus());
  }, [updateFallbackMode]);

  const minimizeFallback = useCallback(() => {
    updateFallbackMode("minimized");
    window.requestAnimationFrame(() => minimizedButtonRef.current?.focus());
  }, [updateFallbackMode]);

  const dismissFallback = useCallback(() => {
    updateFallbackMode("dismissed");
    setError("");
    setPrerequisite(null);
    window.requestAnimationFrame(() => launcherButtonRef.current?.focus());
  }, [updateFallbackMode]);

  useEffect(() => {
    const previousSlug = previousCheckpointSlugRef.current;
    if (previousSlug && previousSlug !== checkpointSlug) {
      window.sessionStorage.removeItem(fallbackStorageKey(token, previousSlug));
    }
    previousCheckpointSlugRef.current = checkpointSlug;

    const persistedMode = checkpointSlug
      ? window.sessionStorage.getItem(
          fallbackStorageKey(token, checkpointSlug)
        )
      : null;
    const resetTimer = window.setTimeout(() => {
      setFallbackUi({
        slug: checkpointSlug,
        mode: persistedMode === "dismissed" ? "dismissed" : "minimized"
      });
      setResolvedFallbackSlug("");
      setAnswer("");
      setMessage("");
      setError("");
      setPrerequisite(null);
    }, 0);
    return () => window.clearTimeout(resetTimer);
  }, [checkpointSlug, token]);

  useEffect(() => {
    if (!fallbackAvailable || fallbackMode !== "expanded") return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      minimizeFallback();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [fallbackAvailable, fallbackMode, minimizeFallback]);

  useEffect(() => {
    const matchesCheckpoint = (event: Event) =>
      (event as CustomEvent<QuestPhotoEventDetail>).detail?.checkpointSlug ===
      checkpointSlug;
    const onPhotoRetry = (event: Event) => {
      if (!matchesCheckpoint(event)) return;
      updateFallbackMode("dismissed");
      setError("");
      setPrerequisite(null);
    };
    const onPhotoApproved = (event: Event) => {
      if (!matchesCheckpoint(event)) return;
      setResolvedFallbackSlug(checkpointSlug);
      setError("");
      setMessage("");
      setPrerequisite(null);
      window.sessionStorage.removeItem(
        fallbackStorageKey(token, checkpointSlug)
      );
    };
    window.addEventListener(QUEST_PHOTO_RETRY_EVENT, onPhotoRetry);
    window.addEventListener(QUEST_PHOTO_APPROVED_EVENT, onPhotoApproved);
    return () => {
      window.removeEventListener(QUEST_PHOTO_RETRY_EVENT, onPhotoRetry);
      window.removeEventListener(QUEST_PHOTO_APPROVED_EVENT, onPhotoApproved);
    };
  }, [checkpointSlug, token, updateFallbackMode]);

  useEffect(
    () => () => window.clearTimeout(successTimerRef.current),
    []
  );

  async function skipCheckpoint() {
    if (!checkpoint?.isOptional) return;
    const confirmed = window.confirm(
      isHebrew
        ? "לדלג על התחנה האופציונלית? לא יתווספו נקודות עבור התחנה הזו."
        : "Skip this optional checkpoint? No points will be awarded for it."
    );
    if (!confirmed) return;
    const actionScope = `skip:${token}:${checkpoint.slug}`;
    const idempotencyKey = idempotencyKeys.acquire(
      actionScope,
      `web-optional-skip:${checkpoint.slug}`
    );
    let requestSettled = false;

    setBusy("skip");
    setError("");
    setMessage("");
    try {
      const response = await fetch(
        `/api/participants/${encodeURIComponent(token)}/skip`,
        {
          method: "POST",
          headers: {
            "idempotency-key": idempotencyKey
          }
        }
      );
      const payload = await response.json();
      idempotencyKeys.settle(actionScope, idempotencyKey, response.status);
      requestSettled = true;
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
      if (!requestSettled) {
        idempotencyKeys.settle(actionScope, idempotencyKey, undefined);
      }
      setError(cause instanceof Error ? cause.message : "Unexpected error");
    } finally {
      setBusy("");
    }
  }

  async function submitFallback(event: FormEvent) {
    event.preventDefault();
    const submitted = answer.trim();
    if (!submitted || !checkpoint) return;
    const actionScope = idempotencyAnswerScope(
      `${token}:${checkpoint.slug}`,
      submitted
    );
    const idempotencyKey = idempotencyKeys.acquire(
      actionScope,
      "web-photo-fallback"
    );
    let requestSettled = false;

    setBusy("fallback");
    setError("");
    setMessage("");
    setPrerequisite(null);
    try {
      const response = await fetch(
        `/api/participants/${encodeURIComponent(token)}/answer`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "idempotency-key": idempotencyKey
          },
          body: JSON.stringify({ answer: submitted })
        }
      );
      const payload = await response.json().catch(() => null);
      if (payload !== null) {
        idempotencyKeys.settle(
          actionScope,
          idempotencyKey,
          response.status
        );
        requestSettled = true;
      }
      if (!response.ok || !payload.ok) {
        const code = errorDetailsCode(payload);
        if (code === "location_verification_required") {
          setPrerequisite("location");
        } else if (code === "scan_verification_required") {
          setPrerequisite("scan");
        }
        setError(errorMessage(payload, "Fallback answer failed"));
        return;
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
      setResolvedFallbackSlug(checkpoint.slug);
      window.sessionStorage.removeItem(
        fallbackStorageKey(token, checkpoint.slug)
      );
      const successCopy = isHebrew
        ? "שאלת הגיבוי נפתרה. ממשיכים…"
        : "Fallback solved. Continuing…";
      setFallbackSuccess(successCopy);
      window.clearTimeout(successTimerRef.current);
      successTimerRef.current = window.setTimeout(
        () => setFallbackSuccess(""),
        2_400
      );
      window.setTimeout(() => void refresh(), 250);
    } catch (cause) {
      if (!requestSettled) {
        idempotencyKeys.settle(actionScope, idempotencyKey, undefined);
      }
      setError(cause instanceof Error ? cause.message : "Unexpected error");
    } finally {
      setBusy("");
    }
  }

  function activatePrerequisite() {
    if (!prerequisite) return;
    updateFallbackMode("dismissed");
    const targetId =
      prerequisite === "location"
        ? "quest-location-verify"
        : "quest-scan-status";
    window.requestAnimationFrame(() => {
      const target = document.getElementById(targetId);
      if (!target) return;
      target.scrollIntoView({
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
          ? "auto"
          : "smooth",
        block: "center"
      });
      target.focus({ preventScroll: true });
      if (
        prerequisite === "location" &&
        target instanceof HTMLButtonElement &&
        !target.disabled
      ) {
        target.click();
      }
    });
  }

  if ((!relevant || !checkpoint) && !fallbackSuccess) return null;

  const hasSupportingControl = Boolean(
    checkpoint?.kind === "hybrid" || checkpoint?.isOptional
  );
  const compactOnly =
    Boolean(checkpoint) &&
    fallbackAvailable &&
    fallbackMode !== "expanded" &&
    !hasSupportingControl;

  return (
    <>
      {fallbackSuccess && (
        <div
          className={styles.toast}
          dir={isHebrew ? "rtl" : "ltr"}
          role="status"
          aria-live="polite"
          aria-atomic="true"
        >
          {fallbackSuccess}
        </div>
      )}
      {relevant && checkpoint && (
        <aside
          className={[
            styles.panel,
            compactOnly ? styles.compactPanel : "",
            compactOnly && fallbackMode === "dismissed"
              ? styles.launcherPanel
              : ""
          ]
            .filter(Boolean)
            .join(" ")}
          dir={isHebrew ? "rtl" : "ltr"}
        >
          {checkpoint.kind === "hybrid" && (
            <section
              className={styles.step}
              id="quest-scan-status"
              tabIndex={-1}
            >
              <span
                className={
                  checkpoint.scanVerified
                    ? styles.goodBadge
                    : styles.pendingBadge
                }
              >
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

          {fallbackAvailable && fallbackMode === "dismissed" && (
            <button
              ref={launcherButtonRef}
              className={styles.fallbackLauncher}
              type="button"
              onClick={openFallback}
              aria-label={
                isHebrew
                  ? "פתיחת שאלת הגיבוי"
                  : "Open the fallback question"
              }
              aria-controls="photo-fallback-panel"
              aria-expanded="false"
            >
              <span aria-hidden="true">?</span>
              <small>{isHebrew ? "גיבוי" : "Fallback"}</small>
            </button>
          )}

          {fallbackAvailable && fallbackMode === "minimized" && (
            <section className={styles.fallbackPrompt}>
              <button
                ref={minimizedButtonRef}
                className={styles.fallbackChip}
                type="button"
                onClick={openFallback}
                aria-controls="photo-fallback-panel"
                aria-expanded="false"
              >
                <span className={styles.fallbackBadge}>
                  {isHebrew ? "גיבוי" : "Fallback"}
                </span>
                <span className={styles.chipCopy}>
                  <strong>
                    {isHebrew
                      ? "שאלת גיבוי זמינה"
                      : "Fallback question available"}
                  </strong>
                  <small>{fallbackPrompt}</small>
                </span>
              </button>
              <button
                className={styles.iconButton}
                type="button"
                onClick={dismissFallback}
                aria-label={
                  isHebrew
                    ? "הסתרת שאלת הגיבוי בתחנה הזו"
                    : "Dismiss fallback for this checkpoint"
                }
                title={isHebrew ? "הסתרה" : "Dismiss"}
              >
                ×
              </button>
            </section>
          )}

          {fallbackAvailable && fallbackMode === "expanded" && (
            <section
              className={styles.fallback}
              id="photo-fallback-panel"
              role="region"
              aria-labelledby="photo-fallback-title"
            >
              <header className={styles.fallbackHeader}>
                <span className={styles.fallbackBadge}>
                  {isHebrew ? "שאלת גיבוי" : "Fallback question"}
                </span>
                <span className={styles.headerActions}>
                  <button
                    className={styles.iconButton}
                    type="button"
                    onClick={minimizeFallback}
                    aria-label={
                      isHebrew
                        ? "מזעור שאלת הגיבוי"
                        : "Minimize fallback question"
                    }
                    title={isHebrew ? "מזעור" : "Minimize"}
                  >
                    −
                  </button>
                  <button
                    className={styles.iconButton}
                    type="button"
                    onClick={dismissFallback}
                    aria-label={
                      isHebrew
                        ? "הסתרת שאלת הגיבוי בתחנה הזו"
                        : "Dismiss fallback for this checkpoint"
                    }
                    title={isHebrew ? "הסתרה" : "Dismiss"}
                  >
                    ×
                  </button>
                </span>
              </header>
              <strong id="photo-fallback-title">{fallbackPrompt}</strong>
              <form onSubmit={submitFallback}>
                <label
                  className={styles.answerLabel}
                  htmlFor="photo-fallback-answer"
                >
                  {isHebrew ? "תשובת גיבוי" : "Fallback answer"}
                </label>
                <div className={styles.answerRow}>
                  <input
                    ref={answerInputRef}
                    id="photo-fallback-answer"
                    value={answer}
                    onChange={(event) => setAnswer(event.target.value)}
                    placeholder={
                      isHebrew ? "הקלידו תשובה" : "Enter your answer"
                    }
                    autoComplete="off"
                    enterKeyHint="send"
                  />
                  <button
                    className={styles.submitButton}
                    type="submit"
                    disabled={busy === "fallback" || !answer.trim()}
                  >
                    {busy === "fallback"
                      ? isHebrew
                        ? "בודק…"
                        : "Checking…"
                      : isHebrew
                        ? "שליחה"
                        : "Submit"}
                  </button>
                </div>
              </form>
              <div
                className={styles.feedbackRegion}
                aria-live="polite"
                aria-atomic="true"
              >
                {message && (
                  <div className={styles.success} role="status">
                    {message}
                  </div>
                )}
                {error && (
                  <div className={styles.error} role="alert">
                    <span>{error}</span>
                    {prerequisite && (
                      <button
                        className={styles.prerequisiteAction}
                        type="button"
                        onClick={activatePrerequisite}
                      >
                        {prerequisite === "location"
                          ? isHebrew
                            ? "אימות מיקום עכשיו"
                            : "Verify location now"
                          : isHebrew
                            ? "חזרה להוראות הסריקה"
                            : "Return to scan instructions"}
                      </button>
                    )}
                  </div>
                )}
              </div>
            </section>
          )}

          {checkpoint.isOptional && (
            <section className={styles.optional}>
              <div>
                <strong>
                  {isHebrew ? "תחנה אופציונלית" : "Optional checkpoint"}
                </strong>
                <small>
                  {isHebrew
                    ? "אפשר לדלג ולהמשיך ללא נקודות עבור התחנה."
                    : "You may skip it and continue without earning its points."}
                </small>
              </div>
              <button
                type="button"
                onClick={skipCheckpoint}
                disabled={busy === "skip"}
              >
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

          {(message || error) && fallbackMode !== "expanded" && (
            <div
              className={styles.feedbackRegion}
              aria-live="polite"
              aria-atomic="true"
            >
              {message && (
                <div className={styles.success} role="status">
                  {message}
                </div>
              )}
              {error && (
                <div className={styles.error} role="alert">
                  {error}
                </div>
              )}
            </div>
          )}
        </aside>
      )}
    </>
  );
}
