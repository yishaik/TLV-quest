export type OrderedCheckpoint = {
  sequence_no: number;
  kind: string;
  slug: string;
};

/**
 * Select a shorter story without reordering the authored walking route.
 * The opening and finale always survive; the middle is sampled evenly so the
 * physical route and narrative arc continue to move forward rather than jump
 * backward or end without closure.
 */
export const selectCoherentCheckpoints = <T extends OrderedCheckpoint>(
  checkpoints: T[],
  requestedCount?: number
): T[] => {
  const ordered = [...checkpoints].sort(
    (left, right) => left.sequence_no - right.sequence_no
  );
  if (!ordered.length) return [];

  const requested = Number.isFinite(requestedCount)
    ? Math.floor(requestedCount as number)
    : ordered.length;
  const count = Math.max(1, Math.min(ordered.length, requested));
  if (count >= ordered.length) return ordered;
  if (count === 1) return [ordered[0]];

  const selectedIndexes = new Set<number>([0, ordered.length - 1]);
  for (let position = 1; position < count - 1; position += 1) {
    selectedIndexes.add(
      Math.round((position * (ordered.length - 1)) / (count - 1))
    );
  }

  // Rounding can collide on very short routes. Fill any gaps from the start,
  // still preserving authored order and the final station.
  for (let index = 1; selectedIndexes.size < count && index < ordered.length - 1; index += 1) {
    selectedIndexes.add(index);
  }
  return [...selectedIndexes].sort((a, b) => a - b).map((index) => ordered[index]);
};
