"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from "react";
import { getBrowserClient } from "@/lib/supabase/browser";
import type {
  QuestLeaderboardEntry,
  QuestParticipantState
} from "@/lib/quest-realtime-types";

type QuestRealtimeContextValue = {
  state: QuestParticipantState | null;
  leaderboard: QuestLeaderboardEntry[];
  connected: boolean;
  loading: boolean;
  error: string;
  lastSyncedAt: number | null;
  refresh: () => Promise<void>;
};

const QuestRealtimeContext = createContext<QuestRealtimeContextValue | null>(null);

export function QuestRealtimeProvider({
  token,
  children
}: {
  token: string;
  children: ReactNode;
}) {
  const [state, setState] = useState<QuestParticipantState | null>(null);
  const [leaderboard, setLeaderboard] = useState<QuestLeaderboardEntry[]>([]);
  const [connected, setConnected] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [lastSyncedAt, setLastSyncedAt] = useState<number | null>(null);
  const stateRefreshTimer = useRef<number | undefined>(undefined);
  const boardRefreshTimer = useRef<number | undefined>(undefined);
  const stateRequest = useRef<Promise<QuestParticipantState> | null>(null);
  const boardRequest = useRef<Promise<void> | null>(null);

  const loadState = useCallback(async () => {
    if (stateRequest.current) return stateRequest.current;

    const request = (async () => {
      const response = await fetch(
        `/api/participants/${encodeURIComponent(token)}/state`,
        { cache: "no-store" }
      );
      const payload = await response.json();
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error?.message ?? "Failed to load game");
      }
      const next = payload.data as QuestParticipantState;
      setState(next);
      setLastSyncedAt(Date.now());
      return next;
    })();

    stateRequest.current = request;
    try {
      return await request;
    } finally {
      stateRequest.current = null;
    }
  }, [token]);

  const loadBoard = useCallback(async (code: string) => {
    if (boardRequest.current) return boardRequest.current;

    const request = (async () => {
      const response = await fetch(`/api/leaderboard/${encodeURIComponent(code)}`, {
        cache: "no-store"
      });
      const payload = await response.json();
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error?.message ?? "Failed to load leaderboard");
      }
      setLeaderboard(payload.data as QuestLeaderboardEntry[]);
    })();

    boardRequest.current = request;
    try {
      await request;
    } finally {
      boardRequest.current = null;
    }
  }, []);

  const refresh = useCallback(async () => {
    try {
      const next = await loadState();
      await loadBoard(next.run.publicCode);
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unexpected error");
    } finally {
      setLoading(false);
    }
  }, [loadBoard, loadState]);

  const scheduleStateRefresh = useCallback(() => {
    window.clearTimeout(stateRefreshTimer.current);
    stateRefreshTimer.current = window.setTimeout(() => {
      void refresh();
    }, 90);
  }, [refresh]);

  const scheduleBoardRefresh = useCallback(
    (code: string) => {
      window.clearTimeout(boardRefreshTimer.current);
      boardRefreshTimer.current = window.setTimeout(() => {
        void loadBoard(code).catch((cause) => {
          setError(cause instanceof Error ? cause.message : "Unexpected error");
        });
      }, 90);
    },
    [loadBoard]
  );

  useEffect(() => {
    localStorage.setItem("tlvQuestParticipantToken", token);
    void refresh();

    const onVisibility = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    const onOnline = () => void refresh();

    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("online", onOnline);
    return () => {
      window.clearTimeout(stateRefreshTimer.current);
      window.clearTimeout(boardRefreshTimer.current);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("online", onOnline);
    };
  }, [refresh, token]);

  useEffect(() => {
    const teamTopic = state?.realtime.teamTopic;
    const runTopic = state?.realtime.runTopic;
    const code = state?.run.publicCode;
    if (!teamTopic || !runTopic || !code) return;

    const client = getBrowserClient();

    const statuses = new Map<string, boolean>();
    const updateStatus = (name: string, status: string) => {
      statuses.set(name, status === "SUBSCRIBED");
      setConnected(
        statuses.get("team") === true &&
          statuses.get("run") === true &&
          statuses.get("board") === true
      );
      if (status === "SUBSCRIBED") scheduleStateRefresh();
    };

    const teamChannel = client
      .channel(teamTopic)
      .on("broadcast", { event: "state_changed" }, scheduleStateRefresh)
      .subscribe((status) => updateStatus("team", status));

    const runChannel = client
      .channel(runTopic)
      .on("broadcast", { event: "state_changed" }, scheduleStateRefresh)
      .subscribe((status) => updateStatus("run", status));

    const boardChannel = client
      .channel(`quest-board:${code}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "leaderboard_entries",
          filter: `run_public_code=eq.${code}`
        },
        () => scheduleBoardRefresh(code)
      )
      .subscribe((status) => updateStatus("board", status));

    return () => {
      void client.removeChannel(teamChannel);
      void client.removeChannel(runChannel);
      void client.removeChannel(boardChannel);
    };
  }, [
    scheduleBoardRefresh,
    scheduleStateRefresh,
    state?.realtime.runTopic,
    state?.realtime.teamTopic,
    state?.run.publicCode
  ]);

  const value = useMemo<QuestRealtimeContextValue>(
    () => ({
      state,
      leaderboard,
      connected,
      loading,
      error,
      lastSyncedAt,
      refresh
    }),
    [connected, error, lastSyncedAt, leaderboard, loading, refresh, state]
  );

  return (
    <QuestRealtimeContext.Provider value={value}>
      {children}
    </QuestRealtimeContext.Provider>
  );
}

export function useQuestRealtime() {
  const context = useContext(QuestRealtimeContext);
  if (!context) {
    throw new Error("useQuestRealtime must be used inside QuestRealtimeProvider");
  }
  return context;
}
