"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { getBrowserClient } from "@/lib/supabase/browser";
import styles from "./QuestionReview.module.css";

type Json = Record<string, unknown>;
type Template = {
  id: string;
  slug: string;
  title: Json;
  active_version: number;
  versions: Array<{ version: number; status: string; checkpointCount: number }>;
};
type Station = { id: string; title: Json };
type Riddle = {
  id: string;
  title: Json;
  kind: string;
  content: Json;
  validation: Json;
  hints: unknown[];
  fallback: Json | null;
  scoring: Json;
};
type Stop = {
  id: string;
  template_id: string;
  version: number;
  station_id: string;
  riddle_id: string;
  sequence_no: number;
  is_active: boolean;
};
type Library = { stations: Station[]; riddles: Riddle[]; routeStops: Stop[] };

const object = (value: unknown): Json =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Json : {};
const text = (value: unknown) => typeof value === "string" ? value : "";
const strings = (value: unknown) => Array.isArray(value)
  ? value.filter((item): item is string => typeof item === "string" && Boolean(item.trim()))
  : [];
const localized = (value: unknown) => {
  const item = object(value);
  return text(item.he) || text(item.en) || "ללא שם";
};

async function request<T>(url: string, token: string): Promise<T> {
  const response = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload?.error?.message || "טעינת התוכן נכשלה");
  return payload.data as T;
}

const KIND: Record<string, string> = {
  text: "טקסט", choice: "בחירה", photo: "צילום", hybrid: "משולב",
  location: "מיקום", finale: "סיום"
};

export function QuestionReview() {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [library, setLibrary] = useState<Library | null>(null);
  const [routeId, setRouteId] = useState("");
  const [version, setVersion] = useState(0);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [status, setStatus] = useState("טוען את מאגר השאלות…");

  useEffect(() => {
    const supabase = getBrowserClient();
    void supabase.auth.getSession().then(async ({ data }) => {
      const token = data.session?.access_token;
      if (!token) return setStatus("נדרשת התחברות כמנהל כדי לצפות בתשובות.");
      try {
        const [nextTemplates, nextLibrary] = await Promise.all([
          request<Template[]>("/api/admin/content/templates", token),
          request<Library>("/api/admin/content/library", token)
        ]);
        setTemplates(nextTemplates);
        setLibrary(nextLibrary);
        const first = nextTemplates[0];
        if (first) {
          setRouteId(first.id);
          setVersion(first.active_version || first.versions[0]?.version || 1);
        }
        setStatus("");
      } catch (error) {
        setStatus(error instanceof Error ? error.message : "טעינת התוכן נכשלה");
      }
    });
  }, []);

  const route = templates.find((item) => item.id === routeId);
  const stationById = useMemo(() => new Map(library?.stations.map((x) => [x.id, x]) ?? []), [library]);
  const riddleById = useMemo(() => new Map(library?.riddles.map((x) => [x.id, x]) ?? []), [library]);
  const stops = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return (library?.routeStops ?? [])
      .filter((stop) => stop.template_id === routeId && stop.version === version && stop.is_active)
      .sort((a, b) => a.sequence_no - b.sequence_no)
      .filter((stop) => {
        if (!needle) return true;
        const riddle = riddleById.get(stop.riddle_id);
        const station = stationById.get(stop.station_id);
        return JSON.stringify([riddle, station]).toLowerCase().includes(needle);
      });
  }, [library, query, riddleById, routeId, stationById, version]);

  const allOpen = stops.length > 0 && stops.every((stop) => open.has(stop.id));
  const toggleAll = () => setOpen(allOpen ? new Set() : new Set(stops.map((stop) => stop.id)));

  return (
    <main className={styles.page} dir="rtl">
      <header className={styles.hero}>
        <div>
          <p className={styles.eyebrow}>TLV QUEST · בקרת תוכן</p>
          <h1>כל השאלות. בלי הפתעות בשטח.</h1>
          <p>תצוגת קריאה בלבד של השאלות, התשובות, הרמזים וכללי האימות האמיתיים.</p>
        </div>
        <Link href="/admin/content" className={styles.studioLink}>חזרה לסטודיו ←</Link>
      </header>

      {status ? <section className={styles.empty}><span>◎</span><p>{status}</p><Link href="/admin/content">מעבר להתחברות</Link></section> : (
        <>
          <section className={styles.toolbar}>
            <label><span>מסלול</span><select value={routeId} onChange={(e) => {
              const selected = templates.find((x) => x.id === e.target.value);
              setRouteId(e.target.value); setVersion(selected?.active_version || 1); setOpen(new Set());
            }}>{templates.map((item) => <option key={item.id} value={item.id}>{localized(item.title)}</option>)}</select></label>
            <label><span>גרסה</span><select value={version} onChange={(e) => { setVersion(Number(e.target.value)); setOpen(new Set()); }}>
              {route?.versions.map((item) => <option key={item.version} value={item.version}>גרסה {item.version} · {item.status}</option>)}
            </select></label>
            <label className={styles.search}><span>חיפוש</span><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="שאלה, תשובה או תחנה…" /></label>
            <button onClick={toggleAll}>{allOpen ? "סגירת הכול" : "פתיחת הכול"}</button>
          </section>

          <div className={styles.summary}><strong>{stops.length}</strong> תחנות במסלול <span>·</span> גרסה {version}</div>

          <section className={styles.list}>
            {stops.map((stop) => {
              const riddle = riddleById.get(stop.riddle_id);
              const station = stationById.get(stop.station_id);
              if (!riddle) return null;
              const content = object(riddle.content);
              const he = object(content.he);
              const validation = object(riddle.validation);
              const fallback = object(riddle.fallback);
              const hints = Array.isArray(riddle.hints) ? riddle.hints.map(object) : [];
              const accepted = strings(validation.accepted);
              const options = strings(validation.options);
              const isOpen = open.has(stop.id);
              return <article key={stop.id} className={`${styles.card} ${isOpen ? styles.open : ""}`}>
                <button className={styles.cardHead} onClick={() => setOpen((current) => {
                  const next = new Set(current);
                  if (next.has(stop.id)) next.delete(stop.id);
                  else next.add(stop.id);
                  return next;
                })} aria-expanded={isOpen}>
                  <span className={styles.number}>{String(stop.sequence_no).padStart(2, "0")}</span>
                  <span className={styles.heading}><small>{localized(station?.title)} · {KIND[riddle.kind] || riddle.kind}</small><strong>{text(he.title) || localized(riddle.title)}</strong></span>
                  <span className={styles.chevron}>⌄</span>
                </button>
                {isOpen && <div className={styles.body}>
                  {text(he.story) && <Block label="סיפור / הקשר" value={text(he.story)} />}
                  <Block label="השאלה או המשימה" value={text(he.prompt)} accent />
                  <div className={styles.grid}>
                    <Block label="תשובות מתקבלות" value={accepted.length ? accepted.join(" · ") : text(validation.acceptedOption) || (riddle.kind === "photo" ? "אישור תמונה לפי הקריטריון" : "תשובה פתוחה לפי הכללים")} />
                    {options.length > 0 && <Block label="אפשרויות" value={options.join("  |  ")} />}
                    {text(validation.criteria) && <Block label="קריטריון צילום" value={text(validation.criteria)} />}
                    {typeof validation.minParticipants === "number" && <Block label="מינימום משתתפים" value={String(validation.minParticipants)} />}
                  </div>
                  {hints.length > 0 && <div className={styles.hints}><h3>רמזים</h3>{hints.map((hint, index) => <p key={index}><b>{index + 1}</b>{text(hint.he)} <small>−{String(hint.penalty ?? 0)} נק׳</small></p>)}</div>}
                  {text(fallback.he) && <div className={styles.fallback}><strong>חלופת גיבוי</strong><p>{text(fallback.he)}</p><small>מתקבל: {strings(fallback.accepted).join(" · ") || "לפי תנאי המשימה"}</small></div>}
                  {text(he.success) && <Block label="הודעת הצלחה" value={text(he.success)} />}
                </div>}
              </article>;
            })}
            {stops.length === 0 && <div className={styles.noResults}>לא נמצאו תחנות התואמות לחיפוש.</div>}
          </section>
        </>
      )}
    </main>
  );
}

function Block({ label, value, accent = false }: { label: string; value: string; accent?: boolean }) {
  return <div className={`${styles.block} ${accent ? styles.accent : ""}`}><span>{label}</span><p>{value || "—"}</p></div>;
}
