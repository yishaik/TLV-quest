from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    file_path = Path(path)
    content = file_path.read_text()
    if old not in content:
        raise SystemExit(f"Expected block not found in {path}")
    file_path.write_text(content.replace(old, new, 1))


replace_once(
    "components/PremiumQuestPlayer.tsx",
    'import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";\n',
    'import { FormEvent, useEffect, useMemo, useState } from "react";\nimport { useQuestRealtime } from "@/components/QuestRealtimeProvider";\n',
)

replace_once(
    "components/PremiumQuestPlayer.tsx",
    '''export function PremiumQuestPlayer({ token }: { token: string }) {
  const [state, setState] = useState<ParticipantState | null>(null);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [drawer, setDrawer] = useState<Drawer>(null);
''',
    '''export function PremiumQuestPlayer({ token }: { token: string }) {
  const {
    state: realtimeState,
    leaderboard,
    connected,
    error: realtimeError,
    refresh
  } = useQuestRealtime();
  const state = realtimeState as ParticipantState | null;
  const [drawer, setDrawer] = useState<Drawer>(null);
''',
)

replace_once(
    "components/PremiumQuestPlayer.tsx",
    '''  const loadState = useCallback(async () => {
    const response = await fetch(
      `/api/participants/${encodeURIComponent(token)}/state`,
      { cache: "no-store" }
    );
    const payload = await response.json();
    if (!response.ok || !payload.ok) {
      throw new Error(payload.error?.message ?? "Failed to load game");
    }
    setState(payload.data);
    return payload.data as ParticipantState;
  }, [token]);

  const loadBoard = useCallback(async (code: string) => {
    const response = await fetch(`/api/leaderboard/${encodeURIComponent(code)}`, {
      cache: "no-store"
    });
    const payload = await response.json();
    if (response.ok && payload.ok) setLeaderboard(payload.data);
  }, []);

  useEffect(() => {
    localStorage.setItem("tlvQuestParticipantToken", token);
    let cancelled = false;
    let timer: number | undefined;

    const refresh = async () => {
      if (document.visibilityState === "hidden") return;
      try {
        const next = await loadState();
        if (!cancelled) await loadBoard(next.run.publicCode);
      } catch (cause) {
        if (!cancelled) {
          setError(cause instanceof Error ? cause.message : "Unexpected error");
        }
      }
    };
    const start = () => {
      void refresh();
      window.clearInterval(timer);
      timer = window.setInterval(refresh, 7000);
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") start();
    };
    start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [loadBoard, loadState, token]);

''',
    '',
)

premium = Path("components/PremiumQuestPlayer.tsx")
content = premium.read_text()
content = content.replace("void loadState()", "void refresh()")
content = content.replace("await loadState()", "await refresh()")
content = content.replace(
    '<span>{error || (isHebrew ? "מאתר את האות…" : "Locating the signal…")}</span>',
    '<span>{error || realtimeError || (isHebrew ? "מאתר את האות…" : "Locating the signal…")}</span>',
)
content = content.replace(
    '''            <span>
              {state.team.score} {isHebrew ? "נקודות" : "points"}
            </span>
''',
    '''            <span>
              {state.team.score} {isHebrew ? "נקודות" : "points"}
            </span>
            <small title={connected ? "Supabase Realtime connected" : "Realtime reconnecting"}>
              {connected ? (isHebrew ? "מחובר בזמן אמת" : "Live") : isHebrew ? "מתחבר מחדש…" : "Reconnecting…"}
            </small>
''',
    1,
)
content = content.replace(
    '''          {error && (
            <div className="quest-feedback error" role="alert">
              {error}
            </div>
          )}
''',
    '''          {(error || realtimeError) && (
            <div className="quest-feedback error" role="alert">
              {error || realtimeError}
            </div>
          )}
''',
    1,
)
premium.write_text(content)

replace_once(
    "components/QuestRealtimeProvider.tsx",
    '''    let client: ReturnType<typeof getBrowserClient>;
    try {
      client = getBrowserClient();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Realtime is unavailable");
      return;
    }
''',
    '''    const client = getBrowserClient();
''',
)
