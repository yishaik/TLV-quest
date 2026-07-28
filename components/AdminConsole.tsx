"use client";

import { FormEvent, useEffect, useState } from "react";
import { getBrowserClient } from "@/lib/supabase/browser";

type Health = {
  admin: string;
  checkedAt: string;
  summary: {
    failedMessages: number;
    delayedMessages: number;
    staleTeams: number;
    overdueRetentionRuns: number;
  };
  failedMessages: Array<Record<string, unknown>>;
  staleTeams: Array<Record<string, unknown>>;
  overdueRuns: Array<Record<string, unknown>>;
};

type OrganizerInvite = {
  createUrl: string;
  expiresAt: string;
  externalMessagesEnabled: boolean;
};

export function AdminConsole() {
  const [email, setEmail] = useState("");
  const [sessionToken, setSessionToken] = useState("");
  const [health, setHealth] = useState<Health | null>(null);
  const [invite, setInvite] = useState<OrganizerInvite | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [inviteBusy, setInviteBusy] = useState(false);

  useEffect(() => {
    let active = true;
    let unsubscribe: () => void = () => undefined;

    void Promise.resolve()
      .then(async () => {
        const supabase = getBrowserClient();
        const { data } = await supabase.auth.getSession();
        if (active) setSessionToken(data.session?.access_token ?? "");

        const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
          if (active) setSessionToken(session?.access_token ?? "");
        });
        unsubscribe = () => listener.subscription.unsubscribe();
      })
      .catch((errorValue) => {
        if (active) {
          setError(
            errorValue instanceof Error
              ? errorValue.message
              : "Supabase Auth unavailable"
          );
        }
      });

    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!sessionToken) return;
    let active = true;

    const load = async () => {
      const response = await fetch("/api/admin/health", {
        headers: { authorization: `Bearer ${sessionToken}` },
        cache: "no-store"
      });
      const payload = await response.json();
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error?.message ?? "Admin access failed");
      }
      if (active) setHealth(payload.data);
    };

    void Promise.resolve()
      .then(load)
      .catch((errorValue) => {
        if (active) {
          setError(
            errorValue instanceof Error ? errorValue.message : "Unexpected error"
          );
        }
      });

    return () => {
      active = false;
    };
  }, [sessionToken]);

  async function sendMagicLink(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const supabase = getBrowserClient();
      const { error: authError } = await supabase.auth.signInWithOtp({
        email: email.trim().toLowerCase(),
        options: { emailRedirectTo: `${window.location.origin}/admin` }
      });
      if (authError) throw authError;
      setMessage("קישור כניסה נשלח לאימייל.");
    } catch (errorValue) {
      setError(errorValue instanceof Error ? errorValue.message : "Unexpected error");
    } finally {
      setBusy(false);
    }
  }

  async function createOrganizerInvite() {
    setInviteBusy(true);
    setInvite(null);
    setError("");
    try {
      const response = await fetch("/api/admin/invites", {
        method: "POST",
        headers: {
          authorization: `Bearer ${sessionToken}`,
          "content-type": "application/json"
        },
        body: JSON.stringify({ expiresInHours: 48 })
      });
      const payload = await response.json();
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error?.message ?? "Invite creation failed");
      }
      setInvite(payload.data);
    } catch (errorValue) {
      setError(errorValue instanceof Error ? errorValue.message : "Unexpected error");
    } finally {
      setInviteBusy(false);
    }
  }

  if (!sessionToken) {
    return (
      <main className="site-shell page">
        <span className="badge">Admin</span>
        <h1 className="page-title">כניסה מאובטחת</h1>
        <p className="lead">
          הכניסה מתבצעת באמצעות Magic Link ורשימת מנהלים מאושרת.
        </p>
        <form
          className="card form-grid"
          style={{ marginTop: 32, maxWidth: 600 }}
          onSubmit={sendMagicLink}
        >
          <div className="field">
            <label htmlFor="adminEmail">אימייל מנהל</label>
            <input
              id="adminEmail"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
            />
          </div>
          <button className="button button-primary" disabled={busy}>
            שליחת Magic Link
          </button>
          {message && <div className="success">{message}</div>}
          {error && <div className="error">{error}</div>}
        </form>
      </main>
    );
  }

  return (
    <main className="site-shell page">
      <span className="badge">System health</span>
      <h1 className="page-title">המערכת במבט אחד.</h1>
      <p className="lead">
        מסך פנימי ליצירת משחקים ולזיהוי משחקים תקועים, הודעות שנכשלו ומחיקות שלא
        הושלמו.
      </p>

      <section className="card" style={{ marginTop: 32 }}>
        <span className="badge">הרצה חדשה</span>
        <h2>יצירת קישור חד־פעמי למארגן</h2>
        <p className="muted">
          הקישור תקף ל־48 שעות ומאפשר ליצור הרצת משחק אחת בלבד.
        </p>
        <div className="actions">
          <button
            className="button button-primary"
            onClick={createOrganizerInvite}
            disabled={inviteBusy}
          >
            {inviteBusy ? "יוצר קישור…" : "יצירת הזמנה למשחק"}
          </button>
        </div>

        {invite && (
          <div className="success" style={{ marginTop: 20 }}>
            <strong>ההזמנה מוכנה.</strong>
            <p>
              בתוקף עד {new Date(invite.expiresAt).toLocaleString("he-IL")}.
            </p>
            <div className="actions">
              <a
                className="button button-dark"
                href={invite.createUrl}
                target="_blank"
                rel="noreferrer"
              >
                פתיחת טופס יצירת המשחק
              </a>
              <button
                className="button button-secondary"
                onClick={() => navigator.clipboard.writeText(invite.createUrl)}
              >
                העתקת הקישור
              </button>
            </div>
            {!invite.externalMessagesEnabled && (
              <p className="muted" style={{ marginTop: 12 }}>
                שליחת הודעות יזומות עדיין כבויה במצב הבדיקה.
              </p>
            )}
          </div>
        )}
      </section>

      {health && (
        <>
          <section className="grid grid-3" style={{ marginTop: 32 }}>
            <article className="card metric">
              <span>הודעות שנכשלו</span>
              <strong>{health.summary.failedMessages}</strong>
            </article>
            <article className="card metric">
              <span>קבוצות תקועות</span>
              <strong>{health.summary.staleTeams}</strong>
            </article>
            <article className="card metric">
              <span>מחיקות באיחור</span>
              <strong>{health.summary.overdueRetentionRuns}</strong>
            </article>
          </section>
          <section className="grid grid-2" style={{ marginTop: 20 }}>
            <article className="card">
              <h2>הודעות כושלות</h2>
              <pre className="code">
                {JSON.stringify(health.failedMessages, null, 2)}
              </pre>
            </article>
            <article className="card">
              <h2>קבוצות ללא התקדמות</h2>
              <pre className="code">{JSON.stringify(health.staleTeams, null, 2)}</pre>
            </article>
          </section>
        </>
      )}
      {error && (
        <div className="error" style={{ marginTop: 20 }}>
          {error}
        </div>
      )}
    </main>
  );
}
