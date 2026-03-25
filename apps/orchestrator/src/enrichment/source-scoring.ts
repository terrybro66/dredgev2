interface ScoreOptions {
  current: number;
  success: boolean;
  rowCount: number;
}

const BOOST = 0.05; // per successful fetch with rows
const PENALTY = 0.1; // per failed fetch

export function scoreSource({
  current,
  success,
  rowCount,
}: ScoreOptions): number {
  let next: number;

  if (success && rowCount > 0) {
    next = current + BOOST;
  } else if (success && rowCount === 0) {
    next = current; // no change for empty success
  } else {
    next = current - PENALTY;
  }

  return Math.min(1.0, Math.max(0.0, next));
}
