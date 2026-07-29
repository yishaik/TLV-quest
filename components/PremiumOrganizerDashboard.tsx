"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";

type OrganizerData = {
  run: { public_code: string; status: string; scheduled_at: string | null; max_participants: number };
  teams: Array<{ id: string; public_name: string; status: string; score: number; completed_count: number; last_progress_at: string | null }>;
  participants: Array<{ id: string; team_id: string | null; public_alias: string | null; language: string; whatsapp_connected_at: string | null }>;
  checkpoints: Array<{ slug: string; sequence_no: number; kind: string; is_disabled: boolean }>;
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
  cancelled: "בוטל"
};

export function PremiumOrganizerDashboard({ token }: { token: string }) {
  const [data, setData] = useState<OrganizerData | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [copied, setCopied] = useState("");

  const refresh = useCallback(async () => {
    const response = await fetch(`/api/organizer/${encodeURIComponent(token)}`, { cache: "no-store" });
    const payload = await response.json();
    if (!response.ok || !payload.ok) throw new Error(payload.error?.message ?? "Failed to load game");
    setData(payload.data);
  }, [token]);

  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;
    const run = async () => {
      if (document.visibilityState === "hidden") return;
      try { await refresh(); }
      catch (errorValue) { if (!cancelled) setError(errorValue instanceof Error ? errorValue.message : "Unexpected error"); }
      finally { if (!cancelled) setLoading(false); }
    };
    const start = () => { void run(); window.clearInterval(timer); timer = window.setInterval(run, 7000); };
    const onVisibility = () => { if (document.visibilityState === "visible") start(); };
    start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => { cancelled = true; window.clearInterval(timer); document.removeEventListener("visibilitychange", onVisibility); };
  }, [refresh]);

  async function control(action: string, extra: Record<string, unknown> = {}) {
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch(`/api/organizer/${encodeURIComponent(token)}/control`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action, ...extra })
      });
      const payload = await response.json();
      if (!response.ok || !payload.ok) throw new Error(payload.error?.message ?? "Action failed");
      setNotice("הפעולה בוצעה והמערכת התעדכנה.");
      await refresh();
    } catch (errorValue) { setError(errorValue instanceof Error ? errorValue.message : "Unexpected error"); }
    finally { setBusy(false); }
  }

  async function start() {
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch(`/api/organizer/${encodeURIComponent(token)}/start`, { method: "POST" });
      const payload = await response.json();
      if (!response.ok || !payload.ok) throw new Error(payload.error?.message ?? "Start failed");
      setNotice("האות שודר. המסע התחיל.");
      await refresh();
    } catch (errorValue) { setError(errorValue instanceof Error ? errorValue.message : "Unexpected error"); }
    finally { setBusy(false); }
  }

  async function broadcast(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const message = String(form.get("message") ?? "").trim();
    if (!message) return;
    await control("broadcast", { message });
    event.currentTarget.reset();
  }

  async function copy(name: string, value: string) {
    await navigator.clipboard.writeText(value);
    setCopied(name);
    window.setTimeout(() => setCopied(""), 1600);
  }

  const activeCheckpoints = useMemo(() => data?.checkpoints.filter((checkpoint) => !checkpoint.is_disabled).length ?? 0, [data]);

  if (loading) return <main className="control-room"><div className="control-shell"><div className="quest-loading"><img src="/visuals/quest-mark.svg" alt="" /><span>מחבר את חדר הבקרה…</span></div></div></main>;
  if (!data) return <main className="control-room"><div className="control-shell"><div className="flow-error">{error || "ההרצה לא נמצאה"}</div></div></main>;

  const connected = data.participants.filter((participant) => participant.whatsapp_connected_at).length;
  const finished = data.teams.filter((team) => team.status === "finished").length;
  const canStart = ["draft", "registration_open", "ready", "paused"].includes(data.run.status);

  return (
    <main className="control-room">
      <div className="control-shell">
        <header className="control-header">
          <div>
            <span className="flow-kicker">Autonomous control room · {data.run.public_code}</span>
            <h1>המסע מנהל את עצמו.</h1>
            <p>כאן רואים את התמונה המלאה ומתערבים רק כשצריך. הרשמה, חלוקת קבוצות, אימותים, ניקוד והתקדמות מתנהלים אוטומטית.</p>
          </div>
          <div className="status-orb">{statusLabel[data.run.status] ?? data.run.status}</div>
        </header>

        <section className="control-metrics">
          <article><span>משתתפים</span><strong>{data.participants.length}/{data.run.max_participants}</strong></article>
          <article><span>WhatsApp מחובר</span><strong>{connected}</strong></article>
          <article><span>צוותים במסלול</span><strong>{data.teams.length}</strong></article>
          <article><span>השלימו</span><strong>{finished}/{data.teams.length || 0}</strong></article>
        </section>

        <section className="control-grid">
          <article className="control-panel">
            <span className="flow-kicker">SHARE PACK</span><h2>קישורים להרצה</h2>
            <p>קישור ההרשמה מיועד למשתתפים. מסך המרוץ יכול להיפתח על טלוויזיה או מקרן.</p>
            <div className="share-row"><code>{data.joinUrl}</code><button className="button button-secondary" onClick={() => copy("join", data.joinUrl)}>{copied === "join" ? "הועתק" : "העתקה"}</button></div>
            <div className="share-row"><code>{data.liveUrl}</code><button className="button button-secondary" onClick={() => copy("live", data.liveUrl)}>{copied === "live" ? "הועתק" : "העתקה"}</button></div>
            <div className="emergency-actions" style={{ marginTop: 16 }}>
              <a className="button button-primary" href={data.joinUrl} target="_blank" rel="noreferrer">פתיחת הרשמה</a>
              <a className="button button-secondary" href={data.liveUrl} target="_blank" rel="noreferrer">פתיחת מסך מרוץ</a>
            </div>
          </article>

          <article className="control-panel">
            <span className="flow-kicker">EMERGENCY OVERRIDE</span><h2>בקרה והתערבות</h2>
            <p>פעולות אלו משפיעות מיד על כל המשתתפים. השתמשו בהן רק כשנדרש.</p>
            <div className="emergency-actions">
              {canStart && data.run.status !== "active" && <button className="button button-primary" disabled={busy} onClick={start}>{data.run.status === "paused" ? "חידוש באמצעות זינוק" : "שידור אות הזינוק"}</button>}
              {data.run.status === "active" && <button className="button button-secondary" disabled={busy} onClick={() => control("pause")}>השהיית המסע</button>}
              {data.run.status === "paused" && <button className="button button-primary" disabled={busy} onClick={() => control("resume")}>המשך המסע</button>}
              {data.run.status === "active" && <button className="button button-secondary" disabled={busy} onClick={() => control("skip")}>דילוג תחנה</button>}
              {!['finished','cancelled'].includes(data.run.status) && <button className="button button-danger" disabled={busy} onClick={() => control("end")}>סיום מוקדם</button>}
            </div>
          </article>
        </section>

        <section className="control-grid">
          <article className="control-panel">
            <span className="flow-kicker">BROADCAST</span><h2>הודעה לכל המשתתפים</h2>
            <form className="broadcast-form" onSubmit={broadcast}>
              <textarea name="message" maxLength={800} placeholder="כתבו הודעה קצרה וברורה…" />
              <button className="button button-primary" disabled={busy}>שליחה דרך ערוץ ההודעות</button>
            </form>
          </article>
          <article className="control-panel">
            <span className="flow-kicker">ROUTE STATUS</span><h2>מצב המסלול</h2>
            <p>{activeCheckpoints} תחנות פעילות · {data.participants.length} משתתפים · {data.teams.length} צוותים</p>
            <div className="wizard-summary">
              <div><span>סטטוס</span><strong>{statusLabel[data.run.status] ?? data.run.status}</strong></div>
              <div><span>מועד</span><strong>{data.run.scheduled_at ? new Date(data.run.scheduled_at).toLocaleString("he-IL") : "התחלה ידנית"}</strong></div>
              <div><span>עדכון</span><strong>אוטומטי</strong></div>
            </div>
          </article>
        </section>

        <section className="control-panel" style={{ marginTop: 18 }}>
          <span className="flow-kicker">TEAM TELEMETRY</span><h2>התקדמות הצוותים</h2>
          <div className="team-control-list">
            {data.teams.map((team) => (
              <div className="team-control-row" key={team.id}>
                <strong>{team.public_name}</strong>
                <span>{statusLabel[team.status] ?? team.status}</span>
                <span>{team.completed_count}/{activeCheckpoints}</span>
                <span>{team.score} נק׳</span>
                <button className="button button-secondary" disabled={busy} onClick={() => control("score", { teamId: team.id, delta: 10 })}>+10</button>
              </div>
            ))}
            {!data.teams.length && <div className="team-control-row"><strong>הצוותים יופיעו לאחר ההרשמה</strong></div>}
          </div>
        </section>

        {notice && <div className="quest-feedback success" style={{ marginTop: 18 }}>{notice}</div>}
        {error && <div className="quest-feedback error" style={{ marginTop: 18 }} role="alert">{error}</div>}
      </div>
    </main>
  );
}
