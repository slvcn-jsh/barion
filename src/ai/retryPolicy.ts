export function generationRetryDelayMs(attemptCount: number) {
  const minutes = Math.min(60, 2 ** Math.min(Math.max(attemptCount - 1, 0), 6));
  return minutes * 60_000;
}
