"use client";

import {
  FormEvent,
  useEffect,
  useMemo,
  useState,
  type CSSProperties
} from "react";
import QRCode from "qrcode";
import { useQuestRealtime } from "@/components/QuestRealtimeProvider";
import {
  actionFingerprint,
  pendingIdempotencyKey,
  settleIdempotencyKey
} from "@/lib/client-idempotency";

type Locale = "he" | "en";
type ParticipantState = {
  participant: {
    firstName: string;
    language: Locale;
    whatsappConnected: boolean;
    recoveryUrl: string;
  };
  run: {
    publicCode: string;
    status: string;
    scheduledAt: string | null;
    totalCheckpoints: number;
  };
  team: { name: string; status: string; score: number; completedCount: number };
  members: Array<{ id: string; firstName: string }>;
  branding: {
    productName: string;
    primaryColor: string;
    surfaceColor: string;
    logoUrl: string;
  };
  difficulty: {
    level: "challenge" | "standard" | "assisted";
    reason: "fast_progress" | "steady_progress" | "needs_support";
    rewardMultiplier: number;
    penaltyMultiplier: number;
  };
  hintOffer: null | {
    available: boolean;
    reason: "wrong_attempts" | "inactivity" | "locked";
    penalty: number;
    index: number;
    total: number;
    wrongAttemptsToUnlock: number;
    unlockAt: string;
    secondsUntilUnlock: number;
  };
  checkpoint: null | {
    slug: string;
    sequenceNo: number;
    kind: string;
    content: Record<string, unknown>;
    choiceOptions: string[];
    fallbackPrompt: string | null;
    hasFallback: boolean;
    latitude: number | null;
    longitude: number | null;
    radiusMeters: number | null;
  };
};

type Drawer = "team" | "map" | "board" | null;
type NavigationState = {
  status:
    | "idle"
    | "locating"
    | "ready"
    | "low-accuracy"
    | "denied"
    | "unavailable";
  distanceMeters: number | null;
  bearing: number | null;
  accuracy: number | null;
};

const toRadians = (value: number) => (value * Math.PI) / 180;
const toDegrees = (value: number) => (value * 180) / Math.PI;

const distanceBetween = (
  latitude: number,
  longitude: number,
  targetLatitude: number,
  targetLongitude: number
) => {
  const earthRadius = 6_371_000;
  const latitudeDelta = toRadians(targetLatitude - latitude);
  const longitudeDelta = toRadians(targetLongitude - longitude);
  const originLatitude = toRadians(latitude);
  const destinationLatitude = toRadians(targetLatitude);
  const value =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(originLatitude) *
      Math.cos(destinationLatitude) *
      Math.sin(longitudeDelta / 2) ** 2;
  return Math.round(
    earthRadius * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value))
  );
};

const bearingBetween = (
  latitude: number,
  longitude: number,
  targetLatitude: number,
  targetLongitude: number
) => {
  const originLatitude = toRadians(latitude);
  const destinationLatitude = toRadians(targetLatitude);
  const longitudeDelta = toRadians(targetLongitude - longitude);
  const y = Math.sin(longitudeDelta) * Math.cos(destinationLatitude);
  const x =
    Math.cos(originLatitude) * Math.sin(destinationLatitude) -
    Math.sin(originLatitude) *
      Math.cos(destinationLatitude) *
      Math.cos(longitudeDelta);
  return (toDegrees(Math.atan2(y, x)) + 360) % 360;
};

const cardinalDirection = (bearing: number, he: boolean) => {
  const hebrew = ["צפון", "צפון־מזרח", "מזרח", "דרום־מזרח", "דרום", "דרום־מערב", "מערב", "צפון־מערב"];
  const english = ["north", "north-east", "east", "south-east", "south", "south-west", "west", "north-west"];
  return (he ? hebrew : english)[Math.round(bearing / 45) % 8];
};

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
) => checkpoint.choiceOptions;

export function PremiumQuestPlayer({ token }: { token: string }) {
  const {
    state: realtimeState,
    leaderboard,
    connected,
    error: realtimeError,
    refresh
  } = useQuestRealtime();
  const state = realtimeState as ParticipantState | null;
  const [drawer, setDrawer] = useState<Drawer>(null);
  const [answer, setAnswer] = useState("");
  const [photo, setPhoto] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [locationVerified, setLocationVerified] = useState(false);
  const [navigation, setNavigation] = useState<NavigationState>({
    status: "idle",
    distanceMeters: null,
    bearing: null,
    accuracy: null
  });
  const [recoveryQr, setRecoveryQr] = useState("");
  const [muted, setMuted] = useState(false);
  const [celebrate, setCelebrate] = useState(false);
  const [clock, setClock] = useState(() => Date.now());
  const [epilogue, setEpilogue] = useState("");

  useEffect(() => {
    setLocationVerified(false);
    setMessage("");
    setError("");
    setAnswer("");
    setNavigation({
      status: "idle",
      distanceMeters: null,
      bearing: null,
      accuracy: null
    });
  }, [state?.checkpoint?.slug]);

  useEffect(() => {
    setMuted(window.localStorage.getItem("tlvQuestMuted") === "true");
  }, []);

  useEffect(() => {
    if (state?.hintOffer?.available || !state?.hintOffer) return;
    let timer: number | undefined;
    const tick = () => {
      setClock(Date.now());
      timer = window.setTimeout(tick, 1000);
    };
    timer = window.setTimeout(tick, 1000);
    return () => window.clearTimeout(timer);
  }, [state?.hintOffer]);

  useEffect(() => {
    if (!state?.participant.recoveryUrl) {
      setRecoveryQr("");
      return;
    }
    let cancelled = false;
    void QRCode.toDataURL(state.participant.recoveryUrl, {
      width: 220,
      margin: 1,
      color: { dark: "#07111c", light: "#f3eee3" },
      errorCorrectionLevel: "M"
    }).then((value) => {
      if (!cancelled) setRecoveryQr(value);
    });
    return () => {
      cancelled = true;
    };
  }, [state?.participant.recoveryUrl]);

  useEffect(() => {
    if (!state || (state.team.status !== "finished" && state.run.status !== "finished")) {
      return;
    }
    let cancelled = false;
    void fetch(`/api/participants/${encodeURIComponent(token)}/epilogue`, {
      cache: "no-store"
    })
      .then((response) => response.json())
      .then((payload) => {
        if (!cancelled && payload.ok && typeof payload.data?.body === "string") {
          setEpilogue(payload.data.body);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [state, token]);

  useEffect(() => {
    const checkpoint = state?.checkpoint;
    if (
      drawer !== "map" ||
      !checkpoint ||
      checkpoint.latitude === null ||
      checkpoint.longitude === null
    ) {
      return;
    }
    if (!navigator.geolocation) {
      setNavigation({
        status: "unavailable",
        distanceMeters: null,
        bearing: null,
        accuracy: null
      });
      return;
    }

    setNavigation((current) => ({ ...current, status: "locating" }));
    const watchId = navigator.geolocation.watchPosition(
      (position) => {
        const accuracy = Math.round(position.coords.accuracy);
        const lowAccuracy =
          accuracy > Math.max(80, (checkpoint.radiusMeters ?? 40) * 2);
        setNavigation({
          status: lowAccuracy ? "low-accuracy" : "ready",
          distanceMeters: distanceBetween(
            position.coords.latitude,
            position.coords.longitude,
            checkpoint.latitude as number,
            checkpoint.longitude as number
          ),
          bearing: bearingBetween(
            position.coords.latitude,
            position.coords.longitude,
            checkpoint.latitude as number,
            checkpoint.longitude as number
          ),
          accuracy
        });
      },
      (cause) => {
        setNavigation({
          status: cause.code === cause.PERMISSION_DENIED ? "denied" : "unavailable",
          distanceMeters: null,
          bearing: null,
          accuracy: null
        });
      },
      { enableHighAccuracy: true, maximumAge: 10_000, timeout: 12_000 }
    );
    return () => navigator.geolocation.clearWatch(watchId);
  }, [drawer, state?.checkpoint]);

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
  const hintSecondsRemaining = state?.hintOffer
    ? Math.max(
        0,
        Math.ceil(
          (new Date(state.hintOffer.unlockAt).getTime() - clock) / 1000
        )
      )
    : 0;

  function sensorySignal(kind: "success" | "error" | "hint" | "location") {
    if (muted) return;
    const vibration: Record<typeof kind, number | number[]> = {
      success: [55, 35, 85],
      error: [80, 45, 80],
      hint: 45,
      location: [35, 25, 35]
    };
    navigator.vibrate?.(vibration[kind]);
    try {
      const audio = new AudioContext();
      const oscillator = audio.createOscillator();
      const gain = audio.createGain();
      const frequencies = {
        success: 660,
        error: 180,
        hint: 520,
        location: 740
      };
      oscillator.frequency.value = frequencies[kind];
      oscillator.type = kind === "error" ? "sawtooth" : "sine";
      gain.gain.setValueAtTime(0.0001, audio.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.08, audio.currentTime + 0.01);
      gain.gain.exponentialRampToValueAtTime(
        0.0001,
        audio.currentTime + 0.18
      );
      oscillator.connect(gain);
      gain.connect(audio.destination);
      oscillator.start();
      oscillator.stop(audio.currentTime + 0.2);
      window.setTimeout(() => void audio.close(), 300);
    } catch {
      // Haptics remain available when Web Audio is blocked by the browser.
    }
  }

  function celebrateSuccess() {
    sensorySignal("success");
    if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setCelebrate(true);
      window.setTimeout(() => setCelebrate(false), 1700);
    }
  }

  function toggleMuted() {
    const next = !muted;
    setMuted(next);
    window.localStorage.setItem("tlvQuestMuted", String(next));
    if (!next) window.setTimeout(() => sensorySignal("hint"), 0);
  }

  function readStoryAloud() {
    if (!mission?.story || !("speechSynthesis" in window)) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(mission.story);
    utterance.lang = isHebrew ? "he-IL" : "en-US";
    utterance.rate = 0.94;
    window.speechSynthesis.speak(utterance);
  }

  async function generateEpilogue() {
    if (!state) return;
    setBusy(true);
    setError("");
    try {
      const scope = `${state.team.name}:${state.run.publicCode}:${language}`;
      const response = await fetch(
        `/api/participants/${encodeURIComponent(token)}/epilogue`,
        {
          method: "POST",
          headers: {
            "idempotency-key": pendingIdempotencyKey(
              "quest-epilogue",
              actionFingerprint(scope)
            )
          }
        }
      );
      settleIdempotencyKey(
        "quest-epilogue",
        actionFingerprint(scope),
        response
      );
      const payload = await response.json();
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error?.message ?? "Epilogue generation failed");
      }
      setEpilogue(payload.data.body);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unexpected error");
    } finally {
      setBusy(false);
    }
  }

  async function shareRecovery() {
    if (!state?.participant.recoveryUrl) return;
    const shareData = {
      title: "TLV Quest recovery",
      text: isHebrew
        ? `סרקו וחזרו להרצה ${state.run.publicCode} עם קוד השחזור האישי.`
        : `Scan to rejoin run ${state.run.publicCode} with your personal recovery code.`,
      url: state.participant.recoveryUrl
    };
    if (navigator.share) {
      await navigator.share(shareData);
    } else {
      await navigator.clipboard.writeText(state.participant.recoveryUrl);
      setMessage(isHebrew ? "קישור השחזור הועתק." : "Recovery link copied.");
    }
  }

  async function sendAnswer(value: string) {
    const submitted = value.trim();
    if (!submitted) return;
    const idempotencyPrefix = "web-answer";
    const idempotencyScope = `${state?.checkpoint?.slug ?? "none"}:${actionFingerprint(submitted)}`;
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
            "idempotency-key": pendingIdempotencyKey(
              idempotencyPrefix,
              idempotencyScope
            )
          },
          body: JSON.stringify({ answer: submitted })
        }
      );
      settleIdempotencyKey(idempotencyPrefix, idempotencyScope, response);
      const payload = await response.json();
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error?.message ?? "Answer failed");
      }
      if (payload.data.evaluation.correct) {
        celebrateSuccess();
        setMessage(
          mission?.success ||
            (isHebrew
              ? "המפתח נמצא. התחנה הבאה נפתחת…"
              : "Key found. Unlocking the next checkpoint…")
        );
        setAnswer("");
        window.setTimeout(() => void refresh(), 850);
      } else {
        sensorySignal("error");
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
    if (!state?.hintOffer?.available) {
      setError(
        isHebrew
          ? "הרמז ייפתח אחרי שני ניסיונות או אחרי זמן חיפוש נוסף."
          : "The hint unlocks after two attempts or more search time."
      );
      return;
    }
    const idempotencyPrefix = "web-hint";
    const idempotencyScope = state?.checkpoint?.slug ?? "none";
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch(
        `/api/participants/${encodeURIComponent(token)}/hint`,
        {
          method: "POST",
          headers: {
            "idempotency-key": pendingIdempotencyKey(
              idempotencyPrefix,
              idempotencyScope
            )
          }
        }
      );
      settleIdempotencyKey(idempotencyPrefix, idempotencyScope, response);
      const payload = await response.json();
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error?.message ?? "Hint failed");
      }
      setMessage(
        `${isHebrew ? "רמז שנחשף" : "Revealed hint"}: ${payload.data.hint}`
      );
      sensorySignal("hint");
      await refresh();
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
        const idempotencyPrefix = "web-location";
        const idempotencyScope = `${state?.checkpoint?.slug ?? "none"}:${position.coords.latitude.toFixed(5)}:${position.coords.longitude.toFixed(5)}`;
        try {
          const response = await fetch(
            `/api/participants/${encodeURIComponent(token)}/location`,
            {
              method: "POST",
              headers: {
                "content-type": "application/json",
                "idempotency-key": pendingIdempotencyKey(
                  idempotencyPrefix,
                  idempotencyScope
                )
              },
              body: JSON.stringify({
                latitude: position.coords.latitude,
                longitude: position.coords.longitude
              })
            }
          );
          settleIdempotencyKey(idempotencyPrefix, idempotencyScope, response);
          const payload = await response.json();
          if (!response.ok || !payload.ok) {
            throw new Error(
              payload.error?.message ?? "Location verification failed"
            );
          }
          if (payload.data.verified) {
            setLocationVerified(true);
            sensorySignal("location");
            setMessage(
              isHebrew
                ? "המיקום אומת. אתם במקום הנכון."
                : "Location verified. You are in the right place."
            );
          } else {
            sensorySignal("error");
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
        setNavigation({
          status:
            locationError.code === locationError.PERMISSION_DENIED
              ? "denied"
              : "unavailable",
          distanceMeters: null,
          bearing: null,
          accuracy: null
        });
        setError(
          locationError.code === locationError.PERMISSION_DENIED
            ? isHebrew
              ? "הרשאת המיקום נדחתה. אפשר לאפשר אותה בהגדרות האתר ולנסות שוב."
              : "Location permission was denied. Enable it in site settings and try again."
            : locationError.message
        );
      },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 15000 }
    );
  }

  async function submitPhoto(event: FormEvent) {
    event.preventDefault();
    if (!photo) return;
    const idempotencyPrefix = "web-photo";
    const idempotencyScope = `${state?.checkpoint?.slug ?? "none"}:${actionFingerprint(
      `${photo.name}:${photo.size}:${photo.lastModified}`
    )}`;
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
          headers: {
            "idempotency-key": pendingIdempotencyKey(
              idempotencyPrefix,
              idempotencyScope
            )
          },
          body: form
        }
      );
      settleIdempotencyKey(idempotencyPrefix, idempotencyScope, response);
      const payload = await response.json();
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error?.message ?? "Photo validation failed");
      }
      if (payload.data.approved) {
        celebrateSuccess();
        setMessage(
          mission?.success ||
            (isHebrew
              ? "התמונה אושרה. הסיפור ממשיך…"
              : "Photo approved. The story continues…")
        );
        setPhoto(null);
        window.setTimeout(() => void refresh(), 850);
      } else {
        sensorySignal("error");
        const fallback = payload.data.fallback;
        const fallbackText =
          typeof fallback === "string" && fallback.trim()
            ? fallback
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
          <span>{error || realtimeError || (isHebrew ? "מאתר את האות…" : "Locating the signal…")}</span>
        </div>
      </main>
    );
  }

  const total = Math.max(1, state.run.totalCheckpoints || 1);
  const progress = Math.min(100, (state.team.completedCount / total) * 100);
  const brandStyle = {
    "--quest-accent": state.branding.primaryColor,
    "--quest-surface": state.branding.surfaceColor
  } as CSSProperties;

  if (state.run.status !== "active") {
    return (
      <main
        className="quest-experience"
        dir={isHebrew ? "rtl" : "ltr"}
        style={brandStyle}
      >
        <div className="quest-ambient" />
        <section className="quest-state-card">
          <img
            className="quest-state-mark"
            src={state.branding.logoUrl}
            alt={state.branding.productName}
          />
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
        style={brandStyle}
      >
        <div className="quest-ambient" />
        <section className="quest-state-card">
          <img
            className="quest-state-mark"
            src={state.branding.logoUrl}
            alt={state.branding.productName}
          />
          <span className="quest-kicker">
            {isHebrew ? "הקפסולה נפתחה" : "The capsule is open"}
          </span>
          <h1>{isHebrew ? "הסיפור הושלם." : "The story is complete."}</h1>
          <p>
            {isHebrew
              ? `צברתם ${state.team.score} נקודות. התוצאות נשארות פתוחות ל־72 שעות.`
              : `You collected ${state.team.score} points. Results remain open for 72 hours.`}
          </p>
          {epilogue ? (
            <blockquote className="quest-epilogue">{epilogue}</blockquote>
          ) : (
            <button
              type="button"
              className="button button-secondary"
              disabled={busy}
              onClick={() => void generateEpilogue()}
            >
              {busy
                ? isHebrew
                  ? "כותב אפילוג…"
                  : "Writing epilogue…"
                : isHebrew
                  ? "יצירת אפילוג אישי"
                  : "Create personal epilogue"}
            </button>
          )}
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
    <main
      className="quest-experience"
      dir={isHebrew ? "rtl" : "ltr"}
      style={brandStyle}
    >
      <div className="quest-ambient" />
      {celebrate && (
        <div className="quest-confetti" aria-hidden="true">
          {Array.from({ length: 18 }, (_, index) => (
            <i
              key={index}
              style={
                {
                  "--x": `${2 + index * 5.5}%`,
                  "--delay": `${index * -0.035}s`,
                  "--drift": `${(index - 9) * 6}px`
                } as CSSProperties
              }
            />
          ))}
        </div>
      )}
      <header className="quest-experience-header">
        <div className="quest-team">
          <img
            src={state.branding.logoUrl}
            alt={state.branding.productName}
          />
          <div>
            <strong>{state.team.name}</strong>
            <span>
              {state.team.score} {isHebrew ? "נקודות" : "points"}
            </span>
            <small title={connected ? "Supabase Realtime connected" : "Realtime reconnecting"}>
              {connected ? (isHebrew ? "מחובר בזמן אמת" : "Live") : isHebrew ? "מתחבר מחדש…" : "Reconnecting…"}
            </small>
          </div>
        </div>
        <div className="quest-header-tools">
          <button
            type="button"
            className="sensory-toggle"
            onClick={toggleMuted}
            aria-pressed={muted}
            title={
              muted
                ? isHebrew
                  ? "הפעלת צלילים ורטט"
                  : "Enable sound and haptics"
                : isHebrew
                  ? "השתקת צלילים ורטט"
                  : "Mute sound and haptics"
            }
          >
            {muted ? "🔇" : "🔊"}
          </button>
          <div className="quest-stage">
            {state.checkpoint.sequenceNo}
            <small>/ {total}</small>
          </div>
        </div>
      </header>

      <div className="quest-progress" aria-label="Quest progress">
        <span style={{ width: `${progress}%` }} />
      </div>

      <section
        className="mission-panel mission-arrive"
        key={state.checkpoint.slug}
      >
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
          <div className={`quest-companion quest-companion-${state.difficulty.level}`}>
            <div>
              <span aria-hidden="true">✦</span>
              <p>
                {state.difficulty.level === "assisted"
                  ? isHebrew
                    ? "השותף שלכם כאן: רמזים ייפתחו מוקדם יותר וקנס הטעות קטן."
                    : "Your companion is helping: hints unlock sooner and mistake penalties are lighter."
                  : state.difficulty.level === "challenge"
                    ? isHebrew
                      ? "אתם בקצב מצוין — מצב אתגר פעיל עם בונוס ניקוד."
                      : "You are moving fast—challenge mode is active with a score bonus."
                    : isHebrew
                      ? "קצב מאוזן. השותף יציע עזרה אם תצטרכו."
                      : "Steady pace. Your companion will offer support if needed."}
              </p>
            </div>
            {mission?.story && (
              <button
                type="button"
                onClick={readStoryAloud}
                disabled={muted}
              >
                {isHebrew ? "הקראת הסיפור" : "Read story"}
              </button>
            )}
          </div>
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

          {state.hintOffer && (
            <section
              className={`hint-offer ${state.hintOffer.available ? "available" : ""}`}
              aria-live="polite"
            >
              <div>
                <strong>
                  {state.hintOffer.available
                    ? isHebrew
                      ? `רמז ${state.hintOffer.index} זמין`
                      : `Hint ${state.hintOffer.index} is available`
                    : isHebrew
                      ? "הרמז הבא עדיין נעול"
                      : "The next hint is still locked"}
                </strong>
                <small>
                  {state.hintOffer.available
                    ? isHebrew
                      ? `חשיפה חד־פעמית תוריד ${state.hintOffer.penalty} נקודות`
                      : `One reveal costs ${state.hintOffer.penalty} points`
                    : state.hintOffer.wrongAttemptsToUnlock > 0
                      ? isHebrew
                        ? `עוד ${state.hintOffer.wrongAttemptsToUnlock} ניסיונות או ${Math.ceil(hintSecondsRemaining / 60)} דקות`
                        : `${state.hintOffer.wrongAttemptsToUnlock} more attempts or ${Math.ceil(hintSecondsRemaining / 60)} minutes`
                      : isHebrew
                        ? "ייפתח בקרוב"
                        : "Unlocking soon"}
                </small>
              </div>
              <span>
                {state.hintOffer.index}/{state.hintOffer.total}
              </span>
            </section>
          )}

          {message && (
            <div className="quest-feedback success" role="status">
              ✦ {message}
            </div>
          )}
          {(error || realtimeError) && (
            <div className="quest-feedback error" role="alert">
              {error || realtimeError}
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
        <button
          className="hint-button"
          disabled={busy || !state.hintOffer?.available}
          onClick={requestHint}
        >
          <span>✦</span>
          {state.hintOffer
            ? state.hintOffer.available
              ? `−${state.hintOffer.penalty}`
              : `${Math.max(1, Math.ceil(hintSecondsRemaining / 60))}m`
            : isHebrew
              ? "אין רמז"
              : "No hint"}
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
              <>
                <div className="team-list">
                  {state.members.map((member, index) => (
                    <div key={member.id}>
                      <span>{index + 1}</span>
                      <strong>{member.firstName}</strong>
                    </div>
                  ))}
                </div>
                <section className="teammate-recovery">
                  <div>
                    <span className="quest-kicker">
                      {isHebrew ? "שחזור מחבר צוות" : "Teammate recovery"}
                    </span>
                    <h3>
                      {isHebrew
                        ? "סרקו, הזינו את הקוד האישי וחזרו."
                        : "Scan, enter your personal code, and rejoin."}
                    </h3>
                    <p>
                      {isHebrew
                        ? "ה־QR מכיל רק את קוד ההרצה. קוד השחזור האישי נשאר פרטי."
                        : "The QR only contains the run code. Your personal recovery code stays private."}
                    </p>
                    <button
                      type="button"
                      className="button button-secondary"
                      onClick={() => void shareRecovery()}
                    >
                      {isHebrew ? "שיתוף קישור שחזור" : "Share recovery link"}
                    </button>
                  </div>
                  {recoveryQr && (
                    <img
                      src={recoveryQr}
                      alt={
                        isHebrew
                          ? "קוד QR לשחזור גישה"
                          : "QR code for teammate recovery"
                      }
                    />
                  )}
                </section>
              </>
            )}
            {drawer === "map" && (
              <div className="map-panel">
                <div className="map-compass">
                  {navigation.bearing !== null && (
                    <i
                      className="map-needle"
                      style={{ transform: `rotate(${navigation.bearing}deg)` }}
                    />
                  )}
                </div>
                <p>{mission?.locationHint}</p>
                {navigation.status === "locating" && (
                  <div className="map-status">
                    {isHebrew ? "מאתר כיוון ומרחק…" : "Finding distance and direction…"}
                  </div>
                )}
                {navigation.distanceMeters !== null &&
                  navigation.bearing !== null && (
                    <div className="map-telemetry">
                      <div>
                        <span>{isHebrew ? "מרחק אווירי" : "Straight-line distance"}</span>
                        <strong>
                          {navigation.distanceMeters < 1000
                            ? `${navigation.distanceMeters} m`
                            : `${(navigation.distanceMeters / 1000).toFixed(1)} km`}
                        </strong>
                      </div>
                      <div>
                        <span>{isHebrew ? "כיוון" : "Direction"}</span>
                        <strong>
                          {cardinalDirection(navigation.bearing, isHebrew)}
                        </strong>
                      </div>
                      <div>
                        <span>{isHebrew ? "דיוק GPS" : "GPS accuracy"}</span>
                        <strong>±{navigation.accuracy} m</strong>
                      </div>
                    </div>
                  )}
                {navigation.status === "low-accuracy" && (
                  <div className="quest-feedback error">
                    {isHebrew
                      ? "דיוק ה־GPS נמוך. עברו לשטח פתוח, הפעילו מיקום מדויק והמתינו כמה שניות."
                      : "GPS accuracy is low. Move into the open, enable precise location, and wait a few seconds."}
                  </div>
                )}
                {navigation.status === "denied" && (
                  <div className="quest-feedback error">
                    {isHebrew
                      ? "הגישה למיקום חסומה. פתחו את הגדרות האתר בדפדפן, אפשרו מיקום וטענו מחדש."
                      : "Location access is blocked. Open browser site settings, allow location, and reload."}
                  </div>
                )}
                {navigation.status === "unavailable" && (
                  <div className="quest-feedback error">
                    {isHebrew
                      ? "לא ניתן לקבל מיקום כרגע. אפשר להמשיך בעזרת רמז המקום או אפליקציית מפות."
                      : "Location is unavailable. Continue with the location clue or a maps app."}
                  </div>
                )}
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
