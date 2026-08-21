'use client'

import { useState, useRef, useCallback, RefObject } from 'react'
import { DISCONNECT_GRACE_MS, healthAction } from '../lib/connection-health'
import { STALL_POLL_MS, assessFrames, framesDecodedFrom, initialStallState } from '../lib/stall'

interface UseWebRTCStreamOptions {
  videoRef: RefObject<HTMLVideoElement>
  deviceId?: string
}

interface UseWebRTCStreamReturn {
  streamActive: boolean
  streamError: string | null
  startStream: () => Promise<void>
  stopStream: () => Promise<void>
}

/**
 * Manages WebRTC connection to Ring camera stream.
 * Handles ICE gathering, SDP negotiation, and cleanup.
 */
export function useWebRTCStream({ videoRef, deviceId }: UseWebRTCStreamOptions): UseWebRTCStreamReturn {
  const [streamActive, setStreamActive] = useState(false)
  const [streamError, setStreamError] = useState<string | null>(null)
  const pcRef = useRef<RTCPeerConnection | null>(null)
  const sessionUrlRef = useRef<string | null>(null)
  const graceTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const stallTimer = useRef<ReturnType<typeof setInterval> | null>(null)

  const clearGrace = useCallback(() => {
    if (graceTimer.current) {
      clearTimeout(graceTimer.current)
      graceTimer.current = null
    }
  }, [])

  const clearStall = useCallback(() => {
    if (stallTimer.current) {
      clearInterval(stallTimer.current)
      stallTimer.current = null
    }
  }, [])

  /**
   * Poll decoder progress. The connection watch above covers the transport;
   * this covers the picture, which can freeze while the transport stays healthy.
   * Stops itself on the first stall so it does not keep sampling a dead session.
   */
  const watchForStall = useCallback((pc: RTCPeerConnection) => {
    let state = initialStallState
    stallTimer.current = setInterval(async () => {
      if (pcRef.current !== pc) return
      let frames: number | null = null
      try {
        frames = framesDecodedFrom(await pc.getStats())
      } catch {
        // getStats can reject on a closing connection. A failed sample is not
        // evidence of a stall, so leave the state alone and try again.
        return
      }
      if (pcRef.current !== pc) return
      const { next, verdict } = assessFrames(state, frames)
      state = next
      if (verdict === 'stalled') {
        clearStall()
        setStreamActive(false)
        setStreamError('Stream stalled')
      }
    }, STALL_POLL_MS)
  }, [clearStall])

  const startStream = useCallback(async () => {
    setStreamError(null)
    // Close any connection still held before opening another. Without this a
    // second startStream() silently orphans the first RTCPeerConnection. That was
    // unreachable while a tile started exactly once; it is the normal path now
    // that a failed tile reconnects.
    clearGrace()
    clearStall()
    if (pcRef.current) {
      pcRef.current.close()
      pcRef.current = null
    }
    try {
      const pc = new RTCPeerConnection({
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:stun1.l.google.com:19302' },
        ],
      })
      pcRef.current = pc

      pc.addTransceiver('video', { direction: 'recvonly' })

      pc.ontrack = (e) => {
        if (videoRef.current && e.streams[0]) {
          videoRef.current.srcObject = e.streams[0]
          setStreamActive(true)
        }
      }

      // Watch the connection for the whole session, not just through
      // negotiation. Everything above this runs once and returns; without this
      // handler a stream that dies after going live leaves the tile showing a
      // green `live` pill over a frozen frame, and no error path ever fires.
      pc.onconnectionstatechange = () => {
        // A state change on a connection we have already replaced or closed is
        // not this tile's business.
        if (pcRef.current !== pc) return

        switch (healthAction(pc.connectionState)) {
          case 'fail-now':
            clearGrace()
            setStreamActive(false)
            setStreamError('Connection failed')
            break
          case 'watch':
            // May self-heal. Only call it a failure if it is still down when the
            // grace period expires.
            if (graceTimer.current) break
            graceTimer.current = setTimeout(() => {
              graceTimer.current = null
              if (pcRef.current !== pc) return
              if (pc.connectionState === 'connected') return
              setStreamActive(false)
              setStreamError('Connection lost')
            }, DISCONNECT_GRACE_MS)
            break
          case 'recovered':
            clearGrace()
            break
        }
      }

      const offer = await pc.createOffer({ offerToReceiveVideo: true, offerToReceiveAudio: false })
      await pc.setLocalDescription(offer)

      // Wait for ICE gathering
      await new Promise<void>((resolve) => {
        if (pc.iceGatheringState === 'complete') return resolve()
        const timeout = setTimeout(() => resolve(), 3000)
        pc.onicegatheringstatechange = () => {
          if (pc.iceGatheringState === 'complete') {
            clearTimeout(timeout)
            resolve()
          }
        }
      })

      const res = await fetch('/api/ring/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sdpOffer: pc.localDescription!.sdp, deviceId }),
      })

      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error || 'Stream start failed')
      }

      const { sdpAnswer, sessionUrl } = await res.json()
      sessionUrlRef.current = sessionUrl
      await pc.setRemoteDescription({ type: 'answer', sdp: sdpAnswer })
      watchForStall(pc)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Stream failed'
      console.error('Stream error:', err)
      setStreamError(message)
      setStreamActive(false)
    }
  }, [videoRef, deviceId, clearGrace, clearStall, watchForStall])

  const stopStream = useCallback(async () => {
    // Before close(), so the grace timer cannot outlive the connection and
    // report "Connection lost" on a tile the user deliberately stopped.
    clearGrace()
    clearStall()
    pcRef.current?.close()
    pcRef.current = null
    if (sessionUrlRef.current) {
      await fetch('/api/ring/stream', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionUrl: sessionUrlRef.current }),
        keepalive: true,
      }).catch(() => {})
      sessionUrlRef.current = null
    }
    if (videoRef.current) videoRef.current.srcObject = null
    setStreamActive(false)
    setStreamError(null)
  }, [videoRef, clearGrace, clearStall])

  return { streamActive, streamError, startStream, stopStream }
}
