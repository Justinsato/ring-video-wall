import { describe, it, expect } from 'vitest'
import { healthAction, DISCONNECT_GRACE_MS } from './connection-health'

describe('healthAction', () => {
  it('treats failed as terminal, not worth a grace period', () => {
    // ICE is out of candidates; it cannot recover without a restart, so waiting
    // only delays the reconnect.
    expect(healthAction('failed')).toBe('fail-now')
  })

  it('gives disconnected a chance to self-heal', () => {
    // A wifi handoff or NAT rebind routinely returns to connected on its own.
    expect(healthAction('disconnected')).toBe('watch')
  })

  it('treats connected as recovery, so a blip cancels the pending failure', () => {
    expect(healthAction('connected')).toBe('recovered')
  })

  it('never reports our own teardown as a fault', () => {
    // close() is what stopStream does. If this returned anything but ignore,
    // every deliberate stop would look like a failure and trigger a reconnect.
    expect(healthAction('closed')).toBe('ignore')
  })

  it('ignores the states on the way up', () => {
    expect(healthAction('new')).toBe('ignore')
    expect(healthAction('connecting')).toBe('ignore')
  })

  it('uses a grace period long enough to outlast a blip but not a stall', () => {
    expect(DISCONNECT_GRACE_MS).toBeGreaterThanOrEqual(3_000)
    expect(DISCONNECT_GRACE_MS).toBeLessThanOrEqual(15_000)
  })
})
