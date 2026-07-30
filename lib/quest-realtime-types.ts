export type QuestLocale = "he" | "en";

export type QuestLeaderboardEntry = {
  team_name: string;
  score: number;
  completed_count: number;
  status: string;
  last_progress_at: string | null;
};

export type QuestParticipantState = {
  participant: {
    id?: string;
    firstName: string;
    language: QuestLocale;
    whatsappConnected: boolean;
  };
  run: {
    id?: string;
    publicCode: string;
    status: string;
    scheduledAt: string | null;
    totalCheckpoints: number;
  };
  team: {
    id?: string;
    name: string;
    status: string;
    score: number;
    completedCount: number;
  };
  members: Array<{ id: string; firstName: string }>;
  checkpoint: null | {
    id?: string;
    slug: string;
    sequenceNo: number;
    kind: string;
    content: Record<string, unknown>;
    validation: Record<string, unknown>;
    hints?: unknown[];
    scoring?: Record<string, unknown>;
    fallback: Record<string, unknown> | null;
    latitude: number | null;
    longitude: number | null;
    radiusMeters: number | null;
    isOptional: boolean;
    scanVerified: boolean;
    photoFallbackAvailable: boolean;
  };
  realtime: {
    teamTopic: string;
    runTopic: string;
  };
};
