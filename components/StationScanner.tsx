"use client";

import { useEffect, useState } from "react";

export function StationScanner({ stationSlug }: { stationSlug: string }) {
  const [status, setStatus] = useState("מזהה את הקבוצה…");
  const [error, setError] = useState("");

  useEffect(() => {
    const token = localStorage.getItem("tlvQuestParticipantToken");
    if (!token) {
      setError("לא נמצא קישור אישי במכשיר. פתחו קודם את קישור המשחק האישי ואז סרקו שוב.");
      return;
    }

    const scan = async () => {
      try {
        const response = await fetch(`/api/participants/${encodeURIComponent(token)}/scan`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "idempotency-key": `station:${stationSlug}:${token}`
          },
          body: JSON.stringify({ stationSlug })
        });
        const payload = await response.json();
        if (!response.ok || !payload.ok) {
          throw new Error(payload.error?.message ?? "התחנה אינה זמינה כרגע");
        }
        setStatus("התחנה זוהתה. חוזרים למשימה…");
        window.setTimeout(() => {
          window.location.href = `/play/${token}`;
        }, 900);
      } catch (errorValue) {
        setError(errorValue instanceof Error ? errorValue.message : "שגיאה לא צפויה");
      }
    };

    void scan();
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
