export type Locale = "he" | "en";

export type LocalizedText = {
  he: string;
  en: string;
};

export type TextValidation = {
  type: "text";
  accepted: string[];
  fuzzyThreshold?: number;
};

export type ChoiceValidation = {
  type: "choice";
  acceptedOption: string;
};

export type ScanValidation = {
  type: "scan";
};

export type LocationValidation = {
  type: "location";
  latitude: number;
  longitude: number;
  radiusMeters: number;
};

export type ValidationRule =
  | TextValidation
  | ChoiceValidation
  | ScanValidation
  | LocationValidation;

export type ScoringConfig = {
  basePoints?: number;
  wrongPenalty?: number;
  hintPenalty?: number;
  speedBonusMax?: number;
  speedBonusWindowSeconds?: number;
};

export type AnswerEvaluation = {
  correct: boolean;
  normalizedAnswer: string;
  reason: "exact" | "fuzzy" | "wrong";
  similarity?: number;
};

const FINAL_HEBREW_FORMS: Record<string, string> = {
  ך: "כ",
  ם: "מ",
  ן: "נ",
  ף: "פ",
  ץ: "צ"
};

export const localized = (
  value: Partial<LocalizedText> | null | undefined,
  locale: Locale
): string => value?.[locale] ?? value?.he ?? value?.en ?? "";

export const normalizeAnswer = (value: string): string =>
  value
    .normalize("NFKD")
    .replace(/[\u0591-\u05C7]/g, "")
    .toLocaleLowerCase("he-IL")
    .replace(/[ךםןףץ]/g, (letter) => FINAL_HEBREW_FORMS[letter] ?? letter)
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");

const levenshteinDistance = (left: string, right: string): number => {
  if (left === right) return 0;
  if (!left.length) return right.length;
  if (!right.length) return left.length;

  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  const current = new Array<number>(right.length + 1);

  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    current[0] = leftIndex;
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const substitutionCost =
        left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1;
      current[rightIndex] = Math.min(
        current[rightIndex - 1] + 1,
        previous[rightIndex] + 1,
        previous[rightIndex - 1] + substitutionCost
      );
    }
    previous.splice(0, previous.length, ...current);
  }

  return previous[right.length];
};

export const similarity = (left: string, right: string): number => {
  const longest = Math.max(left.length, right.length);
  if (longest === 0) return 1;
  return 1 - levenshteinDistance(left, right) / longest;
};

export const evaluateTextAnswer = (
  answer: string,
  validation: TextValidation
): AnswerEvaluation => {
  const normalizedAnswer = normalizeAnswer(answer);
  const accepted = validation.accepted.map(normalizeAnswer).filter(Boolean);

  if (accepted.includes(normalizedAnswer)) {
    return { correct: true, normalizedAnswer, reason: "exact", similarity: 1 };
  }

  const threshold = validation.fuzzyThreshold;
  if (threshold !== undefined && normalizedAnswer.length >= 4) {
    const bestSimilarity = Math.max(
      0,
      ...accepted.map((candidate) => similarity(normalizedAnswer, candidate))
    );
    if (bestSimilarity >= threshold) {
      return {
        correct: true,
        normalizedAnswer,
        reason: "fuzzy",
        similarity: bestSimilarity
      };
    }
  }

  return { correct: false, normalizedAnswer, reason: "wrong" };
};

export const calculateScoreDelta = ({
  correct,
  wrongAttempts,
  hintsUsed,
  elapsedSeconds,
  scoring = {}
}: {
  correct: boolean;
  wrongAttempts: number;
  hintsUsed: number;
  elapsedSeconds: number;
  scoring?: ScoringConfig;
}): number => {
  const wrongPenalty = scoring.wrongPenalty ?? 5;
  if (!correct) return -wrongPenalty;

  const basePoints = scoring.basePoints ?? 100;
  const hintPenalty = scoring.hintPenalty ?? 10;
  const speedBonusMax = scoring.speedBonusMax ?? 20;
  const speedWindow = Math.max(1, scoring.speedBonusWindowSeconds ?? 420);
  const speedRatio = Math.max(0, 1 - elapsedSeconds / speedWindow);
  const speedBonus = Math.round(speedBonusMax * speedRatio);

  return Math.max(
    10,
    basePoints + speedBonus - hintsUsed * hintPenalty - wrongAttempts * wrongPenalty
  );
};

export const distanceMeters = (
  from: { latitude: number; longitude: number },
  to: { latitude: number; longitude: number }
): number => {
  const earthRadius = 6_371_000;
  const radians = (degrees: number) => (degrees * Math.PI) / 180;
  const latitudeDelta = radians(to.latitude - from.latitude);
  const longitudeDelta = radians(to.longitude - from.longitude);
  const firstLatitude = radians(from.latitude);
  const secondLatitude = radians(to.latitude);

  const haversine =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(firstLatitude) *
      Math.cos(secondLatitude) *
      Math.sin(longitudeDelta / 2) ** 2;

  return 2 * earthRadius * Math.asin(Math.sqrt(haversine));
};
