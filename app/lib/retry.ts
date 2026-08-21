/**
 * Reconnect backoff for a failed camera tile.
 *
 * Exported as a pure function rather than inlined in CameraTile so the test can
 * import it instead of restating the schedule, which is how a test and its
 * subject drift apart.
 *
 * Doubling from 2s, capped at 30s: 2, 4, 8, 16, 30, 30... The cap matters
 * because N tiles retry independently, so an uncapped curve on a large account
 * turns into a slow thundering herd against the Ring API.
 */
export const RETRY_BASE_MS = 2_000
export const RETRY_CAP_MS = 30_000

/** Max automatic attempts before a tile stays errored and waits to be clicked. */
export const RETRY_MAX_ATTEMPTS = 5

export function retryDelayMs(attempt: number): number {
  // `!(attempt >= 1)`, not `attempt < 1`: NaN fails both comparisons, so the
  // `<` form fell through and returned NaN. setTimeout(fn, NaN) fires on the
  // next tick, which turns the backoff into a tight loop against the Ring API —
  // the exact failure the backoff exists to prevent.
  if (!Number.isFinite(attempt) || !(attempt >= 1)) return RETRY_BASE_MS
  return Math.min(RETRY_BASE_MS * 2 ** (attempt - 1), RETRY_CAP_MS)
}

/**
 * Should this tile retry at all?
 *
 * An offline device is excluded on purpose: the failure is not transient, and
 * retrying five times per offline camera buys nothing but load and log noise.
 */
export function shouldRetry(opts: {
  error: string | null
  online: boolean
  attempts: number
}): boolean {
  return Boolean(opts.error) && opts.online && opts.attempts < RETRY_MAX_ATTEMPTS
}
