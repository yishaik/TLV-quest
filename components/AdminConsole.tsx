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

export function AdminConsole() {
  const [email, setEmail] = useState("");
  const [sessionToken, setSessionToken] = useState("");
  const [health, setHealth] = useState<Health | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    try {
      const supabase = getBrowserClient();
      void supabase.auth.getSession().then(({ data }) => {
        setSessionToken(data.session?.access_token ?? "");
      });
      const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
        setSessionToken(session?.access_token ?? "");
      });
      return () => listener.subscription.unsubscribe();
    } catch (errorValue) {
      setError(errorValue instanceof Error ? errorValue.message : "Supabase Auth unavailable");
    }
  }, []);

  useEffect(() => {
    if (!sessionToken) return;
    const load = async () => {
      const response = await fetch("/api/admin/health", {
        headers: { authorization: `Bearer ${sessionToken}` },
        cache: "no-store"
      });
      const payload = await response.json();
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error?.message ?? "Admin access failed");
      }
      setHealth(payload.data);
    };
    void load().catch((errorValue) =>
      setError(errorValue instanceof Error ? errorValue.message : "Unexpected error")
    );
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

  if (!sessionToken) {
    return (
      <main className="site-shell page">
        <span className="badge">Admin</span>
        <h1 className="page-title">כניסה מאובטחת</h1>
        <p className="lead">הכניסה מתבצעת באמצעות Magic Link ורשימת מנהלים מאושרת.</p>
        <form className="card form-grid" style={{ marginTop: 32, maxWidth: 600 }} onSubmit={sendMagicLink}>
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
          <button className="button button-primary" disabled={busy}>שליחת Magic Link</button>
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
      <p className="lead">מסך פנימי לזיהוי משחקים תקועים, הודעות שנכשלו ומחיקות שלא הושלמו.</p>

      {health && (
        <>
          <section className="grid grid-3" style={{ marginTop: 32 }}>
            <article className="card metric"><span>הודעות שנכשלו</span><strong>{health.summary.failedMessages}</strong></article>
            <article className="card metric"><span>קבוצות תקועות</span><strong>{health.summary.staleTeams}</strong></article>
            <article className="card metric"><span>מחיקות באיחור</span><strong>{health.summary.overdueRetentionRuns}</strong></article>
          </section>
          <section className="grid grid-2" style={{ marginTop: 20 }}>
            <article className="card">
              <h2>הודעות כושלות</h2>
              <pre className="code">{JSON.stringify(health.failedMessages, null, 2)}</pre>
            </article>
            <article className="card">
              <h2>קבוצות ללא התקדמות</h2>
              <pre className="code">{JSON.stringify(health.staleTeams, null, 2)}</pre>
            </article>
          </section>
        </>
      )}
      {error && <div className="error" style={{ marginTop: 20 }}>{error}</div>}
    </main>
  );
}
