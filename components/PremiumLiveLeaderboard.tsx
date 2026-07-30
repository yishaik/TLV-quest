"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { getBrowserClient } from "@/lib/supabase/browser";

type Entry = {
  team_name: string;
  score: number;
  completed_count: number;
  status: string;
  last_progress_at: string | null;
};

type Experience = {
  run: {
    publicCode: string;
    status: string;
    startedAt: string | null;
    finishedAt: string | null;
    totalCheckpoints: number;
  };
  entries: Entry[];
};

const teamStatus: Record<string, string> = {
  waiting: "ממתינים",
  travelling: "בדרך",
  solving: "פותרים",
  finished: "סיימו",
  disqualified: "נפסלו"
};

export function PremiumLiveLeaderboard({ code }: { code: string }) {
  const [experience, setExperience] = useState<Experience | null>(null);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const response = await fetch(
      `/api/leaderboard/${encodeURIComponent(code)}/experience`,
      { cache: "no-store" }
    );
    const payload = await response.json();
    if (!response.ok || !payload.ok) {
      throw new Error(payload.error?.message ?? "Failed to load leaderboard");
    }
    setExperience(payload.data);
    setError("");
  }, [code]);

  useEffect(() => {
    let active = true;
    void load().catch((errorValue) => {
      if (active) {
        setError(errorValue instanceof Error ? errorValue.message : "Unexpected error");
      }
    });

    const client = getBrowserClient();
    const channel = client
      .channel(`premium-leaderboard:${code}`)
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
      .subscribe((status) => {
        if (!active) return;
        setConnected(status === "SUBSCRIBED");
        if (status === "SUBSCRIBED") void load();
      });

    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") void load();
    };
    const refreshWhenOnline = () => void load();
    document.addEventListener("visibilitychange", refreshWhenVisible);
    window.addEventListener("online", refreshWhenOnline);

    return () => {
      active = false;
      document.removeEventListener("visibilitychange", refreshWhenVisible);
      window.removeEventListener("online", refreshWhenOnline);
      void client.removeChannel(channel);
    };
  }, [code, load]);

  const entries = experience?.entries ?? [];
  const podium = useMemo(() => entries.slice(0, 3), [entries]);
  const total = Math.max(1, experience?.run.totalCheckpoints ?? 1);

  return (
    <main className="race-screen">
      <div className="race-shell">
        <header className="race-header">
          <div>
            <span className="flow-kicker">TLV QUEST · {code}</span>
            <h1>המרוץ החי</h1>
          </div>
          <div className="race-live">
            <i />
            {connected ? "REALTIME CONNECTED" : "RECONNECTING"}
          </div>
        </header>

        {error && (
          <div className="quest-feedback error" style={{ marginTop: 20 }}>
            {error}
          </div>
        )}

        <section className="podium" aria-label="Leading teams">
          {podium.map((entry, index) => (
            <article className="podium-card" key={entry.team_name}>
              <span className="podium-rank">{index + 1}</span>
              <h2>{entry.team_name}</h2>
              <div className="podium-meta">
                <span>
                  {entry.completed_count}/{total} תחנות
                </span>
                <strong className="podium-score">{entry.score} נק׳</strong>
              </div>
            </article>
          ))}
          {!podium.length && (
            <article className="podium-card">
              <span className="podium-rank">•</span>
              <h2>המרוץ יתחיל בקרוב</h2>
              <div className="podium-meta">
                <span>הצוותים יופיעו לאחר ההרשמה</span>
              </div>
            </article>
          )}
        </section>

        <section className="race-table" aria-label="All teams">
          {entries.map((entry, index) => {
            const progress = Math.min(100, (entry.completed_count / total) * 100);
            return (
              <div className="race-row" key={entry.team_name}>
                <span>{String(index + 1).padStart(2, "0")}</span>
                <strong>{entry.team_name}</strong>
                <div>
                  <div className="race-progress-track">
                    <i style={{ width: `${progress}%` }} />
                  </div>
                </div>
                <span>
                  {entry.completed_count}/{total} · {teamStatus[entry.status] ?? entry.status}
                </span>
                <b>{entry.score} נק׳</b>
              </div>
            );
          })}
        </section>

        <footer
          style={{
            display: "flex",
            justifyContent: "space-between",
            gap: 20,
            marginTop: 24,
            color: "rgba(255,255,255,.38)",
            fontSize: ".68rem",
            letterSpacing: ".12em"
          }}
        >
          <span>PRECISE LOCATIONS AND SOLUTIONS ARE HIDDEN</span>
          <span>{experience?.run.status?.toUpperCase() ?? "WAITING"}</span>
        </footer>
      </div>
    </main>
  );
}
