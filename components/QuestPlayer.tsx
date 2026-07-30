"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { uploadParticipantPhoto } from "@/lib/photo-upload-client";

type ParticipantState = {
  participant: {
    firstName: string;
    language: "he" | "en";
    whatsappConnected: boolean;
  };
  run: {
    publicCode: string;
    status: string;
    scheduledAt: string | null;
  };
  team: {
    name: string;
    status: string;
    score: number;
    completedCount: number;
  };
  members: Array<{ id: string; firstName: string }>;
  checkpoint: null | {
    slug: string;
    sequenceNo: number;
    kind: string;
    content: Record<string, unknown>;
    latitude: number | null;
    longitude: number | null;
    radiusMeters: number | null;
  };
};

type LeaderboardEntry = {
  team_name: string;
  score: number;
  completed_count: number;
  status: string;
  last_progress_at: string | null;
};

type Drawer = "team" | "map" | "board" | null;

const localizedContent = (
  checkpoint: NonNullable<ParticipantState["checkpoint"]>,
  language: "he" | "en"
) => {
  const raw = checkpoint.content[language];
  const content =
    raw && typeof raw === "object" && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};
  const text = (key: string) =>
    typeof content[key] === "string" ? content[key] : "";
  return {
    title: text("title"),
    story: text("story"),
    prompt: text("prompt"),
    locationHint: text("locationHint"),
    success: text("success")
  };
};

export function QuestPlayer({ token }: { token: string }) {
  const [state, setState] = useState<ParticipantState | null>(null);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [drawer, setDrawer] = useState<Drawer>(null);
  const [answer, setAnswer] = useState("");
  const [photo, setPhoto] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [locationVerified, setLocationVerified] = useState(false);

  const loadState = useCallback(async () => {
    const response = await fetch(`/api/participants/${encodeURIComponent(token)}/state`, {
      cache: "no-store"
    });
    const payload = await response.json();
    if (!response.ok || !payload.ok) {
      throw new Error(payload.error?.message ?? "Failed to load game");
    }
    setState(payload.data);
    return payload.data as ParticipantState;
  }, [token]);

  const loadBoard = useCallback(async (code: string) => {
    const response = await fetch(`/api/leaderboard/${encodeURIComponent(code)}`, {
      cache: "no-store"
    });
    const payload = await response.json();
    if (response.ok && payload.ok) setLeaderboard(payload.data);
  }, []);

  useEffect(() => {
    localStorage.setItem("tlvQuestParticipantToken", token);
    let cancelled = false;
    const refresh = async () => {
      try {
        const next = await loadState();
        if (!cancelled) await loadBoard(next.run.publicCode);
      } catch (errorValue) {
        if (!cancelled) {
          setError(errorValue instanceof Error ? errorValue.message : "Unexpected error");
        }
      }
    };
    void refresh();
    const interval = window.setInterval(refresh, 5000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [loadBoard, loadState, token]);

  const language = state?.participant.language ?? "he";
  const isHebrew = language === "he";
  const mission = useMemo(
    () =>
      state?.checkpoint
        ? localizedContent(state.checkpoint, language)
        : null,
    [language, state?.checkpoint]
  );

  async function submitAnswer(event: FormEvent) {
    event.preventDefault();
    if (!answer.trim()) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch(`/api/participants/${encodeURIComponent(token)}/answer`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": `web-answer:${crypto.randomUUID()}`
        },
        body: JSON.stringify({ answer })
      });
      const payload = await response.json();
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error?.message ?? "Answer failed");
      }
      if (payload.data.evaluation.correct) {
        setMessage(mission?.success || (isHebrew ? "נכון!" : "Correct!"));
        setAnswer("");
        await loadState();
      } else {
        setError(isHebrew ? "לא בדיוק. נסו שוב." : "Not quite. Try again.");
      }
    } catch (errorValue) {
      setError(errorValue instanceof Error ? errorValue.message : "Unexpected error");
    } finally {
      setBusy(false);
    }
  }

  async function requestHint() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/participants/${encodeURIComponent(token)}/hint`, {
        method: "POST",
        headers: { "idempotency-key": `web-hint:${crypto.randomUUID()}` }
      });
      const payload = await response.json();
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error?.message ?? "Hint failed");
      }
      setMessage(`${isHebrew ? "רמז" : "Hint"}: ${payload.data.hint}`);
      await loadState();
    } catch (errorValue) {
      setError(errorValue instanceof Error ? errorValue.message : "Unexpected error");
    } finally {
      setBusy(false);
    }
  }

  async function verifyCurrentLocation() {
    if (!navigator.geolocation) {
      setError(isHebrew ? "המכשיר לא תומך במיקום." : "Geolocation is unavailable.");
      return;
    }
    setBusy(true);
    setError("");
    navigator.geolocation.getCurrentPosition(
      async (position) => {
        try {
          const response = await fetch(
            `/api/participants/${encodeURIComponent(token)}/location`,
            {
              method: "POST",
              headers: {
                "content-type": "application/json",
                "idempotency-key": `web-location:${crypto.randomUUID()}`
              },
              body: JSON.stringify({
                latitude: position.coords.latitude,
                longitude: position.coords.longitude
              })
            }
          );
          const payload = await response.json();
          if (!response.ok || !payload.ok) {
            throw new Error(payload.error?.message ?? "Location verification failed");
          }
          if (payload.data.verified) {
            setLocationVerified(true);
            setMessage(
              isHebrew
                ? `המיקום אומת. אתם בטווח התחנה (${payload.data.distanceMeters} מ׳).`
                : `Location verified (${payload.data.distanceMeters}m from checkpoint).`
            );
          } else {
            setError(
              isHebrew
                ? `אתם עדיין רחוקים מדי: כ־${payload.data.distanceMeters} מטר.`
                : `You are still about ${payload.data.distanceMeters}m away.`
            );
          }
        } catch (errorValue) {
          setError(errorValue instanceof Error ? errorValue.message : "Unexpected error");
        } finally {
          setBusy(false);
        }
      },
      (locationError) => {
        setBusy(false);
        setError(locationError.message);
      },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 15000 }
    );
  }

  async function submitPhoto(event: FormEvent) {
    event.preventDefault();
    if (!photo) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const result = await uploadParticipantPhoto({
        token,
        file: photo,
        locale: isHebrew ? "he" : "en"
      });
      if (result.approved) {
        setMessage(mission?.success || (isHebrew ? "התמונה אושרה." : "Photo approved."));
        setPhoto(null);
        await loadState();
      } else {
        const fallbackText =
          typeof result.fallbackPrompt === "string" &&
          result.fallbackPrompt.trim()
            ? result.fallbackPrompt
            : isHebrew
              ? "לא ניתן לאמת את התמונה. השתמשו בשאלת הגיבוי."
              : "The photo could not be verified. Use the fallback question.";
        setError(fallbackText);
      }
    } catch (errorValue) {
      setError(errorValue instanceof Error ? errorValue.message : "Unexpected error");
    } finally {
      setBusy(false);
    }
  }

  if (!state) {
    return (
      <main className="quest-shell">
        <div className="card">{error || "טוען את המסע…"}</div>
      </main>
    );
  }

  if (state.run.status !== "active") {
    return (
      <main className="quest-shell">
        <div className="quest-header">
          <strong>{state.team.name}</strong>
          <span className="badge">{state.run.publicCode}</span>
        </div>
        <section className="quest-card">
          <span className="badge">{isHebrew ? "ממתינים להתחלה" : "Waiting to start"}</span>
          <h1>{isHebrew ? `היי ${state.participant.firstName}` : `Hi ${state.participant.firstName}`}</h1>
          <p>
            {isHebrew
              ? "המארגן יתחיל את המשחק כשהקבוצות יהיו מוכנות. המסך יתעדכן אוטומטית."
              : "The organizer will start the game when everyone is ready. This screen updates automatically."}
          </p>
        </section>
      </main>
    );
  }

  if (!state.checkpoint || state.team.status === "finished") {
    return (
      <main className="quest-shell">
        <section className="quest-card">
          <span className="badge">{isHebrew ? "הקפסולה נפתחה" : "Capsule opened"}</span>
          <h1>{isHebrew ? "המסע הושלם." : "Quest complete."}</h1>
          <p>
            {isHebrew
              ? `סיימתם עם ${state.team.score} נקודות. התוצאות והגלריה זמינות למשך 72 שעות.`
              : `You finished with ${state.team.score} points. Results and gallery remain available for 72 hours.`}
          </p>
          <a className="button button-primary" href={`/live/${state.run.publicCode}`}>
            {isHebrew ? "לוח התוצאות" : "Leaderboard"}
          </a>
        </section>
      </main>
    );
  }

  const completionPercent = Math.min(100, (state.team.completedCount / 3) * 100);
  const hasLocationRequirement =
    state.checkpoint.latitude !== null && state.checkpoint.radiusMeters !== null;

  return (
    <main className="quest-shell" dir={isHebrew ? "rtl" : "ltr"}>
      <header className="quest-header">
        <div>
          <strong>{state.team.name}</strong>
          <div className="muted">{state.team.score} {isHebrew ? "נקודות" : "points"}</div>
        </div>
        <span className="badge">
          {state.team.completedCount}/3
        </span>
      </header>

      <section className="quest-card">
        <div className="progress-track" aria-label="Quest progress">
          <div className="progress-fill" style={{ width: `${completionPercent}%` }} />
        </div>
        <span className="badge" style={{ marginTop: 22 }}>
          {isHebrew ? "תחנה" : "Checkpoint"} {state.checkpoint.sequenceNo}
        </span>
        <h1>{mission?.title}</h1>
        <p>{mission?.story}</p>
        {mission?.locationHint && <div className="notice">{mission.locationHint}</div>}
        <h2 style={{ marginTop: 28 }}>{mission?.prompt}</h2>

        {hasLocationRequirement && (
          <button
            className="button button-secondary"
            type="button"
            disabled={busy || locationVerified}
            onClick={verifyCurrentLocation}
          >
            {locationVerified
              ? isHebrew ? "המיקום אומת" : "Location verified"
              : isHebrew ? "אימות מיקום" : "Verify location"}
          </button>
        )}

        {state.checkpoint.kind === "photo" ? (
          <form onSubmit={submitPhoto} className="form-grid" style={{ marginTop: 20 }}>
            <div className="field">
              <label htmlFor="photo">{isHebrew ? "בחירת תמונה" : "Choose photo"}</label>
              <input
                id="photo"
                name="photo"
                type="file"
                accept="image/jpeg,image/png,image/webp"
                capture="environment"
                onChange={(event) => setPhoto(event.target.files?.[0] ?? null)}
              />
              <small>
                {isHebrew
                  ? "JPG, PNG או WebP · עד 10MB"
                  : "JPG, PNG, or WebP · up to 10MB"}
              </small>
            </div>
            <button className="button button-primary" disabled={busy || !photo}>
              {busy ? (isHebrew ? "בודק…" : "Checking…") : (isHebrew ? "שליחת תמונה" : "Submit photo")}
            </button>
          </form>
        ) : (
          <form onSubmit={submitAnswer} className="form-grid" style={{ marginTop: 20 }}>
            <div className="field">
              <label htmlFor="answer">{isHebrew ? "התשובה שלכם" : "Your answer"}</label>
              <input
                id="answer"
                value={answer}
                onChange={(event) => setAnswer(event.target.value)}
                autoComplete="off"
                inputMode="text"
              />
            </div>
            <button className="button button-primary" disabled={busy || !answer.trim()}>
              {busy ? (isHebrew ? "שולח…" : "Sending…") : (isHebrew ? "שליחת תשובה" : "Submit answer")}
            </button>
          </form>
        )}

        {message && <div className="success" style={{ marginTop: 16 }}>{message}</div>}
        {error && <div className="error" style={{ marginTop: 16 }} role="alert">{error}</div>}
      </section>

      <div className="quest-tools">
        <button className="tool-button" onClick={() => setDrawer("team")}>{isHebrew ? "הקבוצה" : "Team"}</button>
        <button className="tool-button" onClick={() => setDrawer("map")}>{isHebrew ? "מפה" : "Map"}</button>
        <button className="tool-button" onClick={() => setDrawer("board")}>{isHebrew ? "לוח חי" : "Leaderboard"}</button>
      </div>
      <button
        className="button button-secondary"
        style={{ width: "100%", marginTop: 10 }}
        type="button"
        disabled={busy}
        onClick={requestHint}
      >
        {isHebrew ? "בקשת רמז" : "Request hint"}
      </button>

      {drawer && (
        <div className="drawer-backdrop" role="presentation" onClick={() => setDrawer(null)}>
          <section className="drawer" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
              <h2>
                {drawer === "team"
                  ? isHebrew ? "הקבוצה" : "Team"
                  : drawer === "map"
                    ? isHebrew ? "אזור התחנה" : "Checkpoint area"
                    : isHebrew ? "לוח חי" : "Leaderboard"}
              </h2>
              <button className="button button-secondary" onClick={() => setDrawer(null)}>
                {isHebrew ? "סגירה" : "Close"}
              </button>
            </div>

            {drawer === "team" && (
              <div className="grid">
                {state.members.map((member) => (
                  <div className="card" key={member.id}>{member.firstName}</div>
                ))}
              </div>
            )}

            {drawer === "map" && (
              <div className="grid">
                <p>{mission?.locationHint}</p>
                {state.checkpoint.latitude !== null && state.checkpoint.longitude !== null ? (
                  <div className="actions">
                    <a
                      className="button button-primary"
                      href={`https://www.google.com/maps/search/?api=1&query=${state.checkpoint.latitude},${state.checkpoint.longitude}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Google Maps
                    </a>
                    <a
                      className="button button-secondary"
                      href={`https://waze.com/ul?ll=${state.checkpoint.latitude},${state.checkpoint.longitude}&navigate=yes`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Waze
                    </a>
                  </div>
                ) : (
                  <p className="muted">{isHebrew ? "התחנה נפתחת באמצעות רמז בלבד." : "This checkpoint uses clues rather than a precise pin."}</p>
                )}
              </div>
            )}

            {drawer === "board" && (
              <div className="table-wrap">
                <table className="leaderboard">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>{isHebrew ? "קבוצה" : "Team"}</th>
                      <th>{isHebrew ? "ניקוד" : "Score"}</th>
                      <th>{isHebrew ? "תחנות" : "Stops"}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {leaderboard.map((entry, index) => (
                      <tr key={entry.team_name}>
                        <td>{index + 1}</td>
                        <td>{entry.team_name}</td>
                        <td>{entry.score}</td>
                        <td>{entry.completed_count}/3</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      )}
    </main>
  );
}
