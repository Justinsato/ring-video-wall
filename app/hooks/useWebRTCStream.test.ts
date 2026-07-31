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
})
