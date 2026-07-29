"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";

type Locale = "he" | "en";
type ParticipantState = {
  participant: { firstName: string; language: Locale; whatsappConnected: boolean };
  run: {
    publicCode: string;
    status: string;
    scheduledAt: string | null;
    totalCheckpoints: number;
  };
  team: { name: string; status: string; score: number; completedCount: number };
  members: Array<{ id: string; firstName: string }>;
  checkpoint: null | {
    slug: string;
    sequenceNo: number;
    kind: string;
    content: Record<string, unknown>;
    validation: Record<string, unknown>;
    fallback: Record<string, unknown> | null;
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

const contentFor = (
  checkpoint: NonNullable<ParticipantState["checkpoint"]>,
  locale: Locale
) => {
  const raw = checkpoint.content[locale];
  const content =
    raw && typeof raw === "object" && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};
  const text = (key: string) =>
    typeof content[key] === "string" ? String(content[key]) : "";
  return {
    title: text("title"),
    story: text("story"),
    prompt: text("prompt"),
    locationHint: text("locationHint"),
    success: text("success")
  };
};

const statusCopy = (status: string, he: boolean) => {
  const map: Record<string, [string, string]> = {
    waiting: ["ממתינים", "Waiting"],
    travelling: ["בדרך", "En route"],
    solving: ["פותרים", "Solving"],
    finished: ["סיימו", "Finished"],
    disqualified: ["נפסלו", "Disqualified"]
  };
  return map[status]?.[he ? 0 : 1] ?? status;
};

const validationOptions = (
  checkpoint: NonNullable<ParticipantState["checkpoint"]>
) =>
  Array.isArray(checkpoint.validation.options)
    ? checkpoint.validation.options.filter(
        (option): option is string => typeof option === "string" && Boolean(option.trim())
      )
    : [];

export function PremiumQuestPlayer({ token }: { token: string }) {
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
    const response = await fetch(
      `/api/participants/${encodeURIComponent(token)}/state`,
      { cache: "no-store" }
    );
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
    let timer: number | undefined;

    const refresh = async () => {
      if (document.visibilityState === "hidden") return;
      try {
        const next = await loadState();
        if (!cancelled) await loadBoard(next.run.publicCode);
      } catch (cause) {
        if (!cancelled) {
          setError(cause instanceof Error ? cause.message : "Unexpected error");
        }
      }
    };
    const start = () => {
      void refresh();
      window.clearInterval(timer);
      timer = window.setInterval(refresh, 7000);
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") start();
    };
    start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [loadBoard, loadState, token]);

  useEffect(() => {
    setLocationVerified(false);
    setMessage("");
    setError("");
    setAnswer("");
  }, [state?.checkpoint?.slug]);

  const language = state?.participant.language ?? "he";
  const isHebrew = language === "he";
  const mission = useMemo(
    () => (state?.checkpoint ? contentFor(state.checkpoint, language) : null),
    [language, state?.checkpoint]
  );
  const choices = useMemo(
    () => (state?.checkpoint ? validationOptions(state.checkpoint) : []),
    [state?.checkpoint]
  );

  async function sendAnswer(value: string) {
    const submitted = value.trim();
    if (!submitted) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch(
        `/api/participants/${encodeURIComponent(token)}/answer`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "idempotency-key": `web-answer:${crypto.randomUUID()}`
          },
          body: JSON.stringify({ answer: submitted })
        }
      );
      const payload = await response.json();
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error?.message ?? "Answer failed");
      }
      if (payload.data.evaluation.correct) {
        setMessage(
          mission?.success ||
            (isHebrew
              ? "המפתח נמצא. התחנה הבאה נפתחת…"
              : "Key found. Unlocking the next checkpoint…")
        );
        setAnswer("");
        window.setTimeout(() => void loadState(), 850);
      } else {
        setError(
          isHebrew
            ? "זה עדיין לא המפתח. הסתכלו שוב על הפרטים סביבכם."
            : "That is not the key yet. Look at the details around you again."
        );
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unexpected error");
    } finally {
      setBusy(false);
    }
  }

  async function submitAnswer(event: FormEvent) {
    event.preventDefault();
    await sendAnswer(answer);
  }

  async function requestHint() {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch(
        `/api/participants/${encodeURIComponent(token)}/hint`,
        {
          method: "POST",
          headers: { "idempotency-key": `web-hint:${crypto.randomUUID()}` }
        }
      );
      const payload = await response.json();
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error?.message ?? "Hint failed");
      }
      setMessage(
        `${isHebrew ? "רמז שנחשף" : "Revealed hint"}: ${payload.data.hint}`
      );
      await loadState();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unexpected error");
    } finally {
      setBusy(false);
    }
  }

  function verifyCurrentLocation() {
    if (!navigator.geolocation) {
      setError(
        isHebrew
          ? "שירותי מיקום אינם זמינים במכשיר."
          : "Location services are unavailable."
      );
      return;
    }
    setBusy(true);
    setError("");
    setMessage("");
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
            throw new Error(
              payload.error?.message ?? "Location verification failed"
            );
          }
          if (payload.data.verified) {
            setLocationVerified(true);
            setMessage(
              isHebrew
                ? "המיקום אומת. אתם במקום הנכון."
                : "Location verified. You are in the right place."
            );
          } else {
            setError(
              isHebrew
                ? `האות עדיין חלש — אתם במרחק של כ־${payload.data.distanceMeters} מטר.`
                : `The signal is still weak — about ${payload.data.distanceMeters}m away.`
            );
          }
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : "Unexpected error");
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
      const form = new FormData();
      form.set("photo", photo);
      const response = await fetch(
        `/api/participants/${encodeURIComponent(token)}/photo`,
        {
          method: "POST",
          headers: { "idempotency-key": `web-photo:${crypto.randomUUID()}` },
          body: form
        }
      );
      const payload = await response.json();
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error?.message ?? "Photo validation failed");
      }
      if (payload.data.approved) {
        setMessage(
          mission?.success ||
            (isHebrew
              ? "התמונה אושרה. הסיפור ממשיך…"
              : "Photo approved. The story continues…")
        );
        setPhoto(null);
        window.setTimeout(() => void loadState(), 850);
      } else {
        const fallback = payload.data.fallback;
        const fallbackText =
          fallback && typeof fallback[language] === "string"
            ? fallback[language]
            : isHebrew
              ? "לא הצלחנו לזהות את הרגע. נסו צילום נוסף או השתמשו בשאלת הגיבוי."
              : "We could not verify the moment. Try another photo or use the fallback question.";
        setError(fallbackText);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unexpected error");
    } finally {
      setBusy(false);
    }
  }

  if (!state) {
    return (
      <main className="quest-experience">
        <div className="quest-loading">
          <img src="/visuals/quest-mark.svg" alt="" />
          <span>{error || (isHebrew ? "מאתר את האות…" : "Locating the signal…")}</span>
        </div>
      </main>
    );
  }

  const total = Math.max(1, state.run.totalCheckpoints || 1);
  const progress = Math.min(100, (state.team.completedCount / total) * 100);

  if (state.run.status !== "active") {
    return (
      <main className="quest-experience" dir={isHebrew ? "rtl" : "ltr"}>
        <div className="quest-ambient" />
        <section className="quest-state-card">
          <img className="quest-state-mark" src="/visuals/quest-mark.svg" alt="" />
          <span className="quest-kicker">
            {isHebrew ? "האות ממתין" : "Signal on standby"}
          </span>
          <h1>
            {isHebrew
              ? `ברוכים הבאים, ${state.participant.firstName}`
              : `Welcome, ${state.participant.firstName}`}
          </h1>
          <p>
            {isHebrew
              ? "כשהקבוצות יהיו מוכנות, המסע ייפתח כאן אוטומטית. השאירו את הטלפון זמין והביטו סביבכם."
              : "The quest will unlock here automatically when every team is ready. Keep your phone nearby and look around."}
          </p>
          <div className="quest-waiting-meta">
            <span>{state.team.name}</span>
            <span>{state.run.publicCode}</span>
          </div>
        </section>
      </main>
    );
  }

  if (!state.checkpoint || state.team.status === "finished") {
    return (
      <main
        className="quest-experience quest-finale"
        dir={isHebrew ? "rtl" : "ltr"}
      >
        <div className="quest-ambient" />
        <section className="quest-state-card">
          <img className="quest-state-mark" src="/visuals/quest-mark.svg" alt="" />
          <span className="quest-kicker">
            {isHebrew ? "הקפסולה נפתחה" : "The capsule is open"}
          </span>
          <h1>{isHebrew ? "הסיפור הושלם." : "The story is complete."}</h1>
          <p>
            {isHebrew
              ? `צברתם ${state.team.score} נקודות. התוצאות נשארות פתוחות ל־72 שעות.`
              : `You collected ${state.team.score} points. Results remain open for 72 hours.`}
          </p>
          <a
            className="button quest-gold-button"
            href={`/live/${state.run.publicCode}`}
          >
            {isHebrew ? "פתיחת תוצאות" : "Open results"}
          </a>
        </section>
      </main>
    );
  }

  const needsLocation =
    state.checkpoint.latitude !== null && state.checkpoint.radiusMeters !== null;
  const isChoice = state.checkpoint.kind === "choice" && choices.length > 0;

  return (
    <main className="quest-experience" dir={isHebrew ? "rtl" : "ltr"}>
      <div className="quest-ambient" />
      <header className="quest-experience-header">
        <div className="quest-team">
          <img src="/visuals/quest-mark.svg" alt="" />
          <div>
            <strong>{state.team.name}</strong>
            <span>
              {state.team.score} {isHebrew ? "נקודות" : "points"}
            </span>
          </div>
        </div>
        <div className="quest-stage">
          {state.checkpoint.sequenceNo}
          <small>/ {total}</small>
        </div>
      </header>

      <div className="quest-progress" aria-label="Quest progress">
        <span style={{ width: `${progress}%` }} />
      </div>

      <section className="mission-panel">
        <div className="mission-index">
          <span>{isHebrew ? "תחנה" : "Checkpoint"}</span>
          <strong>{String(state.checkpoint.sequenceNo).padStart(2, "0")}</strong>
        </div>
        <div className="mission-copy">
          <span className="quest-kicker">
            {statusCopy(state.team.status, isHebrew)}
          </span>
          <h1>{mission?.title}</h1>
          <p className="mission-story">{mission?.story}</p>
          {mission?.locationHint && (
            <div className="mission-location">
              <span>⌖</span>
              <p>{mission.locationHint}</p>
            </div>
          )}
          <div className="mission-divider" />
          <h2>{mission?.prompt}</h2>

          {needsLocation && (
            <button
              className={`location-signal ${locationVerified ? "verified" : ""}`}
              type="button"
              disabled={busy || locationVerified}
              onClick={verifyCurrentLocation}
            >
              <span className="signal-rings" />
              <strong>
                {locationVerified
                  ? isHebrew
                    ? "המיקום אומת"
                    : "Location verified"
                  : isHebrew
                    ? "אימות נוכחות בתחנה"
                    : "Verify checkpoint presence"}
              </strong>
              <small>
                {isHebrew
                  ? "נשתמש במיקום רק לצורך האימות הנקודתי"
                  : "Location is used only for this point-in-time check"}
              </small>
            </button>
          )}

          {state.checkpoint.kind === "photo" ? (
            <form onSubmit={submitPhoto} className="mission-form">
              <label className="photo-drop">
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  capture="environment"
                  onChange={(event) => setPhoto(event.target.files?.[0] ?? null)}
                />
                <span>＋</span>
                <strong>
                  {photo
                    ? photo.name
                    : isHebrew
                      ? "צלמו או בחרו תמונה"
                      : "Take or choose a photo"}
                </strong>
              </label>
              <button className="button quest-gold-button" disabled={busy || !photo}>
                {busy
                  ? isHebrew
                    ? "בודק את הרגע…"
                    : "Checking the moment…"
                  : isHebrew
                    ? "שליחת התמונה"
                    : "Submit photo"}
              </button>
            </form>
          ) : isChoice ? (
            <div className="mission-form" role="group" aria-label={mission?.prompt}>
              {choices.map((choice) => (
                <button
                  type="button"
                  className="button button-secondary"
                  key={choice}
                  disabled={busy}
                  onClick={() => void sendAnswer(choice)}
                >
                  {choice}
                </button>
              ))}
            </div>
          ) : (
            <form onSubmit={submitAnswer} className="mission-form">
              <label>
                <span>{isHebrew ? "המפתח שלכם" : "Your key"}</span>
                <input
                  value={answer}
                  onChange={(event) => setAnswer(event.target.value)}
                  autoComplete="off"
                  enterKeyHint="send"
                />
              </label>
              <button
                className="button quest-gold-button"
                disabled={busy || !answer.trim()}
              >
                {busy
                  ? isHebrew
                    ? "בודק…"
                    : "Checking…"
                  : isHebrew
                    ? "פתיחת התחנה"
                    : "Unlock checkpoint"}
              </button>
            </form>
          )}

          {message && (
            <div className="quest-feedback success" role="status">
              ✦ {message}
            </div>
          )}
          {error && (
            <div className="quest-feedback error" role="alert">
              {error}
            </div>
          )}
        </div>
      </section>

      <nav className="quest-dock" aria-label="Quest tools">
        <button onClick={() => setDrawer("team")}>
          <span>♟</span>
          {isHebrew ? "צוות" : "Team"}
        </button>
        <button onClick={() => setDrawer("map")}>
          <span>⌖</span>
          {isHebrew ? "מפה" : "Map"}
        </button>
        <button className="hint-button" disabled={busy} onClick={requestHint}>
          <span>✦</span>
          {isHebrew ? "רמז" : "Hint"}
        </button>
        <button onClick={() => setDrawer("board")}>
          <span>≋</span>
          {isHebrew ? "מרוץ" : "Race"}
        </button>
      </nav>

      {drawer && (
        <div className="quest-drawer-backdrop" onClick={() => setDrawer(null)}>
          <section
            className="quest-drawer"
            role="dialog"
            aria-modal="true"
            onClick={(event) => event.stopPropagation()}
          >
            <header>
              <div>
                <span className="quest-kicker">TLV QUEST</span>
                <h2>
                  {drawer === "team"
                    ? isHebrew
                      ? "הצוות"
                      : "Team"
                    : drawer === "map"
                      ? isHebrew
                        ? "אזור התחנה"
                        : "Checkpoint area"
                      : isHebrew
                        ? "המרוץ החי"
                        : "Live race"}
                </h2>
              </div>
              <button onClick={() => setDrawer(null)} aria-label="Close">
                ×
              </button>
            </header>
            {drawer === "team" && (
              <div className="team-list">
                {state.members.map((member, index) => (
                  <div key={member.id}>
                    <span>{index + 1}</span>
                    <strong>{member.firstName}</strong>
                  </div>
                ))}
              </div>
            )}
            {drawer === "map" && (
              <div className="map-panel">
                <div className="map-compass" />
                <p>{mission?.locationHint}</p>
                {state.checkpoint.latitude !== null &&
                  state.checkpoint.longitude !== null && (
                    <div className="map-actions">
                      <a
                        className="button quest-gold-button"
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
                  )}
              </div>
            )}
            {drawer === "board" && (
              <div className="race-list">
                {leaderboard.map((entry, index) => (
                  <div
                    key={entry.team_name}
                    className={entry.team_name === state.team.name ? "current" : ""}
                  >
                    <span>{String(index + 1).padStart(2, "0")}</span>
                    <strong>{entry.team_name}</strong>
                    <small>
                      {entry.completed_count}/{total}
                    </small>
                    <b>{entry.score}</b>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      )}
    </main>
  );
}
