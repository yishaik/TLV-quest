"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";

type OrganizerData = {
  run: {
    public_code: string;
    status: string;
    scheduled_at: string | null;
    max_participants: number;
  };
  teams: Array<{
    id: string;
    public_name: string;
    status: string;
    score: number;
    completed_count: number;
    last_progress_at: string | null;
  }>;
  participants: Array<{
    id: string;
    team_id: string | null;
    public_alias: string | null;
    language: string;
    whatsapp_connected_at: string | null;
  }>;
  checkpoints: Array<{
    slug: string;
    sequence_no: number;
    kind: string;
    is_disabled: boolean;
  }>;
  delivery: {
    queued: number;
    processing: number;
    sent: number;
    delivered: number;
    failed: number;
  };
  joinUrl: string;
  liveUrl: string;
};

export function OrganizerDashboard({ token }: { token: string }) {
  const [data, setData] = useState<OrganizerData | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const refresh = useCallback(async () => {
    const response = await fetch(`/api/organizer/${encodeURIComponent(token)}`, {
      cache: "no-store"
    });
    const payload = await response.json();
    if (!response.ok || !payload.ok) {
      throw new Error(payload.error?.message ?? "Failed to load game");
    }
    setData(payload.data);
  }, [token]);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      try {
        await refresh();
      } catch (errorValue) {
        if (!cancelled) {
          setError(errorValue instanceof Error ? errorValue.message : "Unexpected error");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void run();
    const interval = window.setInterval(run, 5000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [refresh]);

  async function control(
    action: string,
    extra: Record<string, unknown> = {}
  ): Promise<Record<string, unknown> | null> {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch(
        `/api/organizer/${encodeURIComponent(token)}/control`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action, ...extra })
        }
      );
      const payload = await response.json();
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error?.message ?? "Action failed");
      }
      const result = payload.data as Record<string, unknown>;
      const delivery =
        result.delivery &&
        typeof result.delivery === "object" &&
        !Array.isArray(result.delivery)
          ? (result.delivery as Record<string, unknown>)
          : null;
      if (action === "broadcast" && delivery) {
        setNotice(
          `ההודעה נכנסה לתור עבור ${Number(delivery.queued ?? 0)} משתתפים. הסטטוס יתעדכן אוטומטית.`
        );
      } else {
        setNotice("הפעולה בוצעה.");
      }
      await refresh();
      return result;
    } catch (errorValue) {
      setError(errorValue instanceof Error ? errorValue.message : "Unexpected error");
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function start() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/organizer/${encodeURIComponent(token)}/start`, {
        method: "POST"
      });
      const payload = await response.json();
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error?.message ?? "Start failed");
      }
      setNotice("המשחק התחיל.");
      await refresh();
    } catch (errorValue) {
      setError(errorValue instanceof Error ? errorValue.message : "Unexpected error");
    } finally {
      setBusy(false);
    }
  }

  async function broadcast(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const message = String(form.get("message") ?? "").trim();
    if (!message) return;
    const result = await control("broadcast", { message });
    if (result) formElement.reset();
  }

  if (loading) {
    return <main className="site-shell page"><div className="card">טוען חדר בקרה…</div></main>;
  }
  if (!data) {
    return <main className="site-shell page"><div className="error">{error || "המשחק לא נמצא"}</div></main>;
  }

  const connected = data.participants.filter((participant) => participant.whatsapp_connected_at).length;

  return (
    <main className="site-shell page">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start", gap: 18, flexWrap: "wrap" }}>
        <div>
          <span className="badge">חדר בקרה · {data.run.public_code}</span>
          <h1 className="page-title">המשחק מנהל את עצמו.</h1>
          <p className="lead">כאן נמצאים רק סטטוס וכפתורי חירום. אין צורך להפעיל ידנית תחנות או לאשר תשובות.</p>
        </div>
        <span className="badge">{data.run.status}</span>
      </div>

      <section className="grid grid-3" style={{ marginTop: 32 }}>
        <article className="card metric">
          <span>משתתפים</span>
          <strong>{data.participants.length}/{data.run.max_participants}</strong>
        </article>
        <article className="card metric">
          <span>WhatsApp מחובר</span>
          <strong>{connected}</strong>
        </article>
        <article className="card metric">
          <span>קבוצות</span>
          <strong>{data.teams.length}</strong>
        </article>
      </section>

      <section className="grid grid-2" style={{ marginTop: 20 }}>
        <article className="card">
          <h2>קישורים</h2>
          <p className="field-label">הרשמה</p>
          <div className="code">{data.joinUrl}</div>
          <p className="field-label">לוח חי</p>
          <div className="code">{data.liveUrl}</div>
          <div className="actions">
            <a className="button button-secondary" href={data.joinUrl} target="_blank" rel="noreferrer">פתיחת הרשמה</a>
            <a className="button button-secondary" href={data.liveUrl} target="_blank" rel="noreferrer">פתיחת לוח</a>
          </div>
        </article>

        <article className="card">
          <h2>כפתורי חירום</h2>
          <div className="actions">
            {["draft", "registration_open", "ready", "paused"].includes(data.run.status) && (
              <button className="button button-primary" disabled={busy} onClick={start}>התחלת משחק</button>
            )}
            {data.run.status === "active" && (
              <button className="button button-secondary" disabled={busy} onClick={() => control("pause")}>עצירה זמנית</button>
            )}
            {data.run.status === "paused" && (
              <button className="button button-primary" disabled={busy} onClick={() => control("resume")}>המשך</button>
            )}
            {data.run.status === "active" && (
              <button className="button button-secondary" disabled={busy} onClick={() => control("skip")}>דילוג על התחנה הנוכחית</button>
            )}
            {!['finished','cancelled'].includes(data.run.status) && (
              <button className="button button-danger" disabled={busy} onClick={() => control("end")}>סיום מוקדם</button>
            )}
          </div>
        </article>
      </section>

      <section className="card" style={{ marginTop: 20 }}>
        <h2>שליחת הודעה לכל המשתתפים</h2>
        <form className="form-grid" onSubmit={broadcast}>
          <div className="field">
            <label htmlFor="message">הודעה</label>
            <textarea id="message" name="message" maxLength={800} />
          </div>
          <button className="button button-dark" disabled={busy}>שליחה דרך ה־outbox</button>
        </form>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(110px, 1fr))",
            gap: 10,
            marginTop: 18
          }}
          aria-label="סטטוס משלוחי הודעות"
        >
          {[
            ["בתור", data.delivery.queued],
            ["בעיבוד", data.delivery.processing],
            ["נשלחו", data.delivery.sent],
            ["נמסרו", data.delivery.delivered],
            ["נכשלו", data.delivery.failed]
          ].map(([label, value]) => (
            <div className="metric" key={String(label)}>
              <span>{label}</span>
              <strong>{value}</strong>
            </div>
          ))}
        </div>
      </section>

      <section className="card" style={{ marginTop: 20 }}>
        <h2>קבוצות</h2>
        <div className="table-wrap">
          <table className="leaderboard">
            <thead>
              <tr><th>קבוצה</th><th>מצב</th><th>תחנות</th><th>ניקוד</th><th>תיקון</th></tr>
            </thead>
            <tbody>
              {data.teams.map((team) => (
                <tr key={team.id}>
                  <td>{team.public_name}</td>
                  <td>{team.status}</td>
                  <td>{team.completed_count}/3</td>
                  <td>{team.score}</td>
                  <td>
                    <button className="button button-secondary" disabled={busy} onClick={() => control("score", { teamId: team.id, delta: 10 })}>+10</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {notice && <div className="success" style={{ marginTop: 18 }}>{notice}</div>}
      {error && <div className="error" style={{ marginTop: 18 }}>{error}</div>}
    </main>
  );
}
