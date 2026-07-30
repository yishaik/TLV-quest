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
import type { RealtimeChannel } from "@supabase/supabase-js";
import { getQuestRealtimeClient } from "@/lib/supabase/quest-realtime-browser";
import type {
  QuestConnectionState,
  QuestLeaderboardEntry,
  QuestParticipantState,
  QuestPresenceMember
} from "@/lib/quest-realtime-types";

const AUTH_RENEWAL_MARGIN_MS = 5 * 60 * 1000;
const STALE_AFTER_MS = 30 * 1000;

type RealtimeAccess = {
  accessToken: string;
  expiresAt: number;
  participantId: string;
};

type PresencePayload = {
  participantId?: string;
  firstName?: string;
  deviceId?: string;
  visible?: boolean;
  onlineAt?: string;
};

type QuestRealtimeContextValue = {
  state: QuestParticipantState | null;
  leaderboard: QuestLeaderboardEntry[];
  presence: QuestPresenceMember[];
  connected: boolean;
  connectionState: QuestConnectionState;
  loading: boolean;
  error: string;
  lastSyncedAt: number | null;
  refresh: () => Promise<void>;
};

const QuestRealtimeContext = createContext<QuestRealtimeContextValue | null>(null);

const getDeviceId = () => {
  const key = "tlvQuestRealtimeDeviceId";
  const existing = localStorage.getItem(key);
  if (existing) return existing;
  const created = crypto.randomUUID();
  localStorage.setItem(key, created);
  return created;
};

const normalizePresence = (
  rawState: Record<string, PresencePayload[]>
): QuestPresenceMember[] => {
  const participants = new Map<string, QuestPresenceMember>();

  for (const entries of Object.values(rawState)) {
    for (const entry of entries) {
      if (!entry.participantId || !entry.firstName) continue;
      const current = participants.get(entry.participantId);
      const onlineAt = entry.onlineAt ?? null;
      participants.set(entry.participantId, {
        participantId: entry.participantId,
        firstName: entry.firstName,
        deviceCount: (current?.deviceCount ?? 0) + 1,
        visible: Boolean(current?.visible || entry.visible),
        onlineAt:
          !current?.onlineAt || (onlineAt && onlineAt > current.onlineAt)
            ? onlineAt
            : current.onlineAt
      });
    }
  }

  return [...participants.values()].sort((a, b) =>
    a.firstName.localeCompare(b.firstName, "he")
  );
};

export function QuestRealtimeProvider({
  token,
  children
}: {
  token: string;
  children: ReactNode;
}) {
  const [state, setState] = useState<QuestParticipantState | null>(null);
  const [leaderboard, setLeaderboard] = useState<QuestLeaderboardEntry[]>([]);
  const [presence, setPresence] = useState<QuestPresenceMember[]>([]);
  const [connected, setConnected] = useState(false);
  const [connectionState, setConnectionState] =
    useState<QuestConnectionState>("connecting");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [lastSyncedAt, setLastSyncedAt] = useState<number | null>(null);
  const [authExpiresAt, setAuthExpiresAt] = useState<number | null>(null);
  const stateRefreshTimer = useRef<number | undefined>(undefined);
  const boardRefreshTimer = useRef<number | undefined>(undefined);
  const staleTimer = useRef<number | undefined>(undefined);
  const stateRequest = useRef<Promise<QuestParticipantState> | null>(null);
  const boardRequest = useRef<Promise<void> | null>(null);
  const authRequest = useRef<Promise<RealtimeAccess> | null>(null);
  const accessRef = useRef<RealtimeAccess | null>(null);
  const connectedRef = useRef(false);

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

  const scheduleStaleState = useCallback(() => {
    window.clearTimeout(staleTimer.current);
    staleTimer.current = window.setTimeout(() => {
      if (!connectedRef.current && navigator.onLine) setConnectionState("stale");
    }, STALE_AFTER_MS);
  }, []);

  const issueRealtimeAccess = useCallback(
    async (force = false): Promise<RealtimeAccess> => {
      const current = accessRef.current;
      if (
        !force &&
        current &&
        current.expiresAt - Date.now() > AUTH_RENEWAL_MARGIN_MS
      ) {
        return current;
      }
      if (authRequest.current) return authRequest.current;

      const request = (async () => {
        const response = await fetch(
          `/api/participants/${encodeURIComponent(token)}/realtime-auth`,
          { method: "POST", cache: "no-store" }
        );
        const payload = await response.json();
        if (!response.ok || !payload.ok) {
          throw new Error(payload.error?.message ?? "Realtime authentication failed");
        }

        const access = payload.data as RealtimeAccess;
        const client = getQuestRealtimeClient();
        await client.realtime.setAuth(access.accessToken);
        accessRef.current = access;
        setAuthExpiresAt(access.expiresAt);
        return access;
      })();

      authRequest.current = request;
      try {
        return await request;
      } finally {
        authRequest.current = null;
      }
    },
    [token]
  );

  useEffect(() => {
    if (!authExpiresAt) return;
    const renewalDelay = Math.max(
      10_000,
      authExpiresAt - Date.now() - AUTH_RENEWAL_MARGIN_MS
    );
    const timer = window.setTimeout(() => {
      accessRef.current = null;
      void issueRealtimeAccess(true).catch((cause) => {
        setError(
          cause instanceof Error ? cause.message : "Realtime authentication failed"
        );
      });
    }, renewalDelay);
    return () => window.clearTimeout(timer);
  }, [authExpiresAt, issueRealtimeAccess]);

  useEffect(() => {
    localStorage.setItem("tlvQuestParticipantToken", token);
    const initialRefresh = window.setTimeout(() => void refresh(), 0);

    const onVisibility = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    const onOnline = () => {
      setConnectionState("reconnecting");
      void refresh();
    };
    const onOffline = () => {
      connectedRef.current = false;
      setConnected(false);
      setConnectionState("offline");
    };

    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.clearTimeout(initialRefresh);
      window.clearTimeout(stateRefreshTimer.current);
      window.clearTimeout(boardRefreshTimer.current);
      window.clearTimeout(staleTimer.current);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, [refresh, token]);

  const teamTopic = state?.realtime.teamTopic;
  const runTopic = state?.realtime.runTopic;
  const runCode = state?.run.publicCode;
  const participantId = state?.participant.id;
  const participantName = state?.participant.firstName;

  useEffect(() => {
    if (!teamTopic || !runTopic || !runCode || !participantId || !participantName) {
      return;
    }

    let active = true;
    const client = getQuestRealtimeClient();
    const deviceId = getDeviceId();
    const statuses = new Map<string, boolean>();
    let teamChannel: RealtimeChannel | null = null;
    let runChannel: RealtimeChannel | null = null;
    let boardChannel: RealtimeChannel | null = null;

    const updateStatus = (name: string, status: string) => {
      if (!active) return;
      statuses.set(name, status === "SUBSCRIBED");
      const allConnected =
        statuses.get("team") === true &&
        statuses.get("run") === true &&
        statuses.get("board") === true;
      connectedRef.current = allConnected;
      setConnected(allConnected);

      if (allConnected) {
        window.clearTimeout(staleTimer.current);
        setConnectionState("live");
      } else if (!navigator.onLine) {
        setConnectionState("offline");
      } else {
        setConnectionState("reconnecting");
        scheduleStaleState();
      }

      if (status === "SUBSCRIBED") scheduleStateRefresh();
    };

    const trackPresence = () => {
      if (!teamChannel) return;
      void teamChannel.track({
        participantId,
        firstName: participantName,
        deviceId,
        visible: document.visibilityState === "visible",
        onlineAt: new Date().toISOString()
      });
    };

    const onVisibility = () => trackPresence();

    const connect = async () => {
      await issueRealtimeAccess();
      if (!active) return;

      teamChannel = client
        .channel(teamTopic, {
          config: {
            private: true,
            presence: { key: deviceId }
          }
        })
        .on("broadcast", { event: "state_changed" }, scheduleStateRefresh)
        .on("presence", { event: "sync" }, () => {
          if (!teamChannel || !active) return;
          const raw = teamChannel.presenceState() as Record<
            string,
            PresencePayload[]
          >;
          setPresence(normalizePresence(raw));
        })
        .subscribe((status) => {
          updateStatus("team", status);
          if (status === "SUBSCRIBED") trackPresence();
        });

      runChannel = client
        .channel(runTopic, { config: { private: true } })
        .on("broadcast", { event: "state_changed" }, scheduleStateRefresh)
        .subscribe((status) => updateStatus("run", status));

      boardChannel = client
        .channel(`quest-board:${runCode}`)
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "leaderboard_entries",
            filter: `run_public_code=eq.${runCode}`
          },
          () => scheduleBoardRefresh(runCode)
        )
        .subscribe((status) => updateStatus("board", status));

      document.addEventListener("visibilitychange", onVisibility);
    };

    void connect().catch((cause) => {
      if (!active) return;
      setError(cause instanceof Error ? cause.message : "Realtime connection failed");
      setConnectionState(navigator.onLine ? "reconnecting" : "offline");
      scheduleStaleState();
    });

    return () => {
      active = false;
      document.removeEventListener("visibilitychange", onVisibility);
      if (teamChannel) void client.removeChannel(teamChannel);
      if (runChannel) void client.removeChannel(runChannel);
      if (boardChannel) void client.removeChannel(boardChannel);
    };
  }, [
    issueRealtimeAccess,
    participantId,
    participantName,
    runCode,
    runTopic,
    scheduleBoardRefresh,
    scheduleStateRefresh,
    scheduleStaleState,
    teamTopic
  ]);

  const value = useMemo<QuestRealtimeContextValue>(
    () => ({
      state,
      leaderboard,
      presence,
      connected,
      connectionState,
      loading,
      error,
      lastSyncedAt,
      refresh
    }),
    [
      connected,
      connectionState,
      error,
      lastSyncedAt,
      leaderboard,
      loading,
      presence,
      refresh,
      state
    ]
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
