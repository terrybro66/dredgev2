interface ScoreOptions {
  current: number;
  success: boolean;
  rowCount: number;
}

const BOOST = 0.05;
const PENALTY = 0.1;

export function scoreSource({ current, success, rowCount }: ScoreOptions): number {
  let next: number;

  if (success && rowCount > 0) {
    next = current + BOOST;
  } else if (success && rowCount === 0) {
    next = current;
  } else {
    next = current - PENALTY;
  }

  return Math.min(1.0, Math.max(0.0, next));
}
