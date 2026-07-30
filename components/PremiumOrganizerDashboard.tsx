"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import {
  actionFingerprint,
  pendingIdempotencyKey,
  settleIdempotencyKey
} from "@/lib/client-idempotency";

type Team = {
  id: string;
  public_name: string;
  status: string;
  score: number;
  completed_count: number;
  current_checkpoint_slug: string | null;
  wrong_attempts: number;
  hints_used: number;
  last_progress_at: string | null;
  online_count: number;
  minutes_since_progress: number | null;
  is_stuck: boolean;
};

type Participant = {
  id: string;
  team_id: string | null;
  public_alias: string | null;
  language: string;
  whatsapp_connected_at: string | null;
  last_seen_at: string | null;
};

type Checkpoint = {
  id: string;
  slug: string;
  sequence_no: number;
  kind: string;
  is_disabled: boolean;
  source_active: boolean;
  fallback_ready: boolean;
  healthy: boolean;
};

type OutboxMessage = {
  id: string;
  participant_id: string | null;
  status: string;
  attempts: number;
  last_error: string | null;
  created_at: string;
  sent_at: string | null;
  send_after: string;
  target_scope: string | null;
};

type AuditEntry = {
  id: number;
  action: string;
  actor: string;
  reason: string;
  before_state: Record<string, unknown>;
  after_state: Record<string, unknown>;
  created_at: string;
};
type RecapShare = {
  id: string;
  team_id: string | null;
  active_until: string;
  revoked_at: string | null;
  created_by: string;
  created_at: string;
  is_active: boolean;
};
type CrossTeamEvent = {
  id: string;
  title: { he?: string; en?: string };
  instructions: { he?: string; en?: string };
  team_ids: string[];
  bonus_points: number;
  status: string;
  winning_team_ids: string[];
  expires_at: string | null;
  created_at: string;
};

type OrganizerData = {
  run: {
    public_code: string;
    status: string;
    scheduled_at: string | null;
    max_participants: number;
  };
  teams: Team[];
  participants: Participant[];
  checkpoints: Checkpoint[];
  outbox: OutboxMessage[];
  outboxSummary: {
    total: number;
    sent: number;
    failed: number;
    processing: number;
    pending: number;
  };
  audit: AuditEntry[];
  recapShares: RecapShare[];
  crossTeamEvents: CrossTeamEvent[];
  goNoGo: {
    ready: boolean;
    activeCheckpoints: number;
    unhealthyCheckpoints: number;
    missingFallbacks: number;
    failedMessages: number;
    stuckThresholdMinutes: number;
  };
  joinUrl: string;
  liveUrl: string;
};

const statusLabel: Record<string, string> = {
  draft: "טיוטה",
  registration_open: "הרשמה פתוחה",
  ready: "מוכן לזינוק",
  active: "המסע פעיל",
  paused: "מושהה",
  finished: "הושלם",
  cancelled: "בוטל",
  waiting: "ממתין",
  travelling: "בדרך",
  solving: "פותר",
  disqualified: "נפסל"
};

const actionLabel: Record<string, string> = {
  pause: "השהיית הרצה",
  resume: "חידוש הרצה",
  end: "סיום מוקדם",
  score: "שינוי ניקוד",
  force_complete: "השלמת תחנה",
  grant_hint: "הענקת רמז",
  move_participant: "העברת משתתף",
  disable_checkpoint: "השבתת תחנה",
  broadcast: "שידור הודעה",
  retry_message: "ניסיון שליחה חוזר",
  create_recap_share: "יצירת קישור סיכום",
  revoke_recap_share: "ביטול קישור סיכום",
  create_cross_team_event: "יצירת אתגר בין־צוותי",
  resolve_cross_team_event: "הכרעת אתגר בין־צוותי"
};

const formatTime = (value: string | null) =>
  value ? new Date(value).toLocaleString("he-IL") : "—";

export function PremiumOrganizerDashboard({ token }: { token: string }) {
  const [data, setData] = useState<OrganizerData | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [copied, setCopied] = useState("");
  const [reason, setReason] = useState("");
  const [moveParticipantId, setMoveParticipantId] = useState("");
  const [moveTeamId, setMoveTeamId] = useState("");
  const [outboxFilter, setOutboxFilter] = useState("failed");
  const [recapUrl, setRecapUrl] = useState("");
  const [challengeTeams, setChallengeTeams] = useState<string[]>([]);

  const refresh = useCallback(async () => {
    const response = await fetch(
      `/api/organizer/${encodeURIComponent(token)}`,
      { cache: "no-store" }
    );
    const payload = await response.json();
    if (!response.ok || !payload.ok) {
      throw new Error(payload.error?.message ?? "Failed to load game");
    }
    setData(payload.data);
  }, [token]);

  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;
    const run = async () => {
      if (document.visibilityState === "hidden") return;
      try {
        await refresh();
      } catch (errorValue) {
        if (!cancelled) {
          setError(
            errorValue instanceof Error ? errorValue.message : "Unexpected error"
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    const startPolling = () => {
      void run();
      window.clearInterval(timer);
      timer = window.setInterval(run, 7000);
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") startPolling();
    };
    startPolling();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [refresh]);

  async function control(
    action: string,
    extra: Record<string, unknown> = {},
    overrideReason = reason
  ) {
    const cleanReason = overrideReason.trim();
    if (cleanReason.length < 5) {
      setError("יש להזין סיבה קצרה להתערבות (לפחות 5 תווים).");
      return null;
    }
    const scope = actionFingerprint(
      JSON.stringify({ action, extra, reason: cleanReason })
    );
    const idempotencyKey = pendingIdempotencyKey("organizer", scope);
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch(
        `/api/organizer/${encodeURIComponent(token)}/control`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "idempotency-key": idempotencyKey
          },
          body: JSON.stringify({
            action,
            reason: cleanReason,
            ...extra
          })
        }
      );
      settleIdempotencyKey("organizer", scope, response);
      const payload = await response.json();
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error?.message ?? "Action failed");
      }
      setNotice("הפעולה נרשמה ביומן הבקרה והמערכת התעדכנה.");
      await refresh();
      return payload.data?.result ?? true;
    } catch (errorValue) {
      setError(
        errorValue instanceof Error ? errorValue.message : "Unexpected error"
      );
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function startRun() {
    const scope = "start";
    const idempotencyKey = pendingIdempotencyKey("organizer-start", scope);
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch(
        `/api/organizer/${encodeURIComponent(token)}/start`,
        {
          method: "POST",
          headers: { "idempotency-key": idempotencyKey }
        }
      );
      settleIdempotencyKey("organizer-start", scope, response);
      const payload = await response.json();
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error?.message ?? "Start failed");
      }
      setNotice("האות שודר. המסע התחיל.");
      await refresh();
    } catch (errorValue) {
      setError(
        errorValue instanceof Error ? errorValue.message : "Unexpected error"
      );
    } finally {
      setBusy(false);
    }
  }

  async function broadcast(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const bodyHe = String(form.get("bodyHe") ?? "").trim();
    const bodyEn = String(form.get("bodyEn") ?? "").trim();
    const teamId = String(form.get("teamId") ?? "").trim() || null;
    const activeMinutes = Number(form.get("activeMinutes") ?? 60);
    const sent = await control("broadcast", {
      bodyHe,
      bodyEn,
      teamId,
      activeMinutes
    });
    if (sent) event.currentTarget.reset();
  }

  async function createCrossTeamEvent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const created = await control("create_cross_team_event", {
      teamIds: challengeTeams,
      titleHe: String(form.get("titleHe") ?? "").trim(),
      titleEn: String(form.get("titleEn") ?? "").trim(),
      instructionsHe: String(form.get("instructionsHe") ?? "").trim(),
      instructionsEn: String(form.get("instructionsEn") ?? "").trim(),
      bonusPoints: Number(form.get("bonusPoints") ?? 25),
      activeMinutes: Number(form.get("activeMinutes") ?? 30)
    });
    if (created) {
      event.currentTarget.reset();
      setChallengeTeams([]);
    }
  }

  async function createRecapShare(teamId: string | null) {
    const result = await control("create_recap_share", {
      teamId,
      activeHours: 72
    });
    const url =
      result && typeof result === "object" && "recapUrl" in result
        ? String((result as { recapUrl: unknown }).recapUrl)
        : "";
    if (url) {
      setRecapUrl(url);
      await navigator.clipboard.writeText(url);
      setNotice("קישור הסיכום נוצר, הועתק ויישאר ניתן לביטול מחדר הבקרה.");
    }
  }

  async function copy(name: string, value: string) {
    await navigator.clipboard.writeText(value);
    setCopied(name);
    window.setTimeout(() => setCopied(""), 1600);
  }

  const filteredOutbox = useMemo(
    () =>
      data?.outbox.filter(
        (message) =>
          outboxFilter === "all" || message.status === outboxFilter
      ) ?? [],
    [data, outboxFilter]
  );

  if (loading) {
    return (
      <main className="control-room">
        <div className="control-shell">
          <div className="quest-loading">
            <img src="/visuals/quest-mark.svg" alt="" />
            <span>מחבר את חדר הבקרה…</span>
          </div>
        </div>
      </main>
    );
  }
  if (!data) {
    return (
      <main className="control-room">
        <div className="control-shell">
          <div className="flow-error">{error || "ההרצה לא נמצאה"}</div>
        </div>
      </main>
    );
  }

  const connected = data.participants.filter(
    (participant) => participant.whatsapp_connected_at
  ).length;
  const finished = data.teams.filter((team) => team.status === "finished").length;
  const canStart = ["draft", "registration_open", "ready"].includes(
    data.run.status
  );

  return (
    <main className="control-room">
      <div className="control-shell">
        <header className="control-header">
          <div>
            <span className="flow-kicker">
              LIVE CONTROL ROOM · {data.run.public_code}
            </span>
            <h1>התמונה המלאה, בזמן אמת.</h1>
            <p>
              מצב צוותים, נוכחות, בריאות תחנות, מסירת הודעות והתערבויות
              מתועדות — במקום אחד.
            </p>
          </div>
          <div className="status-orb">
            {statusLabel[data.run.status] ?? data.run.status}
          </div>
        </header>

        <section className="control-metrics">
          <article>
            <span>משתתפים</span>
            <strong>
              {data.participants.length}/{data.run.max_participants}
            </strong>
          </article>
          <article>
            <span>WhatsApp מחובר</span>
            <strong>{connected}</strong>
          </article>
          <article>
            <span>צוותים תקועים</span>
            <strong>{data.teams.filter((team) => team.is_stuck).length}</strong>
          </article>
          <article>
            <span>השלימו</span>
            <strong>
              {finished}/{data.teams.length}
            </strong>
          </article>
        </section>

        <section className="control-grid">
          <article className="control-panel">
            <span className="flow-kicker">GO / NO-GO</span>
            <h2 className={data.goNoGo.ready ? "ops-good" : "ops-bad"}>
              {data.goNoGo.ready ? "מוכן להפעלה" : "נדרשת בדיקה"}
            </h2>
            <div className="ops-health-grid">
              <div>
                <span>תחנות פעילות</span>
                <strong>{data.goNoGo.activeCheckpoints}</strong>
              </div>
              <div>
                <span>מקורות לא פעילים</span>
                <strong>{data.goNoGo.unhealthyCheckpoints}</strong>
              </div>
              <div>
                <span>גיבויים חסרים</span>
                <strong>{data.goNoGo.missingFallbacks}</strong>
              </div>
              <div>
                <span>מסירות שנכשלו</span>
                <strong>{data.goNoGo.failedMessages}</strong>
              </div>
            </div>
          </article>

          <article className="control-panel">
            <span className="flow-kicker">AUDITED OVERRIDE</span>
            <h2>סיבת התערבות</h2>
            <p>
              הסיבה חלה על הפעולה הבאה ונשמרת ביומן שאינו ניתן לשינוי.
            </p>
            <label className="ops-field">
              <span>סיבה</span>
              <input
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                maxLength={500}
                placeholder="למשל: חסימת רחוב ליד התחנה"
              />
            </label>
            <div className="emergency-actions">
              {canStart && (
                <button
                  className="button button-primary"
                  disabled={busy}
                  onClick={startRun}
                >
                  שידור אות הזינוק
                </button>
              )}
              {data.run.status === "active" && (
                <button
                  className="button button-secondary"
                  disabled={busy}
                  onClick={() => void control("pause")}
                >
                  השהיה
                </button>
              )}
              {data.run.status === "paused" && (
                <button
                  className="button button-primary"
                  disabled={busy}
                  onClick={() => void control("resume")}
                >
                  המשך
                </button>
              )}
              {!["finished", "cancelled"].includes(data.run.status) && (
                <button
                  className="button button-danger"
                  disabled={busy}
                  onClick={() => {
                    if (window.confirm("לסיים את ההרצה לכל הצוותים?")) {
                      void control("end");
                    }
                  }}
                >
                  סיום מוקדם
                </button>
              )}
            </div>
          </article>
        </section>

        <section className="control-grid">
          <article className="control-panel">
            <span className="flow-kicker">SHARE PACK</span>
            <h2>קישורים להרצה</h2>
            <div className="share-row">
              <code>{data.joinUrl}</code>
              <button
                className="button button-secondary"
                onClick={() => void copy("join", data.joinUrl)}
              >
                {copied === "join" ? "הועתק" : "העתקה"}
              </button>
            </div>
            <div className="share-row">
              <code>{data.liveUrl}</code>
              <button
                className="button button-secondary"
                onClick={() => void copy("live", data.liveUrl)}
              >
                {copied === "live" ? "הועתק" : "העתקה"}
              </button>
            </div>
          </article>

          <article className="control-panel">
            <span className="flow-kicker">BROADCAST</span>
            <h2>הודעה ב־WhatsApp ובמשחק</h2>
            <form className="broadcast-form" onSubmit={broadcast}>
              <textarea
                name="bodyHe"
                required
                maxLength={800}
                placeholder="הודעה בעברית"
              />
              <textarea
                name="bodyEn"
                required
                maxLength={800}
                placeholder="Message in English"
                dir="ltr"
              />
              <div className="ops-inline-fields">
                <select name="teamId" defaultValue="">
                  <option value="">כל המשתתפים</option>
                  {data.teams.map((team) => (
                    <option key={team.id} value={team.id}>
                      {team.public_name}
                    </option>
                  ))}
                </select>
                <select name="activeMinutes" defaultValue="60">
                  <option value="15">הצגה ל־15 דקות</option>
                  <option value="60">הצגה לשעה</option>
                  <option value="240">הצגה ל־4 שעות</option>
                </select>
              </div>
              <button className="button button-primary" disabled={busy}>
                שידור מתועד
              </button>
            </form>
          </article>
        </section>

        <section className="control-panel control-section">
          <span className="flow-kicker">CROSS-TEAM LIVE EVENT</span>
          <h2>אתגר משותף עם בונוס מתועד</h2>
          <p>
            בחרו שני צוותים או יותר. האתגר מופיע בתוך המשחק, והענקת הבונוס
            אטומית ונרשמת ביומן הבקרה.
          </p>
          <form className="broadcast-form" onSubmit={createCrossTeamEvent}>
            <div className="challenge-team-picker">
              {data.teams.map((team) => (
                <label key={team.id}>
                  <input
                    type="checkbox"
                    checked={challengeTeams.includes(team.id)}
                    onChange={(event) =>
                      setChallengeTeams((current) =>
                        event.target.checked
                          ? [...new Set([...current, team.id])]
                          : current.filter((id) => id !== team.id)
                      )
                    }
                  />
                  {team.public_name}
                </label>
              ))}
            </div>
            <div className="ops-inline-fields">
              <input name="titleHe" required placeholder="כותרת בעברית" />
              <input
                name="titleEn"
                required
                placeholder="English title"
                dir="ltr"
              />
            </div>
            <textarea name="instructionsHe" placeholder="הוראות בעברית" />
            <textarea
              name="instructionsEn"
              placeholder="Instructions in English"
              dir="ltr"
            />
            <div className="ops-inline-fields">
              <input
                name="bonusPoints"
                type="number"
                min="0"
                max="1000"
                defaultValue="25"
              />
              <select name="activeMinutes" defaultValue="30">
                <option value="15">15 דקות</option>
                <option value="30">30 דקות</option>
                <option value="60">שעה</option>
              </select>
            </div>
            <button
              className="button button-primary"
              disabled={busy || challengeTeams.length < 2}
            >
              פתיחת אתגר
            </button>
          </form>
          <div className="cross-team-event-list">
            {data.crossTeamEvents.map((event) => (
              <article key={event.id}>
                <div>
                  <strong>{event.title.he || event.title.en}</strong>
                  <small>
                    {event.status} · {event.bonus_points} נק׳ ·{" "}
                    {event.expires_at ? formatTime(event.expires_at) : "ללא תפוגה"}
                  </small>
                </div>
                {event.status === "active" && (
                  <div className="row-actions">
                    {data.teams
                      .filter((team) => event.team_ids.includes(team.id))
                      .map((team) => (
                        <button
                          type="button"
                          className="button button-secondary"
                          disabled={busy}
                          key={team.id}
                          onClick={() =>
                            void control("resolve_cross_team_event", {
                              eventId: event.id,
                              winningTeamIds: [team.id]
                            })
                          }
                        >
                          {team.public_name} ניצחו
                        </button>
                      ))}
                  </div>
                )}
              </article>
            ))}
          </div>
        </section>

        <section className="control-panel control-section">
          <span className="flow-kicker">TEAM TELEMETRY</span>
          <h2>מפת מצב צוותים</h2>
          <div className="team-control-list">
            {data.teams.map((team) => (
              <div
                className={`team-control-row ${team.is_stuck ? "is-stuck" : ""}`}
                key={team.id}
              >
                <div>
                  <strong>{team.public_name}</strong>
                  <small>
                    {team.current_checkpoint_slug || "טרם התחיל"} ·{" "}
                    {team.online_count} מחוברים
                  </small>
                </div>
                <span>{statusLabel[team.status] ?? team.status}</span>
                <span>{team.completed_count}/{data.goNoGo.activeCheckpoints}</span>
                <span>{team.score} נק׳</span>
                <span>
                  {team.is_stuck
                    ? `תקוע ${team.minutes_since_progress} דק׳`
                    : `${team.wrong_attempts} שגיאות · ${team.hints_used} רמזים`}
                </span>
                <div className="row-actions">
                  <button
                    className="button button-secondary"
                    disabled={busy}
                    onClick={() => void control("grant_hint", { teamId: team.id })}
                  >
                    רמז
                  </button>
                  <button
                    className="button button-secondary"
                    disabled={busy}
                    onClick={() =>
                      void control("force_complete", { teamId: team.id })
                    }
                  >
                    השלמה
                  </button>
                  <button
                    className="button button-secondary"
                    disabled={busy}
                    onClick={() =>
                      void control("score", { teamId: team.id, delta: 10 })
                    }
                  >
                    +10
                  </button>
                  <button
                    className="button button-secondary"
                    disabled={busy}
                    onClick={() =>
                      void control("score", { teamId: team.id, delta: -10 })
                    }
                  >
                    −10
                  </button>
                  <button
                    className="button button-secondary"
                    disabled={busy}
                    onClick={() => void createRecapShare(team.id)}
                  >
                    סיכום
                  </button>
                </div>
              </div>
            ))}
            {!data.teams.length && (
              <div className="team-control-row">
                <strong>הצוותים יופיעו לאחר ההרשמה</strong>
              </div>
            )}
          </div>
        </section>

        <section className="control-panel control-section">
          <span className="flow-kicker">RECAP & DETERMINISTIC REPLAY</span>
          <h2>קישורי סיכום ניתנים לביטול</h2>
          <p>
            הקישור מציג סטטיסטיקות, תמונות וציר אירועים שניתן לנגן מחדש.
            תוקפו מוגבל לתקופת שמירת ההרצה.
          </p>
          <div className="emergency-actions">
            <button
              className="button button-primary"
              disabled={busy}
              onClick={() => void createRecapShare(null)}
            >
              יצירת סיכום לכל ההרצה
            </button>
          </div>
          {recapUrl && (
            <div className="share-row">
              <code>{recapUrl}</code>
              <a
                className="button button-secondary"
                href={recapUrl}
                target="_blank"
                rel="noreferrer"
              >
                פתיחה
              </a>
            </div>
          )}
          <div className="recap-share-list">
            {data.recapShares.map((share) => {
              const team = data.teams.find((item) => item.id === share.team_id);
              return (
                <div key={share.id}>
                  <span>
                    <strong>{team?.public_name ?? "כל ההרצה"}</strong>
                    <small>
                      {share.is_active ? "פעיל" : "בוטל / פג"} · עד{" "}
                      {formatTime(share.active_until)}
                    </small>
                  </span>
                  {share.is_active && (
                    <button
                      className="button button-secondary"
                      disabled={busy}
                      onClick={() =>
                        void control("revoke_recap_share", {
                          shareId: share.id
                        })
                      }
                    >
                      ביטול קישור
                    </button>
                  )}
                </div>
              );
            })}
            {!data.recapShares.length && <p>טרם נוצרו קישורי סיכום.</p>}
          </div>
        </section>

        <section className="control-grid">
          <article className="control-panel">
            <span className="flow-kicker">PARTICIPANT RECOVERY</span>
            <h2>העברת משתתף בין צוותים</h2>
            <div className="ops-stack">
              <select
                value={moveParticipantId}
                onChange={(event) => setMoveParticipantId(event.target.value)}
              >
                <option value="">בחירת משתתף</option>
                {data.participants.map((participant) => (
                  <option key={participant.id} value={participant.id}>
                    {participant.public_alias || participant.id.slice(0, 8)}
                  </option>
                ))}
              </select>
              <select
                value={moveTeamId}
                onChange={(event) => setMoveTeamId(event.target.value)}
              >
                <option value="">בחירת צוות יעד</option>
                {data.teams.map((team) => (
                  <option key={team.id} value={team.id}>
                    {team.public_name}
                  </option>
                ))}
              </select>
              <button
                className="button button-secondary"
                disabled={busy || !moveParticipantId || !moveTeamId}
                onClick={() =>
                  void control("move_participant", {
                    participantId: moveParticipantId,
                    targetTeamId: moveTeamId
                  })
                }
              >
                העברה ועדכון הרשאות בזמן אמת
              </button>
            </div>
          </article>

          <article className="control-panel">
            <span className="flow-kicker">CHECKPOINT HEALTH</span>
            <h2>תחנות וגיבויים</h2>
            <div className="checkpoint-health-list">
              {data.checkpoints.map((checkpoint) => (
                <div key={checkpoint.id}>
                  <span>
                    {checkpoint.sequence_no}. {checkpoint.slug}
                  </span>
                  <small>
                    {checkpoint.is_disabled
                      ? "מושבתת"
                      : checkpoint.source_active
                        ? checkpoint.fallback_ready ||
                          !["photo", "hybrid"].includes(checkpoint.kind)
                          ? "תקינה"
                          : "ללא גיבוי"
                        : "מקור לא פעיל"}
                  </small>
                  {!checkpoint.is_disabled && (
                    <button
                      className="button button-secondary"
                      disabled={busy}
                      onClick={() => {
                        if (
                          window.confirm(
                            "להשבית את התחנה ולהעביר צוותים שנמצאים בה?"
                          )
                        ) {
                          void control("disable_checkpoint", {
                            checkpointSlug: checkpoint.slug
                          });
                        }
                      }}
                    >
                      השבתה
                    </button>
                  )}
                </div>
              ))}
            </div>
          </article>
        </section>

        <section className="control-grid">
          <article className="control-panel">
            <span className="flow-kicker">OUTBOX MONITOR</span>
            <h2>מסירת הודעות</h2>
            <p>
              {data.outboxSummary.sent} נשלחו · {data.outboxSummary.pending} בתור ·{" "}
              {data.outboxSummary.failed} נכשלו
            </p>
            <div className="ops-tabs">
              {["failed", "pending", "sent", "all"].map((filter) => (
                <button
                  type="button"
                  key={filter}
                  className={outboxFilter === filter ? "active" : ""}
                  onClick={() => setOutboxFilter(filter)}
                >
                  {filter}
                </button>
              ))}
            </div>
            <div className="outbox-list">
              {filteredOutbox.slice(0, 20).map((message) => (
                <div key={message.id}>
                  <span>
                    <strong>{message.status}</strong>
                    <small>
                      {message.target_scope || "participant"} · ניסיון{" "}
                      {message.attempts}
                    </small>
                  </span>
                  <time>{formatTime(message.sent_at || message.created_at)}</time>
                  {message.status === "failed" && (
                    <button
                      className="button button-secondary"
                      disabled={busy}
                      onClick={() =>
                        void control("retry_message", {
                          messageId: message.id
                        })
                      }
                    >
                      ניסיון חוזר
                    </button>
                  )}
                  {message.last_error && <em>{message.last_error}</em>}
                </div>
              ))}
              {!filteredOutbox.length && <p>אין הודעות במסנן זה.</p>}
            </div>
          </article>

          <article className="control-panel">
            <span className="flow-kicker">IMMUTABLE AUDIT</span>
            <h2>יומן התערבויות</h2>
            <div className="audit-list">
              {data.audit.slice(0, 20).map((entry) => (
                <div key={entry.id}>
                  <strong>{actionLabel[entry.action] ?? entry.action}</strong>
                  <span>{entry.reason}</span>
                  <time>{formatTime(entry.created_at)}</time>
                </div>
              ))}
              {!data.audit.length && <p>טרם בוצעו התערבויות.</p>}
            </div>
          </article>
        </section>

        {notice && (
          <div className="quest-feedback success control-feedback">
            {notice}
          </div>
        )}
        {error && (
          <div className="quest-feedback error control-feedback" role="alert">
            {error}
          </div>
        )}
      </div>
    </main>
  );
}
