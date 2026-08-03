"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getBrowserClient } from "@/lib/supabase/browser";
import {
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
  accessibility: Record<string, unknown> | null;
  health_status: string;
  health_notes: string | null;
  created_at: string;
};

type Riddle = { id: string; station_id: string; slug: string; kind: string };

type Library = { stations: Station[]; riddles: Riddle[] };

type Fix = { lat: number; lon: number; accuracy: number };

const STATUSES: { value: string; label: string }[] = [
  { value: "pending", label: "נלכד — לא נבדק" },
  { value: "verified", label: "מאושר לשימוש" },
  { value: "needs_attention", label: "דורש בדיקה" },
  { value: "blocked", label: "לא מתאים" }
];

const BADGE: Record<string, string> = {
  pending: styles.bPending,
  verified: styles.bVerified,
  needs_attention: styles.bAttention,
  blocked: styles.bBlocked
};

const ACCURACY_LIMIT = 25;

const titleOf = (station: Station) =>
  station.title?.he || station.title?.en || station.slug;

/** Latin slug the API will accept, since the name itself is Hebrew. */
const generateSlug = () =>
  `poi-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

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

function readPosition(): Promise<Fix> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error("המכשיר לא תומך במיקום"));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) =>
        resolve({
          lat: position.coords.latitude,
          lon: position.coords.longitude,
          accuracy: Math.round(position.coords.accuracy)
        }),
      (error) => reject(new Error(error.message)),
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 }
    );
  });
}

export function FieldVerification() {
  const supabase = useMemo(() => getBrowserClient(), []);
  const [token, setToken] = useState("");
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [library, setLibrary] = useState<Library | null>(null);
  const [openId, setOpenId] = useState("");
  const [error, setError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);

  const reload = useCallback(async () => {
    setReloadKey((current) => current + 1);
  }, []);

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

  // Newest first: during a walk the station you just captured is the one you
  // still need to photograph and annotate.
  const stations = useMemo(() => {
    if (!library) return [];
    return [...library.stations].sort((a, b) =>
      (b.created_at ?? "").localeCompare(a.created_at ?? "")
    );
  }, [library]);

  if (!token) {
    return (
      <div className={styles.shell}>
        <div className={styles.gate}>
          <h1 className={styles.title}>תחנות שטח</h1>
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
      <div className={styles.wrap}>
        <div className={styles.header}>
          <h1 className={styles.title}>תחנות שטח</h1>
          <p className={styles.sub}>
            עמוד בנקודה, לכוד אותה, ואז צלם והוסף הערות. את המסלול נבנה אחר כך
            מהתחנות שקיימות באמת.
          </p>
        </div>

        <Capture token={token} onCreated={reload} />

        {error && <p className={`${styles.muted} ${styles.bad}`}>{error}</p>}

        <p className={styles.sectionTitle} style={{ marginTop: 22 }}>
          נלכדו {stations.length}
        </p>

        {stations.length === 0 && (
          <p className={styles.muted}>
            עוד אין תחנות. לכוד את הראשונה למעלה.
          </p>
        )}

        {stations.map((station) => (
          <StationCard
            key={station.id}
            station={station}
            hasPhotoRiddle={(library?.riddles ?? []).some(
              (riddle) =>
                riddle.station_id === station.id && riddle.kind === "photo"
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

function Capture({
  token,
  onCreated
}: {
  token: string;
  onCreated: () => Promise<void>;
}) {
  const [fix, setFix] = useState<Fix | null>(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const locate = async () => {
    setBusy(true);
    setMessage("");
    try {
      setFix(await readPosition());
    } catch (locateError) {
      setMessage(
        locateError instanceof Error ? locateError.message : "מיקום נכשל"
      );
    } finally {
      setBusy(false);
    }
  };

  const create = async () => {
    if (!fix || !name.trim()) return;
    setBusy(true);
    setMessage("");
    try {
      await requestJson("/api/admin/content/stations", token, {
        method: "POST",
        body: JSON.stringify({
          slug: generateSlug(),
          title: { he: name.trim(), en: "" },
          latitude: fix.lat,
          longitude: fix.lon,
          radiusMeters: 60,
          fieldVerificationRequired: true,
          status: "draft"
        })
      });
      await onCreated();
      setName("");
      setFix(null);
      setMessage("נלכדה");
    } catch (createError) {
      setMessage(
        createError instanceof Error ? createError.message : "יצירה נכשלה"
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={`${styles.card} ${styles.cardVerified}`}>
      <div className={styles.body} style={{ borderTop: "none" }}>
        <p className={styles.sectionTitle}>תחנה חדשה</p>

        {!fix ? (
          <button
            className={`${styles.button} ${styles.primary}`}
            style={{ width: "100%" }}
            onClick={() => void locate()}
            disabled={busy}
          >
            {busy ? "מודד…" : "לכוד את הנקודה הזו"}
          </button>
        ) : (
          <>
            <div className={styles.row}>
              <span className={styles.mono}>
                {fix.lat.toFixed(6)}, {fix.lon.toFixed(6)}
              </span>
              <span
                className={
                  fix.accuracy > ACCURACY_LIMIT
                    ? `${styles.muted} ${styles.warn}`
                    : `${styles.muted} ${styles.good}`
                }
              >
                ±{fix.accuracy} מ׳
              </span>
              <button
                className={styles.button}
                onClick={() => void locate()}
                disabled={busy}
              >
                מדוד שוב
              </button>
            </div>

            {fix.accuracy > ACCURACY_LIMIT && (
              <p className={`${styles.hint} ${styles.hintWarn}`}>
                דיוק גרוע מ-{ACCURACY_LIMIT} מ׳. עמוד במקום פתוח והמתן כמה שניות
                לפני שתמדוד שוב — נ״צ שגוי כאן הופך לחידה שבורה בשטח.
              </p>
            )}

            <label className={styles.label}>שם התחנה</label>
            <input
              className={styles.input}
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="המנוף הישן, שלט 1936, גשר הירקון…"
            />

            <button
              className={`${styles.button} ${styles.primary}`}
              style={{ marginTop: 10, width: "100%" }}
              onClick={() => void create()}
              disabled={busy || !name.trim()}
            >
              {busy ? "שומר…" : "שמור תחנה"}
            </button>
          </>
        )}

        {message && <p className={styles.muted}>{message}</p>}
      </div>
    </div>
  );
}

function StationCard({
  station,
  hasPhotoRiddle,
  token,
  open,
  onToggle,
  onSaved
}: {
  station: Station;
  hasPhotoRiddle: boolean;
  token: string;
  open: boolean;
  onToggle: () => void;
  onSaved: () => Promise<void>;
}) {
  const access = station.accessibility ?? {};
  const [name, setName] = useState(titleOf(station));
  const [notes, setNotes] = useState(station.health_notes ?? "");
  const [radius, setRadius] = useState(String(station.radius_meters ?? ""));
  const [status, setStatus] = useState(station.health_status);
  const [wheelchair, setWheelchair] = useState(Boolean(access.wheelchair));
  const [stroller, setStroller] = useState(Boolean(access.stroller));
  const [reception, setReception] = useState(Boolean(access.reception));
  const [fix, setFix] = useState<Fix | null>(null);
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [verdict, setVerdict] = useState<GalleryVerdict>("reference");
  const fileRef = useRef<HTMLInputElement | null>(null);

  const gallery = galleryEntries(station.gallery);

  const drift =
    fix && station.latitude !== null && station.longitude !== null
      ? Math.round(
          routeDistanceMeters(
            { latitude: station.latitude, longitude: station.longitude },
            { latitude: fix.lat, longitude: fix.lon }
          )
        )
      : null;

  const patch = async (body: Record<string, unknown>, label: string) => {
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

  const remeasure = async () => {
    setBusy("fix");
    setMessage("");
    try {
      setFix(await readPosition());
    } catch (locateError) {
      setMessage(
        locateError instanceof Error ? locateError.message : "מיקום נכשל"
      );
    } finally {
      setBusy("");
    }
  };

  const saveAll = () =>
    void patch(
      {
        title: { he: name.trim(), en: "" },
        healthStatus: status,
        healthNotes: notes,
        accessibility: { wheelchair, stroller, reception },
        ...(radius.trim() ? { radiusMeters: Number(radius) } : {})
      },
      "all"
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
            {station.latitude?.toFixed(5)}, {station.longitude?.toFixed(5)} ·{" "}
            {gallery.length} תמונות
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
            <p className={styles.sectionTitle}>תמונות</p>
            {hasPhotoRiddle && (
              <div className={styles.row} style={{ marginBottom: 9 }}>
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
            )}

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
              style={{ width: "100%" }}
              onClick={() => fileRef.current?.click()}
              disabled={busy === "photo"}
            >
              {busy === "photo" ? "מעלה…" : "הוסף תמונה"}
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

          <div className={styles.section}>
            <p className={styles.sectionTitle}>נ״צ</p>
            <div className={styles.row}>
              <span className={styles.mono}>
                {station.latitude?.toFixed(6)}, {station.longitude?.toFixed(6)}
              </span>
              <button
                className={styles.button}
                onClick={() => void remeasure()}
                disabled={busy === "fix"}
              >
                {busy === "fix" ? "מודד…" : "מדוד מחדש"}
              </button>
            </div>
            {fix && (
              <>
                <p className={styles.muted}>
                  חדש: <span className={styles.mono}>
                    {fix.lat.toFixed(6)}, {fix.lon.toFixed(6)}
                  </span>{" "}
                  ±{fix.accuracy} מ׳
                  {drift !== null ? ` · סטייה ${drift} מ׳` : ""}
                </p>
                <button
                  className={styles.button}
                  style={{ marginTop: 8 }}
                  onClick={() =>
                    void patch(
                      { latitude: fix.lat, longitude: fix.lon },
                      "fix2"
                    ).then(() => setFix(null))
                  }
                  disabled={busy === "fix2"}
                >
                  החלף את הנ״צ
                </button>
              </>
            )}
          </div>

          <div className={styles.section}>
            <p className={styles.sectionTitle}>פרטים</p>

            <label className={styles.label}>שם</label>
            <input
              className={styles.input}
              value={name}
              onChange={(event) => setName(event.target.value)}
            />

            <label className={styles.label}>רדיוס אימות (מ׳)</label>
            <input
              className={styles.input}
              inputMode="numeric"
              value={radius}
              onChange={(event) => setRadius(event.target.value)}
            />

            <div className={styles.checks} style={{ marginTop: 12 }}>
              <label className={styles.check}>
                <input
                  type="checkbox"
                  checked={wheelchair}
                  onChange={(event) => setWheelchair(event.target.checked)}
                />
                <span>נגיש לכיסא גלגלים</span>
              </label>
              <label className={styles.check}>
                <input
                  type="checkbox"
                  checked={stroller}
                  onChange={(event) => setStroller(event.target.checked)}
                />
                <span>נגיש לעגלה</span>
              </label>
              <label className={styles.check}>
                <input
                  type="checkbox"
                  checked={reception}
                  onChange={(event) => setReception(event.target.checked)}
                />
                <span>קליטה סלולרית תקינה</span>
              </label>
            </div>

            <label className={styles.label}>הערות</label>
            <textarea
              className={styles.textarea}
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              placeholder="מה יש כאן, מה כתוב על השילוט, מה מעניין, מפגעים…"
            />

            <label className={styles.label}>מצב</label>
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
              onClick={saveAll}
              disabled={busy === "all"}
            >
              {busy === "all" ? "שומר…" : "שמור"}
            </button>
          </div>

          <p className={styles.status}>{message}</p>
        </div>
      )}
    </div>
  );
}

function Shot({ entry, onDrop }: { entry: GalleryEntry; onDrop: () => void }) {
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
