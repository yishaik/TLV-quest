"use client";

import {
  FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useState
} from "react";
import { ClientIdempotencyKeys } from "@/lib/idempotency-client";

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
  field_health_status: string;
  field_health_notes: string | null;
  field_last_checked_at: string | null;
  fallback_ready: boolean;
  healthy: boolean;
};

type OutboxMessage = {
  id: string;
  participant_id: string | null;
  status: string;
  attempts: number;
  last_error: string | null;
  provider_status: string | null;
  provider_error_code: string | null;
  created_at: string;
  sent_at: string | null;
  delivered_at: string | null;
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
    queued: number;
    processing: number;
    sent: number;
    delivered: number;
    failed: number;
  };
  audit: AuditEntry[];
  goNoGo: {
    ready: boolean;
    activeCheckpoints: number;
    verifiedCheckpoints: number;
    pendingCheckpoints: number;
    blockedCheckpoints: number;
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
  skip: "דילוג תחנה",
  score: "שינוי ניקוד",
  force_complete: "השלמת תחנה",
  grant_hint: "הענקת רמז",
  move_participant: "העברת משתתף",
  disable_checkpoint: "השבתת תחנה",
  broadcast: "שידור הודעה",
  retry_message: "ניסיון שליחה חוזר"
};

const checkpointHealthLabel: Record<string, string> = {
  verified: "מאומתת בשטח",
  not_required: "לא נדרש אימות",
  pending: "ממתינה לאימות",
  needs_attention: "דורשת טיפול",
  blocked: "חסומה"
};

const formatTime = (value: string | null) =>
  value ? new Date(value).toLocaleString("he-IL") : "—";

const readApiPayload = async (response: Response) => {
  try {
    return (await response.json()) as {
      ok?: boolean;
      data?: Record<string, unknown>;
      error?: { message?: string };
    };
  } catch {
    throw new Error(
      `השרת החזיר תשובה לא תקינה (${response.status}). נסו שוב.`
    );
  }
};

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
  const [idempotencyKeys] = useState(() => new ClientIdempotencyKeys());

  const refresh = useCallback(async () => {
    const response = await fetch(
      `/api/organizer/${encodeURIComponent(token)}`,
      { cache: "no-store" }
    );
    const payload = await readApiPayload(response);
    if (!response.ok || !payload.ok) {
      throw new Error(payload.error?.message ?? "Failed to load game");
    }
    setData(payload.data as unknown as OrganizerData);
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
            errorValue instanceof Error
              ? errorValue.message
              : "Unexpected error"
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
    extra: Record<string, unknown> = {}
  ): Promise<Record<string, unknown> | null> {
    const cleanReason = reason.trim();
    if (cleanReason.length < 5) {
      setError("יש להזין סיבה להתערבות (לפחות 5 תווים).");
      return null;
    }
    const scope = JSON.stringify({ action, extra, reason: cleanReason });
    const idempotencyKey = idempotencyKeys.acquire(
      scope,
      "web-organizer"
    );
    let requestSettled = false;
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
      const payload = await readApiPayload(response);
      idempotencyKeys.settle(scope, idempotencyKey, response.status);
      requestSettled = true;
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error?.message ?? "Action failed");
      }
      const actionResult = payload.data ?? {};
      const delivery =
        actionResult.delivery &&
        typeof actionResult.delivery === "object" &&
        !Array.isArray(actionResult.delivery)
          ? (actionResult.delivery as Record<string, unknown>)
          : null;
      const skip =
        actionResult.skip &&
        typeof actionResult.skip === "object" &&
        !Array.isArray(actionResult.skip)
          ? (actionResult.skip as Record<string, unknown>)
          : null;
      const skipFailures = Array.isArray(skip?.failures)
        ? skip.failures
        : [];

      if (action === "broadcast" && delivery) {
        setNotice(
          `השידור נרשם ו־${Number(delivery.queued ?? 0)} הודעות נכנסו לתור.`
        );
      } else if (action === "skip" && skip) {
        setNotice(
          `הדילוג קידם ${Number(skip.advanced ?? 0) + Number(skip.finished ?? 0)} צוותים ויצר ${Number(skip.queued ?? 0)} הודעות.`
        );
      } else if (action === "retry_message") {
        setNotice("ההודעה הוחזרה לתור באופן בטוח.");
      } else {
        setNotice("הפעולה נרשמה ביומן הבקרה והמערכת התעדכנה.");
      }
      if (skipFailures.length) {
        setError(
          `הפעולה הושלמה חלקית: ${skipFailures.length} צוותים לא עודכנו. ניתן לנסות שוב בבטחה.`
        );
      }
      await refresh();
      return actionResult;
    } catch (errorValue) {
      if (!requestSettled) {
        idempotencyKeys.settle(scope, idempotencyKey, undefined);
      }
      setError(
        errorValue instanceof Error
          ? errorValue.message
          : "Unexpected error"
      );
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function startRun() {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch(
        `/api/organizer/${encodeURIComponent(token)}/start`,
        { method: "POST" }
      );
      const payload = await readApiPayload(response);
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error?.message ?? "Start failed");
      }
      setNotice("האות שודר. המסע התחיל.");
      await refresh();
    } catch (errorValue) {
      setError(
        errorValue instanceof Error
          ? errorValue.message
          : "Unexpected error"
      );
    } finally {
      setBusy(false);
    }
  }

  async function broadcast(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const sent = await control("broadcast", {
      bodyHe: String(form.get("bodyHe") ?? "").trim(),
      bodyEn: String(form.get("bodyEn") ?? "").trim(),
      teamId: String(form.get("teamId") ?? "").trim() || null,
      activeMinutes: Number(form.get("activeMinutes") ?? 60)
    });
    if (sent) formElement.reset();
  }

  async function copy(name: string, value: string) {
    await navigator.clipboard.writeText(value);
    setCopied(name);
    window.setTimeout(() => setCopied(""), 1600);
  }

  const filteredOutbox = useMemo(
    () =>
      data?.outbox.filter((message) => {
        if (outboxFilter === "all") return true;
        if (outboxFilter === "queued") {
          return ["pending", "processing"].includes(message.status);
        }
        if (outboxFilter === "failed") {
          return ["failed", "cancelled"].includes(message.status);
        }
        return message.status === outboxFilter;
      }) ?? [],
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
  const finished = data.teams.filter(
    (team) => team.status === "finished"
  ).length;
  const canStart = ["draft", "registration_open", "ready"].includes(
    data.run.status
  );
  const hasReason = reason.trim().length >= 5;
  const overrideDisabled = busy || !hasReason;

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
              {data.goNoGo.ready ? "מוכן להפעלה" : "נדרשת פעולה"}
            </h2>
            <div className="ops-health-grid">
              <div>
                <span>תחנות פעילות</span>
                <strong>{data.goNoGo.activeCheckpoints}</strong>
              </div>
              <div>
                <span>מאומתות / לא נדרש</span>
                <strong>{data.goNoGo.verifiedCheckpoints}</strong>
              </div>
              <div>
                <span>ממתינות לאימות</span>
                <strong>{data.goNoGo.pendingCheckpoints}</strong>
              </div>
              <div>
                <span>חסומות / דורשות טיפול</span>
                <strong>{data.goNoGo.blockedCheckpoints}</strong>
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
            <h2>בקרה והתערבות</h2>
            <p>
              הסיבה חלה על הפעולה הבאה ונשמרת עם מצב לפני ואחרי ביומן שאינו
              ניתן לשינוי דרך האפליקציה.
            </p>
            <label className="ops-field">
              <span>סיבת התערבות</span>
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
                  onClick={() => void startRun()}
                >
                  שידור אות הזינוק
                </button>
              )}
              {data.run.status === "active" && (
                <>
                  <button
                    className="button button-secondary"
                    disabled={overrideDisabled}
                    onClick={() => void control("pause")}
                  >
                    השהיה
                  </button>
                  <button
                    className="button button-secondary"
                    disabled={overrideDisabled}
                    onClick={() => void control("skip")}
                  >
                    דילוג תחנה לכל הצוותים
                  </button>
                </>
              )}
              {data.run.status === "paused" && (
                <button
                  className="button button-primary"
                  disabled={overrideDisabled}
                  onClick={() => void control("resume")}
                >
                  המשך
                </button>
              )}
              {!["finished", "cancelled"].includes(data.run.status) && (
                <button
                  className="button button-danger"
                  disabled={overrideDisabled}
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
              <button
                className="button button-primary"
                disabled={overrideDisabled}
              >
                שידור מתועד
              </button>
            </form>
          </article>
        </section>

        <section className="control-panel control-section">
          <span className="flow-kicker">TEAM TELEMETRY</span>
          <h2>מפת מצב צוותים</h2>
          <p>
            צוות מסומן כתקוע אחרי {data.goNoGo.stuckThresholdMinutes} דקות ללא
            התקדמות. בכל שורה זמינות פעולות התאוששות.
          </p>
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
                <span>
                  {team.completed_count}/{data.goNoGo.activeCheckpoints}
                </span>
                <span>{team.score} נק׳</span>
                <span>
                  {team.is_stuck
                    ? `תקוע ${team.minutes_since_progress} דק׳`
                    : team.minutes_since_progress === null
                      ? "טרם נרשמה התקדמות"
                      : `עודכן לפני ${team.minutes_since_progress} דק׳`}
                  <small>
                    {team.wrong_attempts} שגיאות · {team.hints_used} רמזים
                  </small>
                </span>
                <div className="row-actions">
                  <button
                    className="button button-secondary"
                    disabled={overrideDisabled}
                    onClick={() =>
                      void control("grant_hint", { teamId: team.id })
                    }
                  >
                    רמז
                  </button>
                  <button
                    className="button button-secondary"
                    disabled={overrideDisabled}
                    onClick={() => {
                      if (window.confirm(`להשלים תחנה לצוות ${team.public_name}?`)) {
                        void control("force_complete", { teamId: team.id });
                      }
                    }}
                  >
                    השלמה
                  </button>
                  <button
                    className="button button-secondary"
                    disabled={overrideDisabled}
                    onClick={() =>
                      void control("score", {
                        teamId: team.id,
                        delta: 10
                      })
                    }
                  >
                    +10
                  </button>
                  <button
                    className="button button-secondary"
                    disabled={overrideDisabled}
                    onClick={() =>
                      void control("score", {
                        teamId: team.id,
                        delta: -10
                      })
                    }
                  >
                    −10
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

        <section className="control-grid">
          <article className="control-panel">
            <span className="flow-kicker">PARTICIPANT RECOVERY</span>
            <h2>העברת משתתף בין צוותים</h2>
            <div className="ops-stack">
              <select
                value={moveParticipantId}
                onChange={(event) =>
                  setMoveParticipantId(event.target.value)
                }
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
                disabled={
                  overrideDisabled || !moveParticipantId || !moveTeamId
                }
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
            <h2>אימות, חסימות וגיבויים</h2>
            <div className="checkpoint-health-list">
              {data.checkpoints.map((checkpoint) => (
                <div
                  className={!checkpoint.healthy ? "is-unhealthy" : ""}
                  key={checkpoint.id}
                >
                  <span>
                    {checkpoint.sequence_no}. {checkpoint.slug}
                  </span>
                  <small>
                    {checkpoint.is_disabled
                      ? "מושבתת"
                      : !checkpoint.source_active
                        ? "מקור תוכן לא פעיל"
                        : checkpointHealthLabel[
                            checkpoint.field_health_status
                          ] ?? checkpoint.field_health_status}
                    {["photo", "hybrid"].includes(checkpoint.kind) &&
                    !checkpoint.fallback_ready
                      ? " · חסר גיבוי"
                      : ""}
                  </small>
                  {checkpoint.field_health_notes && (
                    <em>{checkpoint.field_health_notes}</em>
                  )}
                  {!checkpoint.is_disabled && (
                    <button
                      className="button button-secondary"
                      disabled={overrideDisabled}
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
                      השבתה וקידום צוותים
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
              {data.outboxSummary.delivered} נמסרו ·{" "}
              {data.outboxSummary.sent} נשלחו ·{" "}
              {data.outboxSummary.queued + data.outboxSummary.processing} בתור
              · {data.outboxSummary.failed} נכשלו
            </p>
            <div className="ops-tabs">
              {[
                ["failed", "נכשלו"],
                ["queued", "בתור"],
                ["sent", "נשלחו"],
                ["all", "הכול"]
              ].map(([filter, label]) => (
                <button
                  type="button"
                  key={filter}
                  className={outboxFilter === filter ? "active" : ""}
                  onClick={() => setOutboxFilter(filter)}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="outbox-list">
              {filteredOutbox.slice(0, 50).map((message) => (
                <div key={message.id}>
                  <span>
                    <strong>
                      {message.provider_status || message.status}
                    </strong>
                    <small>
                      {message.target_scope || "participant"} · ניסיון{" "}
                      {message.attempts}
                    </small>
                  </span>
                  <time>
                    {formatTime(
                      message.delivered_at ||
                        message.sent_at ||
                        message.created_at
                    )}
                  </time>
                  {["failed", "cancelled"].includes(message.status) && (
                    <button
                      className="button button-secondary"
                      disabled={overrideDisabled}
                      onClick={() =>
                        void control("retry_message", {
                          messageId: message.id
                        })
                      }
                    >
                      ניסיון חוזר
                    </button>
                  )}
                  {(message.last_error || message.provider_error_code) && (
                    <em>
                      {message.provider_error_code || message.last_error}
                    </em>
                  )}
                </div>
              ))}
              {!filteredOutbox.length && <p>אין הודעות במסנן זה.</p>}
            </div>
          </article>

          <article className="control-panel">
            <span className="flow-kicker">IMMUTABLE AUDIT</span>
            <h2>יומן התערבויות</h2>
            <div className="audit-list">
              {data.audit.slice(0, 50).map((entry) => (
                <div key={entry.id}>
                  <strong>{actionLabel[entry.action] ?? entry.action}</strong>
                  <span>{entry.reason}</span>
                  <time>{formatTime(entry.created_at)}</time>
                  <details>
                    <summary>מצב לפני ואחרי</summary>
                    <pre>
                      {JSON.stringify(
                        {
                          actor: entry.actor,
                          before: entry.before_state,
                          after: entry.after_state
                        },
                        null,
                        2
                      )}
                    </pre>
                  </details>
                </div>
              ))}
              {!data.audit.length && <p>טרם בוצעו התערבויות.</p>}
            </div>
          </article>
        </section>

        {notice && (
          <div
            className="quest-feedback success control-feedback"
            role="status"
          >
            {notice}
          </div>
        )}
        {error && (
          <div
            className="quest-feedback error control-feedback"
            role="alert"
          >
            {error}
          </div>
        )}
      </div>
    </main>
  );
}
