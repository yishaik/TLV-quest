"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getBrowserClient } from "@/lib/supabase/browser";
import {
  calibrationProgress,
  galleryEntries,
  type GalleryEntry,
  type GalleryVerdict
} from "@/lib/station-gallery";
import { routeDistanceMeters } from "@/lib/route-planning";
import styles from "./FieldVerification.module.css";

type Localized = { he?: string; en?: string };

type Station = {
  id: string;
  slug: string;
  title: Localized;
  latitude: number | null;
  longitude: number | null;
  radius_meters: number | null;
  gallery: unknown;
  health_status: string;
  health_checklist: Record<string, unknown> | null;
  health_notes: string | null;
  field_verification_required: boolean;
};

type Riddle = {
  id: string;
  station_id: string;
  slug: string;
  kind: string;
  content: Record<string, Localized & Record<string, unknown>>;
  validation: Record<string, unknown>;
};

type Library = { stations: Station[]; riddles: Riddle[] };

type Fix = { lat: number; lon: number; accuracy: number; at: number };

const CHECKS: { key: string; label: string }[] = [
  { key: "coordinates", label: "נ״צ נמדד בשטח ותואם" },
  { key: "accessibility", label: "נגיש לכיסא גלגלים ולעגלה, או שיש חלופה" },
  { key: "reception", label: "קליטה סלולרית בשתי רשתות" },
  { key: "signage", label: "השילוט צולם ותומלל he/en" },
  { key: "safety", label: "הגישה בטוחה, בלי מפגע או חסימה" },
  { key: "tag", label: "מקום מוגן לתג NFC וגיבוי QR" }
];

const STATUSES: { value: string; label: string }[] = [
  { value: "pending", label: "ממתין" },
  { value: "verified", label: "אומת" },
  { value: "needs_attention", label: "דורש טיפול" },
  { value: "blocked", label: "חסום" }
];

const BADGE: Record<string, string> = {
  pending: styles.bPending,
  verified: styles.bVerified,
  needs_attention: styles.bAttention,
  blocked: styles.bBlocked
};

const titleOf = (station: Station) =>
  station.title?.he || station.title?.en || station.slug;

async function requestJson<T>(
  url: string,
  token: string,
  init?: RequestInit
): Promise<T> {
  const response = await fetch(url, {
    cache: "no-store",
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      ...(init?.body && !(init.body instanceof FormData)
        ? { "content-type": "application/json" }
        : {}),
      ...(init?.headers ?? {})
    }
  });
  const payload = await response.json();
  if (!response.ok || !payload.ok) {
    throw new Error(payload.error?.message ?? "הפעולה נכשלה");
  }
  return payload.data as T;
}

export function FieldVerification() {
  const supabase = useMemo(() => getBrowserClient(), []);
  const [token, setToken] = useState("");
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [library, setLibrary] = useState<Library | null>(null);
  const [openId, setOpenId] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    supabase.auth.getSession().then(({ data }) => {
      if (active) setToken(data.session?.access_token ?? "");
    });
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      if (active) setToken(session?.access_token ?? "");
    });
    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, [supabase]);

  // Saving happens deep in the tree, so children ask for a refresh by bumping
  // this rather than calling a fetcher that outlives them. The `active` guard
  // matters on a phone: navigating away mid-upload would otherwise set state
  // on an unmounted tree.
  const [reloadKey, setReloadKey] = useState(0);
  const reload = useCallback(async () => {
    setReloadKey((current) => current + 1);
  }, []);

  useEffect(() => {
    if (!token) return undefined;
    let active = true;
    void (async () => {
      try {
        const data = await requestJson<Library>(
          "/api/admin/content/library",
          token
        );
        if (!active) return;
        setLibrary(data);
        setError("");
      } catch (loadError) {
        if (!active) return;
        setError(loadError instanceof Error ? loadError.message : "טעינה נכשלה");
      }
    })();
    return () => {
      active = false;
    };
  }, [token, reloadKey]);

  const signIn = async () => {
    const { error: authError } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: `${window.location.origin}/admin/field` }
    });
    if (authError) setError(authError.message);
    else setSent(true);
  };

  // South to north. That is the order the port is walked, so it is the order
  // the list should be in — sorting by name would send you back and forth.
  const stations = useMemo(() => {
    if (!library) return [];
    return [...library.stations]
      .filter((station) => station.field_verification_required)
      .sort((a, b) => (a.latitude ?? 0) - (b.latitude ?? 0));
  }, [library]);

  const verified = stations.filter(
    (station) => station.health_status === "verified"
  ).length;

  if (!token) {
    return (
      <div className={styles.shell}>
        <div className={styles.gate}>
          <h1 className={styles.title}>אימות שטח</h1>
          <p className={styles.sub}>
            {sent
              ? "נשלח קישור כניסה. פתח אותו מהמכשיר הזה."
              : "היכנס עם המייל שברשימת המנהלים."}
          </p>
          {!sent && (
            <>
              <input
                className={styles.input}
                style={{ marginTop: 14 }}
                type="email"
                inputMode="email"
                placeholder="you@example.com"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
              <button
                className={`${styles.button} ${styles.primary}`}
                style={{ marginTop: 10, width: "100%" }}
                onClick={() => void signIn()}
                disabled={!email.trim()}
              >
                שלח קישור כניסה
              </button>
            </>
          )}
          {error && <p className={`${styles.muted} ${styles.bad}`}>{error}</p>}
        </div>
      </div>
    );
  }

  return (
    <div className={styles.shell}>
      <div className={styles.bar}>
        <div className={styles.barRow}>
          <div className={styles.track}>
            <div
              className={styles.fill}
              style={{
                width: stations.length
                  ? `${(verified / stations.length) * 100}%`
                  : "0%"
              }}
            />
          </div>
          <span className={styles.count}>
            {verified} / {stations.length} אומתו
          </span>
        </div>
      </div>

      <div className={styles.wrap}>
        <div className={styles.header}>
          <h1 className={styles.title}>אימות שטח</h1>
          <p className={styles.sub}>
            מסודר מדרום לצפון — סדר ההליכה. הקש על תחנה כדי לפתוח.
          </p>
        </div>

        {error && <p className={`${styles.muted} ${styles.bad}`}>{error}</p>}

        {stations.map((station) => (
          <StationCard
            key={station.id}
            station={station}
            riddles={(library?.riddles ?? []).filter(
              (riddle) => riddle.station_id === station.id
            )}
            token={token}
            open={openId === station.id}
            onToggle={() =>
              setOpenId((current) => (current === station.id ? "" : station.id))
            }
            onSaved={reload}
          />
        ))}
      </div>
    </div>
  );
}

function StationCard({
  station,
  riddles,
  token,
  open,
  onToggle,
  onSaved
}: {
  station: Station;
  riddles: Riddle[];
  token: string;
  open: boolean;
  onToggle: () => void;
  onSaved: () => Promise<void>;
}) {
  const [fix, setFix] = useState<Fix | null>(null);
  const [locating, setLocating] = useState(false);
  const [notes, setNotes] = useState(station.health_notes ?? "");
  const [radius, setRadius] = useState(String(station.radius_meters ?? ""));
  const [status, setStatus] = useState(station.health_status);
  const [checks, setChecks] = useState<Record<string, boolean>>(() => {
    const raw = station.health_checklist ?? {};
    const next: Record<string, boolean> = {};
    for (const item of CHECKS) next[item.key] = Boolean(raw[item.key]);
    return next;
  });
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [verdict, setVerdict] = useState<GalleryVerdict>("accept");

  const gallery = galleryEntries(station.gallery);
  const calibration = calibrationProgress(gallery);
  const needsPhotos = riddles.some((riddle) => riddle.kind === "photo");

  const drift =
    fix && station.latitude !== null && station.longitude !== null
      ? Math.round(
          routeDistanceMeters(
            { latitude: station.latitude, longitude: station.longitude },
            { latitude: fix.lat, longitude: fix.lon }
          )
        )
      : null;

  const locate = () => {
    if (!navigator.geolocation) {
      setMessage("המכשיר לא תומך במיקום");
      return;
    }
    setLocating(true);
    setMessage("");
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setFix({
          lat: position.coords.latitude,
          lon: position.coords.longitude,
          accuracy: Math.round(position.coords.accuracy),
          at: Date.now()
        });
        setLocating(false);
      },
      (positionError) => {
        setLocating(false);
        setMessage(`מיקום נכשל: ${positionError.message}`);
      },
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 }
    );
  };

  const patchStation = async (body: Record<string, unknown>, label: string) => {
    setBusy(label);
    setMessage("");
    try {
      await requestJson(`/api/admin/content/stations/${station.id}`, token, {
        method: "PATCH",
        body: JSON.stringify(body)
      });
      await onSaved();
      setMessage("נשמר");
    } catch (saveError) {
      setMessage(saveError instanceof Error ? saveError.message : "שמירה נכשלה");
    } finally {
      setBusy("");
    }
  };

  const saveFix = () => {
    if (!fix) return;
    void patchStation(
      { latitude: fix.lat, longitude: fix.lon },
      "fix"
    );
  };

  const saveField = () =>
    void patchStation(
      {
        healthStatus: status,
        healthChecklist: checks,
        healthNotes: notes,
        ...(radius.trim() ? { radiusMeters: Number(radius) } : {})
      },
      "field"
    );

  const uploadPhoto = async (file: File) => {
    setBusy("photo");
    setMessage("");
    try {
      const form = new FormData();
      form.append("image", file);
      form.append("verdict", verdict);
      await requestJson(
        `/api/admin/content/stations/${station.id}/gallery`,
        token,
        { method: "POST", body: form }
      );
      await onSaved();
      setMessage("התמונה נוספה");
    } catch (uploadError) {
      setMessage(
        uploadError instanceof Error ? uploadError.message : "העלאה נכשלה"
      );
    } finally {
      setBusy("");
    }
  };

  const dropPhoto = async (path: string) => {
    setBusy("photo");
    try {
      await requestJson(
        `/api/admin/content/stations/${station.id}/gallery`,
        token,
        { method: "DELETE", body: JSON.stringify({ path }) }
      );
      await onSaved();
    } catch (dropError) {
      setMessage(dropError instanceof Error ? dropError.message : "מחיקה נכשלה");
    } finally {
      setBusy("");
    }
  };

  const cardClass = [
    styles.card,
    station.health_status === "verified" ? styles.cardVerified : "",
    station.health_status === "blocked" ? styles.cardBlocked : ""
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={cardClass}>
      <button className={styles.cardHead} onClick={onToggle}>
        <div className={styles.headText}>
          <div className={styles.stationName}>{titleOf(station)}</div>
          <div className={styles.stationMeta}>
            {station.latitude?.toFixed(5)}, {station.longitude?.toFixed(5)} ·
            רדיוס {station.radius_meters ?? "—"} מ׳
            {needsPhotos ? " · צילום" : ""}
          </div>
        </div>
        <span className={`${styles.badge} ${BADGE[station.health_status] ?? ""}`}>
          {STATUSES.find((item) => item.value === station.health_status)?.label ??
            station.health_status}
        </span>
      </button>

      {open && (
        <div className={styles.body}>
          <div className={styles.section}>
            <p className={styles.sectionTitle}>נ״צ</p>
            <div className={styles.row}>
              <span className={styles.mono}>
                {station.latitude?.toFixed(6)}, {station.longitude?.toFixed(6)}
              </span>
              <button
                className={styles.button}
                onClick={locate}
                disabled={locating}
              >
                {locating ? "מודד…" : "מדוד כאן"}
              </button>
            </div>

            {fix && (
              <>
                <div className={styles.row} style={{ marginTop: 9 }}>
                  <span className={styles.mono}>
                    {fix.lat.toFixed(6)}, {fix.lon.toFixed(6)}
                  </span>
                  <span
                    className={
                      fix.accuracy > 25
                        ? `${styles.muted} ${styles.warn}`
                        : styles.muted
                    }
                  >
                    דיוק ±{fix.accuracy} מ׳
                  </span>
                </div>
                {drift !== null && (
                  <p className={styles.muted}>
                    סטייה מהרשום: <strong>{drift} מ׳</strong>
                    {station.radius_meters && drift > station.radius_meters ? (
                      <span className={styles.bad}>
                        {" "}
                        — גדולה מרדיוס האימות
                      </span>
                    ) : null}
                  </p>
                )}
                {fix.accuracy > 25 && (
                  <p className={`${styles.hint} ${styles.hintWarn}`}>
                    הדיוק גרוע מ-25 מ׳. עמוד במקום פתוח, המתן כמה שניות ומדוד שוב
                    לפני ששומר — נ״צ שגוי שובר את אימות המיקום לכל השחקנים.
                  </p>
                )}
                <button
                  className={`${styles.button} ${styles.primary}`}
                  style={{ marginTop: 9 }}
                  onClick={saveFix}
                  disabled={busy === "fix"}
                >
                  {busy === "fix" ? "שומר…" : "שמור כנ״צ התחנה"}
                </button>
              </>
            )}
          </div>

          <div className={styles.section}>
            <p className={styles.sectionTitle}>בדיקות שטח</p>
            <div className={styles.checks}>
              {CHECKS.map((item) => (
                <label key={item.key} className={styles.check}>
                  <input
                    type="checkbox"
                    checked={checks[item.key] ?? false}
                    onChange={(event) =>
                      setChecks((current) => ({
                        ...current,
                        [item.key]: event.target.checked
                      }))
                    }
                  />
                  <span>{item.label}</span>
                </label>
              ))}
            </div>

            <label className={styles.label}>רדיוס אימות (מ׳)</label>
            <input
              className={styles.input}
              inputMode="numeric"
              value={radius}
              onChange={(event) => setRadius(event.target.value)}
            />

            <label className={styles.label}>הערות שטח</label>
            <textarea
              className={styles.textarea}
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              placeholder="שילוט, מפגעים, קליטה, חלופות גישה…"
            />

            <label className={styles.label}>סטטוס</label>
            <select
              className={styles.select}
              value={status}
              onChange={(event) => setStatus(event.target.value)}
            >
              {STATUSES.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>

            <button
              className={`${styles.button} ${styles.primary}`}
              style={{ marginTop: 11, width: "100%" }}
              onClick={saveField}
              disabled={busy === "field"}
            >
              {busy === "field" ? "שומר…" : "שמור בדיקות שטח"}
            </button>
          </div>

          {needsPhotos && (
            <div className={styles.section}>
              <p className={styles.sectionTitle}>תמונות כיול</p>
              <p className={styles.muted}>
                {calibration.accept} אמורות להתקבל · {calibration.reject} אמורות
                להידחות
              </p>
              {!calibration.ready && (
                <p className={styles.hint}>
                  חסרות עוד {calibration.missingAccept} מתקבלות ו-
                  {calibration.missingReject} נדחות. בלי דוגמאות משני הצדדים אי
                  אפשר לכייל סף — ערימה של תמונות טובות בלבד לא מלמדת איפה הגבול.
                </p>
              )}

              <div className={styles.row} style={{ marginTop: 10 }}>
                {(
                  [
                    ["accept", "אמורה להתקבל"],
                    ["reject", "אמורה להידחות"],
                    ["reference", "ייחוס"]
                  ] as [GalleryVerdict, string][]
                ).map(([value, label]) => (
                  <button
                    key={value}
                    className={`${styles.button} ${
                      verdict === value ? styles.primary : ""
                    }`}
                    onClick={() => setVerdict(value)}
                  >
                    {label}
                  </button>
                ))}
              </div>

              <input
                ref={fileRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                capture="environment"
                hidden
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void uploadPhoto(file);
                  event.target.value = "";
                }}
              />
              <button
                className={`${styles.button} ${styles.primary}`}
                style={{ marginTop: 9, width: "100%" }}
                onClick={() => fileRef.current?.click()}
                disabled={busy === "photo"}
              >
                {busy === "photo" ? "מעלה…" : "צלם תמונה"}
              </button>

              {gallery.length > 0 && (
                <div className={styles.gallery}>
                  {gallery.map((entry) => (
                    <Shot
                      key={entry.path}
                      entry={entry}
                      onDrop={() => void dropPhoto(entry.path)}
                    />
                  ))}
                </div>
              )}
            </div>
          )}

          <div className={styles.section}>
            <p className={styles.sectionTitle}>שאלות ותשובות</p>
            {riddles.length === 0 && (
              <p className={styles.muted}>אין חידות משויכות לתחנה הזו.</p>
            )}
            {riddles.map((riddle) => (
              <RiddleEditor
                key={riddle.id}
                riddle={riddle}
                token={token}
                onSaved={onSaved}
              />
            ))}
          </div>

          <p className={styles.status}>{message}</p>
        </div>
      )}
    </div>
  );
}

function Shot({
  entry,
  onDrop
}: {
  entry: GalleryEntry;
  onDrop: () => void;
}) {
  const cls = [
    styles.shot,
    entry.verdict === "accept" ? styles.shotAccept : "",
    entry.verdict === "reject" ? styles.shotReject : ""
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <div className={cls}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={entry.url} alt={entry.verdict} loading="lazy" />
      <button className={styles.shotDrop} onClick={onDrop} aria-label="מחק">
        ✕
      </button>
    </div>
  );
}

function RiddleEditor({
  riddle,
  token,
  onSaved
}: {
  riddle: Riddle;
  token: string;
  onSaved: () => Promise<void>;
}) {
  const content = riddle.content ?? {};
  const [promptHe, setPromptHe] = useState(
    String(content.he?.prompt ?? "")
  );
  const [promptEn, setPromptEn] = useState(
    String(content.en?.prompt ?? "")
  );
  const isPhoto = String(riddle.validation?.type ?? riddle.kind) === "photo";
  const [accepted, setAccepted] = useState(
    Array.isArray(riddle.validation?.accepted)
      ? (riddle.validation.accepted as string[]).join("\n")
      : ""
  );
  const [criteria, setCriteria] = useState(
    String(riddle.validation?.criteria ?? "")
  );
  const [threshold, setThreshold] = useState(
    String(riddle.validation?.confidenceThreshold ?? "")
  );
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const save = async () => {
    setBusy(true);
    setMessage("");
    try {
      const validation: Record<string, unknown> = { ...riddle.validation };
      if (isPhoto) {
        validation.criteria = criteria.trim();
        const parsed = Number(threshold);
        if (Number.isFinite(parsed) && parsed > 0 && parsed <= 1) {
          validation.confidenceThreshold = parsed;
        }
      } else {
        validation.accepted = accepted
          .split("\n")
          .map((item) => item.trim())
          .filter(Boolean);
      }
      await requestJson(`/api/admin/content/riddles/${riddle.id}`, token, {
        method: "PATCH",
        body: JSON.stringify({
          content: {
            ...content,
            he: { ...(content.he ?? {}), prompt: promptHe },
            en: { ...(content.en ?? {}), prompt: promptEn }
          },
          validation
        })
      });
      await onSaved();
      setMessage("נשמר");
    } catch (saveError) {
      setMessage(saveError instanceof Error ? saveError.message : "שמירה נכשלה");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={styles.riddle}>
      <div className={styles.riddleHead}>
        <span className={styles.kind}>{riddle.kind}</span>
        <span className={styles.stationMeta}>{riddle.slug}</span>
      </div>

      <label className={styles.label}>שאלה (he)</label>
      <textarea
        className={styles.textarea}
        value={promptHe}
        onChange={(event) => setPromptHe(event.target.value)}
      />

      <label className={styles.label}>שאלה (en)</label>
      <textarea
        className={styles.textarea}
        value={promptEn}
        onChange={(event) => setPromptEn(event.target.value)}
      />

      {isPhoto ? (
        <>
          <label className={styles.label}>קריטריון לאישור תמונה</label>
          <textarea
            className={styles.textarea}
            value={criteria}
            onChange={(event) => setCriteria(event.target.value)}
          />
          <label className={styles.label}>
            סף ביטחון (0–1) — כוונן מול תמונות הכיול
          </label>
          <input
            className={styles.input}
            inputMode="decimal"
            value={threshold}
            onChange={(event) => setThreshold(event.target.value)}
          />
        </>
      ) : (
        <>
          <label className={styles.label}>תשובות מתקבלות — שורה לכל תשובה</label>
          <textarea
            className={styles.textarea}
            value={accepted}
            onChange={(event) => setAccepted(event.target.value)}
          />
        </>
      )}

      <button
        className={styles.button}
        style={{ marginTop: 10 }}
        onClick={() => void save()}
        disabled={busy}
      >
        {busy ? "שומר…" : "שמור חידה"}
      </button>
      {message && <p className={styles.muted}>{message}</p>}
    </div>
  );
}
