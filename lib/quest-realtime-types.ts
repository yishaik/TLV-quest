export type QuestLocale = "he" | "en";

export type QuestLeaderboardEntry = {
  team_name: string;
  score: number;
  completed_count: number;
  status: string;
  last_progress_at: string | null;
};

export type QuestActivityEntry = {
  id: string;
  eventType: string;
  actorId: string | null;
  actorName: string | null;
  checkpointSlug: string | null;
  createdAt: string;
};

export type QuestPresenceDevice = {
  participantId: string;
  deviceId: string;
  visible: boolean;
  onlineAt: string;
  expiresAt: string;
};

export type QuestPresenceMember = {
  participantId: string;
  firstName: string;
  deviceCount: number;
  visible: boolean;
  onlineAt: string | null;
};

export type QuestConnectionState =
  | "connecting"
  | "live"
  | "reconnecting"
  | "offline"
  | "stale";

export type QuestParticipantState = {
  participant: {
    id: string;
    firstName: string;
    language: QuestLocale;
    whatsappConnected: boolean;
    recoveryUrl: string;
  };
  run: {
    id: string;
    publicCode: string;
    status: string;
    scheduledAt: string | null;
    totalCheckpoints: number;
  };
  team: {
    id: string;
    name: string;
    status: string;
    score: number;
    completedCount: number;
  };
  members: Array<{ id: string; firstName: string }>;
  activity: QuestActivityEntry[];
  presence: QuestPresenceDevice[];
  banners: Array<{
    id: string;
    body: string;
    activeUntil: string;
    createdAt: string;
  }>;
  branding: {
    productName: string;
    primaryColor: string;
    surfaceColor: string;
    logoUrl: string;
  };
  difficulty: {
    level: "challenge" | "standard" | "assisted";
    wrongAttemptsToUnlock: number;
    inactivityMinutesToUnlock: number;
    rewardMultiplier: number;
    penaltyMultiplier: number;
    reason: "fast_progress" | "steady_progress" | "needs_support";
  };
  hintOffer: null | {
    available: boolean;
    reason: "wrong_attempts" | "inactivity" | "locked";
    penalty: number;
    index: number;
    total: number;
    wrongAttemptsToUnlock: number;
    unlockAt: string;
    secondsUntilUnlock: number;
  };
  checkpoint: null | {
    id: string;
    slug: string;
    sequenceNo: number;
    kind: string;
    content: Record<string, unknown>;
    choiceOptions: string[];
    fallbackPrompt: string | null;
    hasFallback: boolean;
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
