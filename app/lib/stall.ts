/**
 * Stall detection from decoder progress.
 *
 * The gap this closes: `onconnectionstatechange` reports the transport, not the
 * media. A session can sit at `connected` with a healthy ICE pair while frames
 * stop arriving — the encoder wedged, the camera rebooted, the upstream dropped.
 * The tile shows `live` over a still image and nothing notices.
 *
 * The only honest signal is whether the decoder is still making progress, so
 * this works off `framesDecoded` from the inbound-rtp video stats. It is
 * monotonic and it is the number that stops moving when the picture freezes.
 *
 * Kept as pure state-in/verdict-out so the tests drive it directly instead of
 * standing up a fake getStats() to reach a decision three layers down.
 */

/** How often the hook samples. */
export const STALL_POLL_MS = 2_000

/**
 * Consecutive samples with no decoder progress before calling it stalled.
 * 3 x 2s = about 6 seconds of frozen picture. Low enough to catch it while
 * someone is still looking, high enough to ride out a GC pause or a hiccup in
 * one sample.
 */
export const STALL_STRIKES = 3

export interface StallState {
  /** framesDecoded at the last sample, or null before the first one. */
  frames: number | null
  /** Consecutive samples with no progress. */
  strikes: number
}

export const initialStallState: StallState = { frames: null, strikes: 0 }

export type StallVerdict =
  | 'ok'        // decoder advanced
  | 'waiting'   // no verdict yet: first sample, no stats, or not enough strikes
  | 'stalled'   // no progress for STALL_STRIKES samples running

export function assessFrames(
  prev: StallState,
  frames: number | null,
): { next: StallState; verdict: StallVerdict } {
  // No inbound video stats in this sample. Report nothing rather than guessing;
  // counting a missing report as a stall would fire on any browser that
  // publishes stats late.
  if (frames === null || !Number.isFinite(frames)) {
    return { next: prev, verdict: 'waiting' }
  }

  // First sample only establishes the baseline. There is no progress to measure
  // against yet, so it cannot be a verdict either way.
  if (prev.frames === null) {
    return { next: { frames, strikes: 0 }, verdict: 'waiting' }
  }

  if (frames > prev.frames) {
    return { next: { frames, strikes: 0 }, verdict: 'ok' }
  }

  // Went backwards. The browser reset the counter, which means a new track, not
  // a stall. Re-baseline rather than striking.
  if (frames < prev.frames) {
    return { next: { frames, strikes: 0 }, verdict: 'ok' }
  }

  // Flat. Note this strikes from zero as well: a track that has produced no
  // frames six seconds after ontrack fired is as broken as one that froze, and
  // treating "never started" as a special case is how that goes unreported.
  const strikes = prev.strikes + 1
  return {
    next: { frames, strikes },
    verdict: strikes >= STALL_STRIKES ? 'stalled' : 'waiting',
  }
}

/**
 * Pull framesDecoded out of an RTCStatsReport.
 *
 * Separated from the decision so the parsing can be tested against the report
 * shapes browsers actually emit, including the ones that omit the field.
 */
export function framesDecodedFrom(report: RTCStatsReport | null | undefined): number | null {
  if (!report) return null
  let found: number | null = null
  report.forEach((s: any) => {
    if (s?.type === 'inbound-rtp' && (s.kind === 'video' || s.mediaType === 'video')) {
      if (typeof s.framesDecoded === 'number') found = s.framesDecoded
    }
  })
  return found
}
