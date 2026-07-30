"use client";

import { useEffect, useState } from "react";

export function StationScanner({ stationSlug }: { stationSlug: string }) {
  const [status, setStatus] = useState("מזהה את הקבוצה…");
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;

    const scan = async () => {
      const token = localStorage.getItem("tlvQuestParticipantToken");
      if (!token) {
        throw new Error(
          "לא נמצא קישור אישי במכשיר. פתחו קודם את קישור המשחק האישי ואז סרקו שוב."
        );
      }
      const storageKey = `tlvQuest:stationScan:${stationSlug}:${token}`;
      const idempotencyKey =
        sessionStorage.getItem(storageKey) ??
        `web-station-scan:${crypto.randomUUID()}`;
      sessionStorage.setItem(storageKey, idempotencyKey);

      const response = await fetch(
        `/api/participants/${encodeURIComponent(token)}/scan`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "idempotency-key": idempotencyKey
          },
          body: JSON.stringify({ stationSlug })
        }
      );
      const payload = await response.json();
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error?.message ?? "התחנה אינה זמינה כרגע");
      }

      if (!active) return;
      setStatus(
        payload.data.completed
          ? "התחנה הושלמה. עוברים למשימה הבאה…"
          : "הסריקה אושרה. חוזרים לפתור את החידה…"
      );
      window.setTimeout(() => {
        window.location.href = `/play/${token}`;
      }, 900);
    };

    void Promise.resolve()
      .then(scan)
      .catch((errorValue) => {
        if (active) {
          setError(
            errorValue instanceof Error ? errorValue.message : "שגיאה לא צפויה"
          );
        }
      });

    return () => {
      active = false;
    };
  }, [stationSlug]);

  return (
    <main className="site-shell page">
      <section className="card" style={{ maxWidth: 620, margin: "40px auto" }}>
        <span className="badge">QR / NFC</span>
        <h1>תחנת {stationSlug}</h1>
        {!error && <div className="notice">{status}</div>}
        {error && <div className="error">{error}</div>}
      </section>
    </main>
  );
}
