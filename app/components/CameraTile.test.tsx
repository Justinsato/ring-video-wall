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

  it('shows the retry progress when an ONLINE stream errors', () => {
    // Was asserting a bare 'error' pill. An online tile now reconnects, so the
    // pill reports which attempt it is on; a static 'error' would hide the fact
    // that recovery is in progress.
    mockReturn = { streamActive: false, streamError: 'boom', startStream, stopStream }
    render(<CameraTile device={{ id: 'd1', name: 'Front Door', online: true }} />)
    expect(screen.getByText('retrying 1/5')).toBeInTheDocument()
  })

  it('shows a plain error badge for an OFFLINE device, which is not retried', () => {
    mockReturn = { streamActive: false, streamError: 'boom', startStream, stopStream }
    render(<CameraTile device={{ id: 'd1', name: 'Front Door', online: false }} />)
    expect(screen.getByText('error')).toBeInTheDocument()
    expect(screen.queryByText(/retrying/)).not.toBeInTheDocument()
  })

  it('closes the stream on pagehide (tab close)', () => {
    render(<CameraTile device={{ id: 'd1', name: 'Front Door', online: true }} />)
    stopStream.mockClear()
    window.dispatchEvent(new Event('pagehide'))
    expect(stopStream).toHaveBeenCalledOnce()
  })
})

// Reconnect. The tile is the only thing standing between a transient failure and
// a dead square on the wall until someone reloads the page.
describe('CameraTile reconnect', () => {
  const online = { id: 'd1', name: 'Front Door', online: true }
  const errored = () => { mockReturn = { streamActive: false, streamError: 'boom', startStream, stopStream } }

  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('waits out the backoff before the first retry', async () => {
    errored()
    render(<CameraTile device={online} />)
    startStream.mockClear(); stopStream.mockClear()

    await vi.advanceTimersByTimeAsync(1999)
    expect(startStream).not.toHaveBeenCalled()   // 2s backoff not yet elapsed

    await vi.advanceTimersByTimeAsync(1)
    expect(startStream).toHaveBeenCalledOnce()
  })

  it('tears the old session down before reconnecting, so Ring sessions do not leak', async () => {
    errored()
    render(<CameraTile device={online} />)
    startStream.mockClear(); stopStream.mockClear()

    await vi.advanceTimersByTimeAsync(2000)
    expect(stopStream).toHaveBeenCalled()
    // Order matters: reconnecting without the DELETE strands a session per attempt.
    expect(stopStream.mock.invocationCallOrder[0])
      .toBeLessThan(startStream.mock.invocationCallOrder[0])
  })

  it('backs off further on each successive failure', async () => {
    errored()
    render(<CameraTile device={online} />)
    startStream.mockClear()

    await vi.advanceTimersByTimeAsync(2000)   // attempt 1
    expect(startStream).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(3999)   // 4s gap, not another 2s
    expect(startStream).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(startStream).toHaveBeenCalledTimes(2)
  })

  it('gives up after five attempts and offers a manual retry', async () => {
    errored()
    render(<CameraTile device={online} />)
    startStream.mockClear()

    await vi.advanceTimersByTimeAsync(120_000)   // past 2+4+8+16+30
    expect(startStream).toHaveBeenCalledTimes(5)
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument()

    // And it stays given up rather than creeping on.
    await vi.advanceTimersByTimeAsync(120_000)
    expect(startStream).toHaveBeenCalledTimes(5)
  })

  it('does not start a stream when the tile unmounts mid-teardown', async () => {
    // The async gap: reconnect() awaits stopStream(), and the tile can be torn
    // down during that await. Without the guard, startStream() then runs and
    // opens a Ring session for a component that no longer exists — invisible in
    // the UI and never closed.
    let releaseStop!: () => void
    stopStream.mockImplementationOnce(() => new Promise<void>((r) => { releaseStop = () => r() }))
    errored()
    const { unmount } = render(<CameraTile device={online} />)
    startStream.mockClear()

    await vi.advanceTimersByTimeAsync(2000)   // retry fires, now parked in stopStream
    expect(startStream).not.toHaveBeenCalled()

    unmount()
    releaseStop()
    await vi.advanceTimersByTimeAsync(0)

    expect(startStream).not.toHaveBeenCalled()
  })

  it('never retries an offline device', async () => {
    errored()
    render(<CameraTile device={{ ...online, online: false }} />)
    startStream.mockClear()
    await vi.advanceTimersByTimeAsync(120_000)
    expect(startStream).not.toHaveBeenCalled()
  })

  it('cancels a pending retry on unmount', async () => {
    errored()
    const { unmount } = render(<CameraTile device={online} />)
    startStream.mockClear()

    // Assert the timer itself, not just the absence of a call. `startStream was
    // not called` passes for many uninteresting reasons — the timer never being
    // scheduled at all, for one — so on its own it cannot tell a working
    // cancellation from a test that exercises nothing.
    expect(vi.getTimerCount()).toBe(1)
    unmount()
    expect(vi.getTimerCount()).toBe(0)

    // A timer left armed reconnects a tile that is gone, opening a Ring session
    // nothing will ever close.
    await vi.advanceTimersByTimeAsync(120_000)
    expect(startStream).not.toHaveBeenCalled()
  })
})
