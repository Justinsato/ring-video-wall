import { renderHook, act, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createRef } from 'react'
import { useWebRTCStream } from './useWebRTCStream'

class MockPeerConnection {
  iceGatheringState = 'complete'
  localDescription = { sdp: 'v=0\r\nfake-offer' }
  onicegatheringstatechange: (() => void) | null = null
  ontrack: ((e: any) => void) | null = null
  transceivers: Array<{ kind: string; direction: string }> = []
  addTransceiver(kind: string, opts: { direction: string }) {
    this.transceivers.push({ kind, direction: opts.direction })
  }
  async createOffer() { return { type: 'offer', sdp: 'v=0\r\nfake-offer' } }
  async setLocalDescription() {}
  async setRemoteDescription() {}
  close() {}
}

let lastPc: MockPeerConnection

beforeEach(() => {
  vi.stubGlobal('RTCPeerConnection', vi.fn(() => {
    lastPc = new MockPeerConnection()
    return lastPc
  }))
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: any) => {
    if (init?.method === 'POST') {
      return {
        ok: true,
        json: async () => ({ sdpAnswer: 'v=0\r\nfake-answer', sessionUrl: 'https://api.amazonvision.com/session/abc' }),
      }
    }
    return { ok: true, json: async () => ({ success: true }) }
  }))
})

afterEach(() => vi.unstubAllGlobals())

describe('useWebRTCStream (video-only)', () => {
  it('adds a video recvonly transceiver and NO audio transceiver', async () => {
    const videoRef = createRef<HTMLVideoElement>()
    // @ts-expect-error minimal stub
    videoRef.current = { srcObject: null }
    const { result } = renderHook(() => useWebRTCStream({ videoRef, deviceId: 'dev-1' }))
    await act(async () => { await result.current.startStream() })
    expect(lastPc.transceivers).toEqual([{ kind: 'video', direction: 'recvonly' }])
  })

  it('POSTs the SDP offer and deviceId to /api/ring/stream', async () => {
    const videoRef = createRef<HTMLVideoElement>()
    // @ts-expect-error minimal stub
    videoRef.current = { srcObject: null }
    const { result } = renderHook(() => useWebRTCStream({ videoRef, deviceId: 'dev-1' }))
    await act(async () => { await result.current.startStream() })
    const call = (fetch as any).mock.calls.find((c: any[]) => c[1]?.method === 'POST')
    expect(call[0]).toBe('/api/ring/stream')
    const body = JSON.parse(call[1].body)
    expect(body).toMatchObject({ deviceId: 'dev-1', sdpOffer: 'v=0\r\nfake-offer' })
  })

  it('DELETEs the session on stopStream', async () => {
    const videoRef = createRef<HTMLVideoElement>()
    // @ts-expect-error minimal stub
    videoRef.current = { srcObject: null }
    const { result } = renderHook(() => useWebRTCStream({ videoRef, deviceId: 'dev-1' }))
    await act(async () => { await result.current.startStream() })
    await act(async () => { await result.current.stopStream() })
    const del = (fetch as any).mock.calls.find((c: any[]) => c[1]?.method === 'DELETE')
    expect(del[0]).toBe('/api/ring/stream')
    expect(JSON.parse(del[1].body)).toEqual({ sessionUrl: 'https://api.amazonvision.com/session/abc' })
  })

  it('marks the DELETE fetch keepalive so it survives page unload', async () => {
    const videoRef = createRef<HTMLVideoElement>()
    // @ts-expect-error minimal stub
    videoRef.current = { srcObject: null }
    const { result } = renderHook(() => useWebRTCStream({ videoRef, deviceId: 'dev-1' }))
    await act(async () => { await result.current.startStream() })
    await act(async () => { await result.current.stopStream() })
    const del = (fetch as any).mock.calls.find((c: any[]) => c[1]?.method === 'DELETE')
    expect(del[1].keepalive).toBe(true)
  })
})

// The ICE wait is the one place the hook can hang: a browser that never reports
// `complete` would leave the tile stuck on "connecting" forever with no offer
// ever sent. The 3-second timeout is the escape hatch, so it gets two tests, one
// proving the fallback fires and one proving it is only a fallback.
describe('useWebRTCStream ICE gathering', () => {
  const stubRef = () => {
    const videoRef = createRef<HTMLVideoElement>()
    // @ts-expect-error minimal stub
    videoRef.current = { srcObject: null }
    return videoRef
  }
  const postCount = () =>
    (fetch as any).mock.calls.filter((c: any[]) => c[1]?.method === 'POST').length

  // The shared mock hardcodes iceGatheringState = 'complete' as an INSTANCE
  // field, which short-circuits the wait entirely (and beats anything set on the
  // prototype). Re-stub so these two tests get a connection that is still
  // gathering when the hook starts waiting on it.
  beforeEach(() => {
    vi.stubGlobal('RTCPeerConnection', vi.fn(() => {
      lastPc = new MockPeerConnection()
      lastPc.iceGatheringState = 'gathering'
      return lastPc
    }))
  })

  afterEach(() => vi.useRealTimers())

  it('sends the offer anyway once the 3s timeout fires, when gathering never completes', async () => {
    vi.useFakeTimers()
    const { result } = renderHook(() => useWebRTCStream({ videoRef: stubRef(), deviceId: 'dev-1' }))

    // Deliberately never awaited: if the fallback is broken this promise never
    // settles, and awaiting it would hang until vitest's 5s limit, blow up the
    // NEXT test with a torn-down hook, and bury the real cause. Asserting on the
    // POST instead fails in milliseconds and points at the right line.
    await act(async () => { void result.current.startStream() })

    await vi.advanceTimersByTimeAsync(2999)
    expect(postCount()).toBe(0)   // still blocked on ICE

    await vi.advanceTimersByTimeAsync(1)
    await vi.advanceTimersByTimeAsync(0)   // let the post-resolve awaits run
    expect(postCount()).toBe(1)   // the timeout released it
  })

  it('proceeds on the gathering-complete event, without waiting out the timeout', async () => {
    vi.useFakeTimers()
    const { result } = renderHook(() => useWebRTCStream({ videoRef: stubRef(), deviceId: 'dev-1' }))

    let pending!: Promise<void>
    await act(async () => { pending = result.current.startStream() })
    expect(postCount()).toBe(0)

    // The browser reports completion 10ms in. The offer must go on the back of
    // that event alone, so the clock deliberately never reaches 3000: if this
    // only passed because the fallback fired, it would prove nothing about the
    // event path. Do NOT wrap the await in act() either — act() flushes pending
    // timers, which fires the 3s fallback and hides the thing under test. That
    // is exactly how this test first passed for the wrong reason.
    await vi.advanceTimersByTimeAsync(10)
    lastPc.iceGatheringState = 'complete'
    lastPc.onicegatheringstatechange?.()
    await vi.advanceTimersByTimeAsync(0)   // microtasks only; clock stays at 10ms
    await pending
    expect(vi.getTimerCount()).toBe(0)     // clearTimeout ran

    expect(postCount()).toBe(1)
  })
})
