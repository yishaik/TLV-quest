export type ReplayEvent = {
  id: string;
  eventType: string;
  teamId: string | null;
  participantId: string | null;
  actorName: string | null;
  checkpointSlug: string | null;
  scoreDelta: number;
  penalty: number;
  createdAt: string;
  payload: Record<string, unknown>;
};

export type ReplayTeamSeed = {
  id: string;
  name: string;
};

export type ReplayTeamState = ReplayTeamSeed & {
  score: number;
  completedCount: number;
  status: string;
  checkpointSlug: string | null;
  hintsUsed: number;
  wrongAttempts: number;
};

export type ReplayFrame = {
  index: number;
  at: string;
  event: ReplayEvent;
  teams: ReplayTeamState[];
};

const cloneTeams = (teams: Map<string, ReplayTeamState>) =>
  [...teams.values()]
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((team) => ({ ...team }));

const objectValue = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const numberValue = (value: unknown, fallback: number) =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;

export const sortReplayEvents = (events: ReplayEvent[]) =>
  [...events].sort((left, right) => {
    const byTime =
      new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime();
    if (byTime !== 0) return byTime;
    if (/^\d+$/.test(left.id) && /^\d+$/.test(right.id)) {
      const leftId = BigInt(left.id);
      const rightId = BigInt(right.id);
      return leftId < rightId ? -1 : leftId > rightId ? 1 : 0;
    }
    return left.id.localeCompare(right.id);
  });

export const buildQuestReplay = ({
  teams: teamSeeds,
  events
}: {
  teams: ReplayTeamSeed[];
  events: ReplayEvent[];
}): ReplayFrame[] => {
  const teams = new Map<string, ReplayTeamState>(
    teamSeeds.map((team) => [
      team.id,
      {
        ...team,
        score: 0,
        completedCount: 0,
        status: "waiting",
        checkpointSlug: null,
        hintsUsed: 0,
        wrongAttempts: 0
      } satisfies ReplayTeamState
    ])
  );

  return sortReplayEvents(events).map((event, index) => {
    if (event.eventType === "RUN_STARTED") {
      for (const team of teams.values()) team.status = "travelling";
    }
    const team = event.teamId ? teams.get(event.teamId) : null;
    if (team) {
      if (event.eventType === "LOCATION_VERIFIED") {
        team.status = "solving";
        team.checkpointSlug = event.checkpointSlug;
      } else if (event.eventType === "ANSWER_REJECTED") {
        team.wrongAttempts += 1;
        team.score = Math.max(0, team.score + event.scoreDelta);
        team.checkpointSlug = event.checkpointSlug;
      } else if (
        ["ANSWER_ACCEPTED", "PHOTO_APPROVED", "STATION_SCANNED"].includes(
          event.eventType
        )
      ) {
        team.score = Math.max(0, team.score + event.scoreDelta);
        team.completedCount += 1;
        team.wrongAttempts = 0;
        team.hintsUsed = 0;
        team.status = "travelling";
        team.checkpointSlug = event.checkpointSlug;
      } else if (event.eventType === "HINT_REQUESTED") {
        team.score = Math.max(0, team.score - event.penalty);
        team.hintsUsed += 1;
      } else if (event.eventType === "OPTIONAL_CHECKPOINT_SKIPPED") {
        team.completedCount += 1;
        team.status = "travelling";
        team.checkpointSlug = event.checkpointSlug;
      } else if (event.eventType === "ORGANIZER_OVERRIDE") {
        const after = objectValue(event.payload.after);
        team.score = numberValue(after.score, team.score);
        team.completedCount = numberValue(
          after.completedCount,
          team.completedCount
        );
        team.status =
          typeof after.status === "string" ? after.status : team.status;
        team.checkpointSlug =
          typeof after.checkpoint === "string"
            ? after.checkpoint
            : team.checkpointSlug;
      }
    }
    if (event.eventType === "RUN_FINISHED") {
      for (const replayTeam of teams.values()) {
        if (replayTeam.status !== "disqualified") replayTeam.status = "finished";
      }
    }

    return {
      index,
      at: event.createdAt,
      event,
      teams: cloneTeams(teams)
    };
  });
};

export const replayStats = (events: ReplayEvent[]) => {
  const sorted = sortReplayEvents(events);
  const startedAt = sorted[0]?.createdAt ?? null;
  const finishedAt = sorted.at(-1)?.createdAt ?? null;
  const durationSeconds =
    startedAt && finishedAt
      ? Math.max(
          0,
          Math.round(
            (new Date(finishedAt).getTime() - new Date(startedAt).getTime()) /
              1000
          )
        )
      : 0;
  return {
    durationSeconds,
    accepted: events.filter((event) =>
      ["ANSWER_ACCEPTED", "PHOTO_APPROVED", "STATION_SCANNED"].includes(
        event.eventType
      )
    ).length,
    wrongAttempts: events.filter(
      (event) => event.eventType === "ANSWER_REJECTED"
    ).length,
    hints: events.filter((event) => event.eventType === "HINT_REQUESTED").length,
    photos: events.filter((event) =>
      ["PHOTO_APPROVED", "PHOTO_REJECTED"].includes(event.eventType)
    ).length
  };
};
