import { render, screen, waitFor, cleanup } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { VideoWall } from './VideoWall'

// Stub CameraTile so the wall test does not touch WebRTC.
vi.mock('./CameraTile', () => ({
  CameraTile: ({ device }: any) => <div data-testid="tile">{device.name}</div>,
}))

function mockDevices(payload: any, ok = true) {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok, json: async () => payload })))
}

afterEach(() => { vi.unstubAllGlobals(); cleanup() })

describe('VideoWall', () => {
  it('renders one tile per discovered device', async () => {
    mockDevices({ devices: [
      { id: 'd1', name: 'Front Door', online: true, capabilities: {} },
      { id: 'd2', name: 'Garage', online: true, capabilities: {} },
    ] })
    render(<VideoWall />)
    await waitFor(() => expect(screen.getAllByTestId('tile')).toHaveLength(2))
    expect(screen.getByText('Front Door')).toBeInTheDocument()
    expect(screen.getByText('Garage')).toBeInTheDocument()
  })

  it('shows the empty state when no devices are returned', async () => {
    mockDevices({ devices: [] })
    render(<VideoWall />)
    await waitFor(() => expect(screen.getByText(/no cameras/i)).toBeInTheDocument())
  })

  it('shows the error state when the payload carries an error', async () => {
    mockDevices({ devices: [], error: 'token expired' })
    render(<VideoWall />)
    await waitFor(() => expect(screen.getByText(/token expired/i)).toBeInTheDocument())
  })
})
