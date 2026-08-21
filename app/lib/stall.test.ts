import { describe, it, expect } from 'vitest'
import {
  assessFrames, framesDecodedFrom, initialStallState,
  STALL_STRIKES, STALL_POLL_MS, type StallState,
} from './stall'

/** Feed a series of framesDecoded readings and collect the verdicts. */
function run(samples: Array<number | null>, from: StallState = initialStallState) {
  let s = from
  return samples.map((f) => {
    const { next, verdict } = assessFrames(s, f)
    s = next
    return verdict
  })
}

describe('assessFrames', () => {
  it('never rules on the first sample — there is nothing to compare against', () => {
    expect(run([100])).toEqual(['waiting'])
  })

  it('reports ok while the decoder advances', () => {
    expect(run([100, 130, 160, 190])).toEqual(['waiting', 'ok', 'ok', 'ok'])
  })

  it('calls a stall after three flat samples, not before', () => {
    // 6 seconds of frozen picture at a 2s poll.
    expect(run([100, 100, 100, 100])).toEqual(['waiting', 'waiting', 'waiting', 'stalled'])
  })

  it('forgives a single flat sample followed by progress', () => {
    // A GC pause or one slow report must not take a working tile down.
    expect(run([100, 100, 140])).toEqual(['waiting', 'waiting', 'ok'])
  })

  it('resets the strike count on recovery, so flat samples must be consecutive', () => {
    expect(run([10, 10, 20, 20, 30, 30, 40])).toEqual(
      ['waiting', 'waiting', 'ok', 'waiting', 'ok', 'waiting', 'ok'],
    )
  })

  it('strikes from zero: a track that never delivers a frame is stalled too', () => {
    // Treating "never started" as a special case is how it goes unreported.
    expect(run([0, 0, 0, 0])).toEqual(['waiting', 'waiting', 'waiting', 'stalled'])
  })

  it('re-baselines when the counter goes backwards, which means a new track', () => {
    expect(run([500, 500, 3])).toEqual(['waiting', 'waiting', 'ok'])
  })

  it('holds its ground when stats are missing rather than guessing', () => {
    // A browser publishing stats late must not read as a freeze.
    expect(run([null, null, null])).toEqual(['waiting', 'waiting', 'waiting'])
    // A gap in the middle neither strikes nor clears the strikes already held:
    // three flat readings around one null is still only two strikes, so the
    // missing sample delays the verdict rather than bringing it forward.
    expect(run([10, 10, null, 10])).toEqual(['waiting', 'waiting', 'waiting', 'waiting'])
    expect(run([10, 10, null, 10, 10])).toEqual(['waiting', 'waiting', 'waiting', 'waiting', 'stalled'])
  })

  it('rejects a non-finite reading', () => {
    expect(run([10, NaN as unknown as number, 10])).toEqual(['waiting', 'waiting', 'waiting'])
  })

  it('needs more than one strike to fire, or a hiccup would be a stall', () => {
    expect(STALL_STRIKES).toBeGreaterThan(1)
    // And the whole window has to be short enough that someone is still watching.
    expect(STALL_STRIKES * STALL_POLL_MS).toBeLessThanOrEqual(15_000)
  })
})

describe('framesDecodedFrom', () => {
  const report = (entries: any[]) => ({ forEach: (f: (v: any) => void) => entries.forEach(f) }) as unknown as RTCStatsReport

  it('pulls framesDecoded off the inbound video stream', () => {
    expect(framesDecodedFrom(report([
      { type: 'outbound-rtp', kind: 'video', framesEncoded: 9 },
      { type: 'inbound-rtp', kind: 'video', framesDecoded: 42 },
    ]))).toBe(42)
  })

  it('accepts the legacy mediaType spelling', () => {
    expect(framesDecodedFrom(report([{ type: 'inbound-rtp', mediaType: 'video', framesDecoded: 7 }]))).toBe(7)
  })

  it('ignores audio, which decodes happily while the picture is frozen', () => {
    expect(framesDecodedFrom(report([
      { type: 'inbound-rtp', kind: 'audio', framesDecoded: 999 },
    ]))).toBeNull()
  })

  it('returns null when the field is absent, so the caller waits instead of striking', () => {
    expect(framesDecodedFrom(report([{ type: 'inbound-rtp', kind: 'video' }]))).toBeNull()
    expect(framesDecodedFrom(report([]))).toBeNull()
    expect(framesDecodedFrom(null)).toBeNull()
  })
})
