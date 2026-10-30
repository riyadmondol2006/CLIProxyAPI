const MINUTE_MS = 60_000;

/**
 * Returns how long to wait until the visible countdown text next changes.
 *
 * The text shows minutes rounded up, so waking at the nearest minute boundary is enough; no
 * timer is created for times that have already expired or are invalid.
 */
export function getNextAntigravityCountdownUpdateDelay(
  resetTimestamps: readonly number[],
  nowMs: number
): number | null {
  let nextDelay: number | null = null;

  resetTimestamps.forEach((resetMs) => {
    if (!Number.isFinite(resetMs)) return;
    const deltaMs = resetMs - nowMs;
    if (deltaMs <= 0) return;

    const remainder = deltaMs % MINUTE_MS;
    const delay = Math.max(1, Math.ceil(remainder === 0 ? MINUTE_MS : remainder));
    nextDelay = nextDelay === null ? delay : Math.min(nextDelay, delay);
  });

  return nextDelay;
}
