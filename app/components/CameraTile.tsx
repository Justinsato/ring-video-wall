'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useWebRTCStream } from '../hooks/useWebRTCStream'
import { RETRY_MAX_ATTEMPTS, retryDelayMs, shouldRetry } from '../lib/retry'

export interface CameraTileDevice {
  id: string
  name: string
  online: boolean
}

function statusLabel(active: boolean, error: string | null, online: boolean): string {
  if (error) return 'error'
  if (active) return 'live'
  if (!online) return 'offline'
  return 'connecting'
}

export function CameraTile({ device }: { device: CameraTileDevice }) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const { streamActive, streamError, startStream, stopStream } = useWebRTCStream({
    videoRef,
    deviceId: device.id,
  })
  const [attempts, setAttempts] = useState(0)
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const unmounted = useRef(false)

  useEffect(() => {
    startStream()
    const onPageHide = () => { stopStream() }
    window.addEventListener('pagehide', onPageHide)
    return () => {
      unmounted.current = true
      window.removeEventListener('pagehide', onPageHide)
      stopStream()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // A tile that reaches `live` has recovered, so the next failure starts its own
  // backoff from 2s rather than inheriting a long delay from an old outage.
  useEffect(() => {
    if (streamActive) setAttempts(0)
  }, [streamActive])

  // Reconnect. stopStream() first, not startStream() alone: the failed attempt
  // may already hold a Ring session, and Ring does not reap them, so retrying
  // without tearing down leaks one server-side session per attempt.
  //
  // The unmounted check is not redundant with the timer cancellation: stopStream()
  // is awaited, so the tile can be torn down during that await and startStream()
  // would then open a session on a component that no longer exists.
  const reconnect = useCallback(async () => {
    await stopStream()
    if (unmounted.current) return
    await startStream()
  }, [startStream, stopStream])

  useEffect(() => {
    if (!shouldRetry({ error: streamError, online: device.online, attempts })) return
    if (retryTimer.current) return   // one retry in flight at a time

    const delay = retryDelayMs(attempts + 1)
    retryTimer.current = setTimeout(() => {
      retryTimer.current = null
      setAttempts((n) => n + 1)
      void reconnect()
    }, delay)

    return () => {
      if (retryTimer.current) {
        clearTimeout(retryTimer.current)
        retryTimer.current = null
      }
    }
  }, [streamError, device.online, attempts, reconnect])

  // Retrying, per the same predicate that schedules the retry. Deriving the
  // label separately let the pill read "retrying 1/5" over an offline device
  // that shouldRetry() had already excluded, so the UI promised something that
  // was never going to happen.
  const retrying = shouldRetry({ error: streamError, online: device.online, attempts })
  const exhausted = Boolean(streamError) && device.online && attempts >= RETRY_MAX_ATTEMPTS
  const manualRetry = useCallback(() => {
    if (retryTimer.current) {
      clearTimeout(retryTimer.current)
      retryTimer.current = null
    }
    setAttempts(0)
    void reconnect()
  }, [reconnect])

  const status = statusLabel(streamActive, streamError, device.online)

  return (
    <div className="relative aspect-video overflow-hidden rounded-lg bg-black">
      <video
        ref={videoRef}
        autoPlay
        muted
        playsInline
        className="h-full w-full object-cover"
      />
      <div className="absolute left-2 top-2 rounded bg-black/60 px-2 py-1 text-xs font-medium text-white">
        {device.name}
      </div>
      <div
        className={
          'absolute right-2 top-2 rounded px-2 py-1 text-xs font-semibold ' +
          (status === 'live'
            ? 'bg-green-600 text-white'
            : status === 'error'
            ? 'bg-red-600 text-white'
            : status === 'offline'
            ? 'bg-gray-600 text-white'
            : 'bg-yellow-500 text-black')
        }
      >
        {retrying ? `retrying ${attempts + 1}/${RETRY_MAX_ATTEMPTS}` : status}
      </div>

      {/* Only once the automatic attempts are spent. Offering this while a retry
          is already scheduled invites double-negotiation for no benefit. */}
      {exhausted && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/70">
          <p className="px-4 text-center text-xs text-white">{streamError}</p>
          <button
            type="button"
            onClick={manualRetry}
            className="rounded bg-white px-3 py-1 text-xs font-semibold text-black hover:bg-gray-200"
          >
            Retry
          </button>
        </div>
      )}
    </div>
  )
}
