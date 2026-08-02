'use client'

import { useEffect, useState } from 'react'
import { CameraTile, CameraTileDevice } from './CameraTile'

type WallState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; devices: CameraTileDevice[] }

export function VideoWall() {
  const [state, setState] = useState<WallState>({ status: 'loading' })

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch('/api/ring/devices')
        const data = await res.json()
        if (cancelled) return
        if (!res.ok || data.error) {
          setState({ status: 'error', message: data.error || `Request failed (${res.status})` })
          return
        }
        setState({ status: 'ready', devices: data.devices ?? [] })
      } catch (err) {
        if (!cancelled) {
          setState({ status: 'error', message: err instanceof Error ? err.message : 'Failed to load cameras' })
        }
      }
    })()
    return () => { cancelled = true }
  }, [])

  if (state.status === 'loading') {
    return <p className="p-8 text-gray-400">Loading cameras…</p>
  }
  if (state.status === 'error') {
    return <p className="p-8 text-red-400">Error: {state.message}</p>
  }
  if (state.devices.length === 0) {
    return <p className="p-8 text-gray-400">No cameras available.</p>
  }

  return (
    <div className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {state.devices.map((device) => (
        <CameraTile key={device.id} device={device} />
      ))}
    </div>
  )
}
