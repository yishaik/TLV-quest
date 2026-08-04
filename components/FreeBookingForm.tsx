"use client";

import { useState } from "react";

type Locale = "he" | "en";

type Created = {
  joinUrl: string;
  manageUrl: string;
  liveUrl: string;
  publicCode: string;
  remainingFreeRuns: number;
};

const copy = {
  he: {
    name: "שם מלא",
    email: "אימייל",
    participants: "כמה משתתפים (עד 30)",
    stations: "כמה תחנות תרצו במשחק?",
    stationNote: "המערכת שומרת על תחנת הפתיחה, הסיום והסדר המקורי ביניהן.",
    submit: "צרו משחק חינם",
    working: "יוצר…",
    doneTitle: "המשחק שלכם מוכן",
    joinLabel: "קישור הצטרפות למשתתפים",
    manageLabel: "קישור ניהול — שמרו אותו, הוא מוצג פעם אחת",
    liveLabel: "לוח תוצאות",
    code: "קוד הצטרפות",
    remaining: (n: number) => `נותרו לכם ${n} משחקים חינם`,
    warning:
      "קישור הניהול הוא המפתח היחיד למשחק. אם תאבדו אותו לא נוכל לשחזר אותו.",
    limit: "הגעתם למכסת שלושת המשחקים החינמיים."
  },
  en: {
    name: "Full name",
    email: "Email",
    participants: "How many participants (up to 30)",
    stations: "How many stops should the game include?",
    stationNote: "The opening, finale and authored route order are preserved.",
    submit: "Create a free game",
    working: "Creating…",
    doneTitle: "Your game is ready",
    joinLabel: "Participant join link",
    manageLabel: "Management link — save it, it is shown once",
    liveLabel: "Leaderboard",
    code: "Join code",
    remaining: (n: number) => `You have ${n} free games left`,
    warning:
      "The management link is the only key to this game. We cannot recover it if it is lost.",
    limit: "You have used all three free games."
  }
} as const;

export function FreeBookingForm({
  locale,
  templateSlug,
  checkpointCount
}: {
  locale: Locale;
  templateSlug: string;
  checkpointCount: number;
}) {
  const t = copy[locale];
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [participants, setParticipants] = useState("2");
  const [stations, setStations] = useState(String(Math.min(6, checkpointCount)));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [created, setCreated] = useState<Created | null>(null);

  const submit = async () => {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/runs/free", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name,
          email,
          templateSlug,
          maxParticipants: Number(participants),
          checkpointCount: Number(stations),
          locale
        })
      });
      const raw = await response.text();
      let payload: { ok?: boolean; data?: Created; error?: { message?: string; code?: string } };
      try {
        payload = JSON.parse(raw);
      } catch {
        throw new Error(`${response.status}`);
      }
      if (!response.ok || !payload.ok || !payload.data) {
        throw new Error(
          payload.error?.code === "free_booking_limit_reached"
            ? t.limit
            : payload.error?.message ?? "…"
        );
      }
      setCreated(payload.data);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "…");
    } finally {
      setBusy(false);
    }
  };

  if (created) {
    return (
      <div className="marketing-booking marketing-booking-done">
        <h3>{t.doneTitle}</h3>
        <p className="marketing-booking-warning">{t.warning}</p>
        <label>{t.manageLabel}</label>
        <input readOnly value={created.manageUrl} onFocus={(e) => e.target.select()} />
        <label>{t.joinLabel}</label>
        <input readOnly value={created.joinUrl} onFocus={(e) => e.target.select()} />
        <label>{t.liveLabel}</label>
        <input readOnly value={created.liveUrl} onFocus={(e) => e.target.select()} />
        <p className="marketing-booking-meta">
          {t.code}: <strong>{created.publicCode}</strong> ·{" "}
          {t.remaining(created.remainingFreeRuns)}
        </p>
      </div>
    );
  }

  return (
    <div className="marketing-booking">
      <label>{t.name}</label>
      <input value={name} onChange={(event) => setName(event.target.value)} />
      <label>{t.email}</label>
      <input
        type="email"
        inputMode="email"
        value={email}
        onChange={(event) => setEmail(event.target.value)}
      />
      <label>{t.participants}</label>
      <input
        inputMode="numeric"
        value={participants}
        onChange={(event) => setParticipants(event.target.value)}
      />
      <label>{t.stations}</label>
      <select value={stations} onChange={(event) => setStations(event.target.value)}>
        {Array.from({ length: Math.max(1, checkpointCount - 3) }, (_, index) => index + Math.min(4, checkpointCount))
          .filter((count) => count <= checkpointCount)
          .map((count) => <option key={count} value={count}>{count}</option>)}
      </select>
      <small>{t.stationNote}</small>
      <button
        type="button"
        onClick={() => void submit()}
        disabled={busy || !name.trim() || !email.trim()}
      >
        {busy ? t.working : t.submit}
      </button>
      {error && <p className="marketing-booking-error">{error}</p>}
    </div>
  );
}
