'use client'

import { useEffect, useRef } from 'react'
import { useWebRTCStream } from '../hooks/useWebRTCStream'

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

  useEffect(() => {
    startStream()
    const onPageHide = () => { stopStream() }
    window.addEventListener('pagehide', onPageHide)
    return () => {
      window.removeEventListener('pagehide', onPageHide)
      stopStream()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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
        {status}
      </div>
    </div>
  )
}
