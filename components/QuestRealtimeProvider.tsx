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
import type {
  RealtimeChannel,
  RealtimePostgresChangesPayload
} from "@supabase/supabase-js";
import { publicEnv } from "@/lib/env";
import { getQuestRealtimeClient } from "@/lib/supabase/quest-realtime-browser";
import type {
  QuestConnectionState,
  QuestLeaderboardEntry,
  QuestParticipantState,
  QuestPresenceDevice,
  QuestPresenceMember
} from "@/lib/quest-realtime-types";

const AUTH_RENEWAL_MARGIN_MS = 5 * 60 * 1000;
const STALE_AFTER_MS = 30 * 1000;
const PRESENCE_HEARTBEAT_MS = 25 * 1000;
const PRESENCE_TTL_MS = 70 * 1000;
const PRESENCE_CLOCK_MS = 5 * 1000;

type RealtimeAccess = {
  accessToken: string;
  expiresAt: number;
  participantId: string;
};

type PresenceRow = {
  participant_id: string;
  device_id: string;
  visible: boolean;
  online_at: string;
  expires_at: string;
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

const deviceKey = (device: QuestPresenceDevice) =>
  `${device.participantId}:${device.deviceId}`;

const presenceFromRow = (row: PresenceRow): QuestPresenceDevice => ({
  participantId: row.participant_id,
  deviceId: row.device_id,
  visible: row.visible,
  onlineAt: row.online_at,
  expiresAt: row.expires_at
});

const groupPresence = (
  devices: QuestPresenceDevice[],
  members: QuestParticipantState["members"],
  now: number
): QuestPresenceMember[] => {
  const names = new Map(members.map((member) => [member.id, member.firstName]));
  const participants = new Map<string, QuestPresenceMember>();

  for (const device of devices) {
    if (new Date(device.expiresAt).getTime() <= now) continue;
    const firstName = names.get(device.participantId);
    if (!firstName) continue;
    const current = participants.get(device.participantId);
    participants.set(device.participantId, {
      participantId: device.participantId,
      firstName,
      deviceCount: (current?.deviceCount ?? 0) + 1,
      visible: Boolean(current?.visible || device.visible),
      onlineAt:
        !current?.onlineAt || device.onlineAt > current.onlineAt
          ? device.onlineAt
          : current.onlineAt
    });
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
  const [presenceDevices, setPresenceDevices] = useState<QuestPresenceDevice[]>([]);
  const [presenceNow, setPresenceNow] = useState(() => Date.now());
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
  const heartbeatTimer = useRef<number | undefined>(undefined);
  const presenceClockTimer = useRef<number | undefined>(undefined);
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
      setPresenceDevices(next.presence ?? []);
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

  const writePresence = useCallback(
    async ({
      participantId,
      teamId,
      runId,
      deviceId,
      visible
    }: {
      participantId: string;
      teamId: string;
      runId: string;
      deviceId: string;
      visible: boolean;
    }) => {
      const access = await issueRealtimeAccess();
      const now = new Date();
      const response = await fetch(
        `${publicEnv.supabaseUrl}/rest/v1/quest_presence?on_conflict=participant_id,device_id`,
        {
          method: "POST",
          headers: {
            apikey: publicEnv.supabasePublishableKey,
            authorization: `Bearer ${access.accessToken}`,
            "content-type": "application/json",
            prefer: "resolution=merge-duplicates,return=minimal"
          },
          body: JSON.stringify({
            participant_id: participantId,
            device_id: deviceId,
            team_id: teamId,
            run_id: runId,
            visible,
            online_at: now.toISOString(),
            expires_at: new Date(now.getTime() + PRESENCE_TTL_MS).toISOString()
          })
        }
      );
      if (!response.ok) {
        throw new Error(`Presence heartbeat failed (${response.status})`);
      }
    },
    [issueRealtimeAccess]
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
    const tick = () => {
      setPresenceNow(Date.now());
      presenceClockTimer.current = window.setTimeout(tick, PRESENCE_CLOCK_MS);
    };
    presenceClockTimer.current = window.setTimeout(tick, PRESENCE_CLOCK_MS);
    return () => window.clearTimeout(presenceClockTimer.current);
  }, []);

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
      window.clearTimeout(heartbeatTimer.current);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, [refresh, token]);

  const runId = state?.run.id;
  const teamId = state?.team.id;
  const runCode = state?.run.publicCode;
  const participantId = state?.participant.id;

  useEffect(() => {
    if (!runId || !teamId || !runCode || !participantId) return;

    let active = true;
    const client = getQuestRealtimeClient();
    const deviceId = getDeviceId();
    const statuses = new Map<string, boolean>();
    let eventChannel: RealtimeChannel | null = null;
    let presenceChannel: RealtimeChannel | null = null;
    let boardChannel: RealtimeChannel | null = null;

    const updateStatus = (name: string, status: string) => {
      if (!active) return;
      statuses.set(name, status === "SUBSCRIBED");
      const allConnected =
        statuses.get("events") === true &&
        statuses.get("presence") === true &&
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
    };

    const applyPresenceChange = (
      payload: RealtimePostgresChangesPayload<PresenceRow>
    ) => {
      const nextRow = payload.new as PresenceRow;
      const oldRow = payload.old as Partial<PresenceRow>;
      setPresenceDevices((current) => {
        const next = new Map(current.map((device) => [deviceKey(device), device]));
        if (payload.eventType === "DELETE") {
          if (oldRow.participant_id && oldRow.device_id) {
            next.delete(`${oldRow.participant_id}:${oldRow.device_id}`);
          }
        } else if (nextRow.participant_id && nextRow.device_id) {
          const device = presenceFromRow(nextRow);
          next.set(deviceKey(device), device);
        }
        return [...next.values()];
      });
      setPresenceNow(Date.now());
    };

    const heartbeat = async () => {
      if (!active || !navigator.onLine) return;
      try {
        await writePresence({
          participantId,
          teamId,
          runId,
          deviceId,
          visible: document.visibilityState === "visible"
        });
      } catch (cause) {
        if (active) {
          setError(cause instanceof Error ? cause.message : "Presence heartbeat failed");
        }
      } finally {
        if (active) {
          heartbeatTimer.current = window.setTimeout(
            () => void heartbeat(),
            PRESENCE_HEARTBEAT_MS
          );
        }
      }
    };

    const onVisibility = () => void heartbeat();

    const connect = async () => {
      await issueRealtimeAccess();
      if (!active) return;

      eventChannel = client
        .channel(`quest-events:${runId}:${teamId}`)
        .on(
          "postgres_changes",
          {
            event: "INSERT",
            schema: "public",
            table: "quest_realtime_events",
            filter: `run_id=eq.${runId}`
          },
          scheduleStateRefresh
        )
        .subscribe((status) => updateStatus("events", status));

      presenceChannel = client
        .channel(`quest-presence:${teamId}`)
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "quest_presence",
            filter: `team_id=eq.${teamId}`
          },
          applyPresenceChange
        )
        .subscribe((status) => updateStatus("presence", status));

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
      void heartbeat();
    };

    void connect().catch((cause) => {
      if (!active) return;
      setError(cause instanceof Error ? cause.message : "Realtime connection failed");
      setConnectionState(navigator.onLine ? "reconnecting" : "offline");
      scheduleStaleState();
    });

    return () => {
      active = false;
      window.clearTimeout(heartbeatTimer.current);
      document.removeEventListener("visibilitychange", onVisibility);
      if (eventChannel) void client.removeChannel(eventChannel);
      if (presenceChannel) void client.removeChannel(presenceChannel);
      if (boardChannel) void client.removeChannel(boardChannel);
    };
  }, [
    issueRealtimeAccess,
    participantId,
    runCode,
    runId,
    scheduleBoardRefresh,
    scheduleStateRefresh,
    scheduleStaleState,
    teamId,
    writePresence
  ]);

  const presence = useMemo(
    () => groupPresence(presenceDevices, state?.members ?? [], presenceNow),
    [presenceDevices, presenceNow, state?.members]
  );

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
