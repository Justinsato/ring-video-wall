import { describe, it, expect } from 'vitest'
import {
  retryDelayMs,
  shouldRetry,
  RETRY_BASE_MS,
  RETRY_CAP_MS,
  RETRY_MAX_ATTEMPTS,
} from './retry'

describe('retryDelayMs', () => {
  it('doubles from the base delay', () => {
    expect([1, 2, 3, 4].map(retryDelayMs)).toEqual([2_000, 4_000, 8_000, 16_000])
  })

  it('caps instead of growing without bound', () => {
    expect(retryDelayMs(5)).toBe(RETRY_CAP_MS)
    expect(retryDelayMs(50)).toBe(RETRY_CAP_MS)
    // The cap is what stops N tiles on a large account turning into a slow
    // thundering herd, so assert the curve is actually bounded, not just that
    // one late value happens to match.
    expect(Math.max(...Array.from({ length: 100 }, (_, i) => retryDelayMs(i + 1)))).toBe(RETRY_CAP_MS)
  })

  it('never returns 0 or a negative delay for a nonsense attempt number', () => {
    // A 0ms retry is a tight loop against the Ring API.
    for (const n of [0, -1, -99, NaN]) {
      expect(retryDelayMs(n)).toBeGreaterThanOrEqual(RETRY_BASE_MS)
    }
  })
})

describe('shouldRetry', () => {
  it('retries a transient failure on an online device', () => {
    expect(shouldRetry({ error: 'negotiation failed', online: true, attempts: 0 })).toBe(true)
  })

  it('does not retry when there is no error', () => {
    expect(shouldRetry({ error: null, online: true, attempts: 0 })).toBe(false)
  })

  it('does not retry an offline device', () => {
    // Not a transient failure. Five attempts per offline camera is pure load.
    expect(shouldRetry({ error: 'boom', online: false, attempts: 0 })).toBe(false)
  })

  it('stops at the attempt ceiling', () => {
    expect(shouldRetry({ error: 'boom', online: true, attempts: RETRY_MAX_ATTEMPTS - 1 })).toBe(true)
    expect(shouldRetry({ error: 'boom', online: true, attempts: RETRY_MAX_ATTEMPTS })).toBe(false)
    expect(shouldRetry({ error: 'boom', online: true, attempts: RETRY_MAX_ATTEMPTS + 9 })).toBe(false)
  })
})
