"use client";

import { useCallback, useEffect, useState } from "react";
import { getBrowserClient } from "@/lib/supabase/browser";

type Entry = {
  team_name: string;
  score: number;
  completed_count: number;
  status: string;
  last_progress_at: string | null;
};

export function LiveLeaderboard({ code }: { code: string }) {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const response = await fetch(`/api/leaderboard/${encodeURIComponent(code)}`, {
      cache: "no-store"
    });
    const payload = await response.json();
    if (!response.ok || !payload.ok) {
      throw new Error(payload.error?.message ?? "Failed to load leaderboard");
    }
    setEntries(payload.data);
  }, [code]);

  useEffect(() => {
    void load().catch((errorValue) =>
      setError(errorValue instanceof Error ? errorValue.message : "Unexpected error")
    );

    let client: ReturnType<typeof getBrowserClient> | null = null;
    try {
      client = getBrowserClient();
    } catch {
      const interval = window.setInterval(() => void load(), 4000);
      return () => window.clearInterval(interval);
    }

    const channel = client
      .channel(`leaderboard:${code}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "leaderboard_entries",
          filter: `run_public_code=eq.${code}`
        },
        () => void load()
      )
      .subscribe((status) => setConnected(status === "SUBSCRIBED"));

    const fallback = window.setInterval(() => void load(), 15000);
    return () => {
      window.clearInterval(fallback);
      void client?.removeChannel(channel);
    };
  }, [code, load]);

  return (
    <main className="site-shell page">
      <div style={{ display: "flex", justifyContent: "space-between", gap: 16, alignItems: "start", flexWrap: "wrap" }}>
        <div>
          <span className="badge">משחק {code}</span>
          <h1 className="page-title">לוח חי</h1>
          <p className="lead">הדירוג מתעדכן בזמן אמת. התחנה הנוכחית והמיקום המדויק אינם מוצגים.</p>
        </div>
        <span className="badge">{connected ? "Realtime מחובר" : "מתעדכן"}</span>
      </div>

      <section className="card" style={{ marginTop: 32 }}>
        <div className="table-wrap">
          <table className="leaderboard">
            <thead>
              <tr><th>מקום</th><th>קבוצה</th><th>ניקוד</th><th>תחנות</th><th>מצב</th></tr>
            </thead>
            <tbody>
              {entries.map((entry, index) => (
                <tr key={entry.team_name}>
                  <td>{index + 1}</td>
                  <td>{entry.team_name}</td>
                  <td>{entry.score}</td>
                  <td>{entry.completed_count}/3</td>
                  <td>{entry.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!entries.length && !error && <p className="muted">הלוח יתמלא לאחר יצירת הקבוצות.</p>}
        {error && <div className="error">{error}</div>}
      </section>
    </main>
  );
}
