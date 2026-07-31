import { render, screen, cleanup } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { CameraTile } from './CameraTile'

const startStream = vi.fn(async () => {})
const stopStream = vi.fn(async () => {})
let mockReturn: any

vi.mock('../hooks/useWebRTCStream', () => ({
  useWebRTCStream: () => mockReturn,
}))

beforeEach(() => {
  startStream.mockClear(); stopStream.mockClear()
  mockReturn = { streamActive: false, streamError: null, startStream, stopStream }
})
afterEach(cleanup)

describe('CameraTile', () => {
  it('renders the camera name label', () => {
    render(<CameraTile device={{ id: 'd1', name: 'Front Door', online: true }} />)
    expect(screen.getByText('Front Door')).toBeInTheDocument()
  })

  it('starts the stream on mount', () => {
    render(<CameraTile device={{ id: 'd1', name: 'Front Door', online: true }} />)
    expect(startStream).toHaveBeenCalledOnce()
  })

  it('stops the stream on unmount', () => {
    const { unmount } = render(<CameraTile device={{ id: 'd1', name: 'Front Door', online: true }} />)
    unmount()
    expect(stopStream).toHaveBeenCalledOnce()
  })

  it('shows a live badge when the stream is active', () => {
    mockReturn = { streamActive: true, streamError: null, startStream, stopStream }
    render(<CameraTile device={{ id: 'd1', name: 'Front Door', online: true }} />)
    expect(screen.getByText('live')).toBeInTheDocument()
  })

  it('shows an error badge when the stream errors', () => {
    mockReturn = { streamActive: false, streamError: 'boom', startStream, stopStream }
    render(<CameraTile device={{ id: 'd1', name: 'Front Door', online: true }} />)
    expect(screen.getByText('error')).toBeInTheDocument()
  })
})
