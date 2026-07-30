export type DifficultyLevel = "challenge" | "standard" | "assisted";

export type DifficultyPolicy = {
  level: DifficultyLevel;
  wrongAttemptsToUnlock: number;
  inactivityMinutesToUnlock: number;
  rewardMultiplier: number;
  penaltyMultiplier: number;
  reason: "fast_progress" | "steady_progress" | "needs_support";
};

export type DifficultyInputs = {
  enabled?: boolean;
  wrongAttempts: number;
  hintsUsed: number;
  completedCount: number;
  minutesSinceProgress: number;
};

const policies: Record<DifficultyLevel, Omit<DifficultyPolicy, "reason">> = {
  challenge: {
    level: "challenge",
    wrongAttemptsToUnlock: 3,
    inactivityMinutesToUnlock: 10,
    rewardMultiplier: 1.1,
    penaltyMultiplier: 1
  },
  standard: {
    level: "standard",
    wrongAttemptsToUnlock: 2,
    inactivityMinutesToUnlock: 7,
    rewardMultiplier: 1,
    penaltyMultiplier: 1
  },
  assisted: {
    level: "assisted",
    wrongAttemptsToUnlock: 1,
    inactivityMinutesToUnlock: 4,
    rewardMultiplier: 0.9,
    penaltyMultiplier: 0.5
  }
};

export const evaluateDifficulty = ({
  enabled = true,
  wrongAttempts,
  hintsUsed,
  completedCount,
  minutesSinceProgress
}: DifficultyInputs): DifficultyPolicy => {
  const level: DifficultyLevel = !enabled
    ? "standard"
    : wrongAttempts >= 2 || hintsUsed >= 2 || minutesSinceProgress >= 8
      ? "assisted"
      : completedCount >= 2 &&
          wrongAttempts === 0 &&
          hintsUsed === 0 &&
          minutesSinceProgress < 3
        ? "challenge"
        : "standard";
  const reason =
    level === "assisted"
      ? "needs_support"
      : level === "challenge"
        ? "fast_progress"
        : "steady_progress";
  return { ...policies[level], reason };
};

export const adjustScoreForDifficulty = (
  scoreDelta: number,
  policy: DifficultyPolicy
) => {
  const multiplier =
    scoreDelta < 0 ? policy.penaltyMultiplier : policy.rewardMultiplier;
  return Math.round(scoreDelta * multiplier);
};
