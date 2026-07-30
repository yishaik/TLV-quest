"use client";

import { FormEvent, useEffect, useState } from "react";
import {
  actionFingerprint,
  pendingIdempotencyKey,
  settleIdempotencyKey
} from "@/lib/client-idempotency";

export function ResumeQuest() {
  const [checking, setChecking] = useState(true);
  const [runCode, setRunCode] = useState("");
  const [recoveryCode, setRecoveryCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const token = window.localStorage.getItem("tlvQuestParticipantToken");
    if (token) {
      window.location.replace(`/play/${encodeURIComponent(token)}`);
      return;
    }
    const queryRun = new URL(window.location.href).searchParams.get("run");
    const timer = window.setTimeout(() => {
      if (queryRun) setRunCode(queryRun.toUpperCase().slice(0, 12));
      setChecking(false);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  async function recover(event: FormEvent) {
    event.preventDefault();
    const normalizedRun = runCode.trim().toUpperCase();
    const normalizedRecovery = recoveryCode.trim().toUpperCase();
    const scope = actionFingerprint(`${normalizedRun}:${normalizedRecovery}`);
    const idempotencyKey = pendingIdempotencyKey("recovery", scope);
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/resume", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": idempotencyKey
        },
        body: JSON.stringify({
          runCode: normalizedRun,
          recoveryCode: normalizedRecovery
        })
      });
      settleIdempotencyKey("recovery", scope, response);
      const payload = await response.json();
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error?.message ?? "Recovery failed");
      }
      const participantToken = String(payload.data.participantToken);
      window.localStorage.setItem(
        "tlvQuestParticipantToken",
        participantToken
      );
      window.location.replace(
        `/play/${encodeURIComponent(participantToken)}`
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unexpected error");
      setBusy(false);
    }
  }

  return (
    <main className="site-shell page">
      <section
        className="card recovery-surface"
        style={{ maxWidth: 680, margin: "40px auto" }}
      >
        <span className="badge">TLV Quest · Recovery</span>
        <h1 className="page-title">
          {checking ? "פותח את המסע…" : "חזרה למסע בפחות מחצי דקה"}
        </h1>
        {!checking && (
          <>
            <p className="lead">
              הזינו את קוד ההרצה ואת קוד השחזור האישי שקיבלתם בהרשמה.
              הסריקה מחבר צוות פותחת את קוד ההרצה מראש.
            </p>
            <form className="recovery-form" onSubmit={recover}>
              <label className="field">
                <span>קוד הרצה / Run code</span>
                <input
                  value={runCode}
                  onChange={(event) =>
                    setRunCode(event.target.value.toUpperCase())
                  }
                  required
                  minLength={4}
                  maxLength={12}
                  autoCapitalize="characters"
                  autoComplete="off"
                />
              </label>
              <label className="field">
                <span>קוד שחזור אישי / Personal recovery code</span>
                <input
                  value={recoveryCode}
                  onChange={(event) =>
                    setRecoveryCode(event.target.value.toUpperCase())
                  }
                  required
                  minLength={4}
                  maxLength={12}
                  autoCapitalize="characters"
                  autoComplete="one-time-code"
                />
              </label>
              <button
                className="button button-primary"
                disabled={busy || !runCode.trim() || !recoveryCode.trim()}
              >
                {busy ? "משחזר גישה…" : "חזרה למשחק / Rejoin"}
              </button>
            </form>
            {error && (
              <div className="quest-feedback error" role="alert">
                {error}
              </div>
            )}
            <p className="muted">
              מטעמי אבטחה, שחזור מחליף את קישור המשחק הישן. לא נשמר כאן
              מידע אישי.
            </p>
          </>
        )}
      </section>
    </main>
  );
}
