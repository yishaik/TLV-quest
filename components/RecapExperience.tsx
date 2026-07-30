"use client";

import { useEffect, useMemo, useState } from "react";
import type { ReplayEvent, ReplayFrame } from "@/lib/quest-replay";
import styles from "./RecapExperience.module.css";

type RecapData = {
  share: { id: string; activeUntil: string; scope: "team" | "run" };
  run: {
    publicCode: string;
    status: string;
    startedAt: string | null;
    finishedAt: string | null;
  };
  teams: Array<{
    id: string;
    name: string;
    status: string;
    score: number;
    completedCount: number;
  }>;
  checkpoints: Array<{ slug: string; sequenceNo: number; title: string }>;
  events: ReplayEvent[];
  photos: Array<{
    id: string;
    teamId: string | null;
    actorName: string | null;
    checkpointSlug: string | null;
    approved: boolean;
    createdAt: string;
    url: string;
  }>;
  stats: {
    durationSeconds: number;
    accepted: number;
    wrongAttempts: number;
    hints: number;
    photos: number;
    teamCount: number;
    participantCount: number;
    photoCount: number;
    finalScore: number;
  };
  replay: {
    version: number;
    checksum: string;
    frames: ReplayFrame[];
  };
};

const eventCopy: Record<string, string> = {
  PLAYER_JOINED: "הצטרפות למסע",
  RUN_STARTED: "אות הזינוק",
  LOCATION_VERIFIED: "המיקום אומת",
  STATION_SCANNED: "התחנה נסרקה",
  ANSWER_ACCEPTED: "התחנה נפתחה",
  ANSWER_REJECTED: "ניסיון תשובה",
  HINT_REQUESTED: "רמז נחשף",
  HINT_OFFERED: "רמז הוצע",
  PHOTO_APPROVED: "התמונה אושרה",
  PHOTO_REJECTED: "התמונה לא אושרה",
  OPTIONAL_CHECKPOINT_SKIPPED: "תחנה אופציונלית דולגה",
  ORGANIZER_OVERRIDE: "התערבות מארגן",
  ORGANIZER_BROADCAST: "שידור מהמארגן",
  RECAP_SHARE_CREATED: "הסיכום נוצר"
};

const formatDuration = (seconds: number) => {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remaining = seconds % 60;
  return [
    hours ? `${hours}ש׳` : "",
    minutes ? `${minutes}ד׳` : "",
    !hours ? `${remaining}שנ׳` : ""
  ]
    .filter(Boolean)
    .join(" ");
};

const formatTime = (value: string) =>
  new Date(value).toLocaleTimeString("he-IL", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });

export function RecapExperience({ token }: { token: string }) {
  const [data, setData] = useState<RecapData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [frameIndex, setFrameIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void fetch(`/api/recap/${encodeURIComponent(token)}`, {
      cache: "no-store"
    })
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok || !payload.ok) {
          throw new Error(payload.error?.message ?? "Recap unavailable");
        }
        if (!cancelled) setData(payload.data);
      })
      .catch((cause) => {
        if (!cancelled) {
          setError(cause instanceof Error ? cause.message : "Recap unavailable");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  useEffect(() => {
    if (!playing || !data?.replay.frames.length) return;
    const timer = window.setTimeout(() => {
      setFrameIndex((current) => {
        if (current >= data.replay.frames.length - 1) {
          setPlaying(false);
          return current;
        }
        return current + 1;
      });
    }, 850);
    return () => window.clearTimeout(timer);
  }, [data, frameIndex, playing]);

  const currentFrame = data?.replay.frames[frameIndex] ?? null;
  const replayTeams = useMemo(
    () =>
      [...(currentFrame?.teams ?? [])].sort(
        (left, right) =>
          right.score - left.score ||
          right.completedCount - left.completedCount
      ),
    [currentFrame]
  );
  const checkpointTitles = useMemo(
    () =>
      new Map(
        data?.checkpoints.map((checkpoint) => [
          checkpoint.slug,
          checkpoint.title
        ]) ?? []
      ),
    [data]
  );

  if (loading) {
    return (
      <main className={styles.shell}>
        <div className={styles.loading}>מרכיב את סיפור המסע…</div>
      </main>
    );
  }
  if (!data) {
    return (
      <main className={styles.shell}>
        <section className={styles.unavailable}>
          <span>TLV QUEST</span>
          <h1>הסיכום אינו זמין.</h1>
          <p>{error || "הקישור בוטל או שתוקפו פג."}</p>
        </section>
      </main>
    );
  }

  return (
    <main className={styles.shell}>
      <header className={styles.hero}>
        <div>
          <span className={styles.eyebrow}>
            QUEST RECAP · {data.run.publicCode}
          </span>
          <h1>הנמל זוכר את המסע שלכם.</h1>
          <p>
            הרגעים, התמונות וההחלטות — מסודרים מחדש מתוך יומן האירועים
            המקורי.
          </p>
        </div>
        <div className={styles.heroActions}>
          <button
            type="button"
            onClick={async () => {
              await navigator.clipboard.writeText(window.location.href);
              setCopied(true);
              window.setTimeout(() => setCopied(false), 1400);
            }}
          >
            {copied ? "הועתק" : "שיתוף"}
          </button>
          <small>
            זמין עד {new Date(data.share.activeUntil).toLocaleString("he-IL")}
          </small>
        </div>
      </header>

      <section className={styles.metrics}>
        <article>
          <span>משך</span>
          <strong>{formatDuration(data.stats.durationSeconds)}</strong>
        </article>
        <article>
          <span>תחנות שנפתחו</span>
          <strong>{data.stats.accepted}</strong>
        </article>
        <article>
          <span>רמזים</span>
          <strong>{data.stats.hints}</strong>
        </article>
        <article>
          <span>תמונות</span>
          <strong>{data.stats.photoCount}</strong>
        </article>
        <article>
          <span>ניקוד סופי</span>
          <strong>{data.stats.finalScore}</strong>
        </article>
      </section>

      <section className={styles.teamResults}>
        <div className={styles.sectionHeading}>
          <span className={styles.eyebrow}>FINAL STATE</span>
          <h2>איך זה הסתיים</h2>
        </div>
        <div className={styles.teamGrid}>
          {data.teams.map((team, index) => (
            <article key={team.id}>
              <span>#{index + 1}</span>
              <h3>{team.name}</h3>
              <strong>{team.score}</strong>
              <small>{team.completedCount} תחנות</small>
            </article>
          ))}
        </div>
      </section>

      <section className={styles.replay}>
        <div className={styles.sectionHeading}>
          <span className={styles.eyebrow}>DETERMINISTIC REPLAY · V1</span>
          <h2>לנגן את המסע מחדש</h2>
          <p>
            כל פריים נגזר בסדר קבוע מאירועי המקור. מזהה אימות:{" "}
            <code>{data.replay.checksum.slice(0, 16)}</code>
          </p>
        </div>
        {currentFrame ? (
          <>
            <div className={styles.replayStage}>
              <header>
                <div>
                  <span>{formatTime(currentFrame.at)}</span>
                  <strong>
                    {eventCopy[currentFrame.event.eventType] ??
                      currentFrame.event.eventType}
                  </strong>
                </div>
                <small>
                  {currentFrame.event.actorName || "מערכת"} ·{" "}
                  {currentFrame.event.checkpointSlug
                    ? checkpointTitles.get(
                        currentFrame.event.checkpointSlug
                      ) ?? currentFrame.event.checkpointSlug
                    : "אירוע כללי"}
                </small>
              </header>
              <div className={styles.replayBoard}>
                {replayTeams.map((team, index) => (
                  <article key={team.id}>
                    <span>{index + 1}</span>
                    <strong>{team.name}</strong>
                    <small>
                      {team.completedCount} תחנות · {team.status}
                    </small>
                    <b>{team.score}</b>
                  </article>
                ))}
              </div>
            </div>
            <div className={styles.replayControls}>
              <button
                type="button"
                onClick={() => {
                  if (
                    frameIndex >= data.replay.frames.length - 1 &&
                    !playing
                  ) {
                    setFrameIndex(0);
                  }
                  setPlaying((value) => !value);
                }}
              >
                {playing ? "השהיה" : "ניגון"}
              </button>
              <input
                type="range"
                min={0}
                max={Math.max(0, data.replay.frames.length - 1)}
                value={frameIndex}
                onChange={(event) => {
                  setPlaying(false);
                  setFrameIndex(Number(event.target.value));
                }}
                aria-label="Replay timeline"
              />
              <span>
                {frameIndex + 1}/{data.replay.frames.length}
              </span>
            </div>
          </>
        ) : (
          <p>אין מספיק אירועים לניגון.</p>
        )}
      </section>

      {data.photos.length > 0 && (
        <section className={styles.gallery}>
          <div className={styles.sectionHeading}>
            <span className={styles.eyebrow}>FIELD MOMENTS</span>
            <h2>התמונות מהדרך</h2>
          </div>
          <div>
            {data.photos.map((photo) => (
              <figure key={photo.id}>
                <img src={photo.url} alt="" />
                <figcaption>
                  <strong>{photo.actorName || "הצוות"}</strong>
                  <span>
                    {photo.checkpointSlug
                      ? checkpointTitles.get(photo.checkpointSlug) ??
                        photo.checkpointSlug
                      : "רגע מהמסע"}
                  </span>
                </figcaption>
              </figure>
            ))}
          </div>
        </section>
      )}

      <section className={styles.timeline}>
        <div className={styles.sectionHeading}>
          <span className={styles.eyebrow}>SOURCE TIMELINE</span>
          <h2>ציר האירועים</h2>
        </div>
        <div>
          {data.events.map((event) => (
            <article key={event.id}>
              <time>{formatTime(event.createdAt)}</time>
              <i />
              <span>
                <strong>{eventCopy[event.eventType] ?? event.eventType}</strong>
                <small>
                  {event.actorName || "מערכת"}
                  {event.checkpointSlug
                    ? ` · ${checkpointTitles.get(event.checkpointSlug) ?? event.checkpointSlug}`
                    : ""}
                </small>
              </span>
              {event.scoreDelta !== 0 && (
                <b>
                  {event.scoreDelta > 0 ? "+" : ""}
                  {event.scoreDelta}
                </b>
              )}
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}
