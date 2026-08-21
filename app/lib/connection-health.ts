/**
 * What to do about an RTCPeerConnection state change.
 *
 * The gap this closes: negotiation can succeed, the tile can go `live`, and the
 * media can then stop arriving without any of the existing error paths firing.
 * `startStream` already returned, so its catch is long gone, and nothing was
 * watching the connection afterwards. The tile sat on a green `live` pill in
 * front of a frozen last frame, which is worse than showing an error.
 *
 * `disconnected` and `failed` are deliberately NOT treated the same:
 *
 *   disconnected  ICE lost its path. This frequently self-heals within a few
 *                 seconds — a wifi handoff, a brief NAT rebind — and the browser
 *                 returns to `connected` on its own. Tearing the session down on
 *                 sight would turn a two-second blip into a full renegotiation,
 *                 and on a wall of tiles that is a lot of churn for nothing.
 *   failed        ICE is out of candidates. It does not recover without an ICE
 *                 restart, so waiting out a grace period only delays the retry.
 *
 * `closed` is our own teardown and must never register as a fault, or every
 * stopStream() would look like a failure and trigger a reconnect.
 */
export const DISCONNECT_GRACE_MS = 5_000

export type HealthAction =
  | 'fail-now'    // terminal; surface the error immediately
  | 'watch'       // may recover; start the grace timer
  | 'recovered'   // healthy again; cancel any grace timer
  | 'ignore'      // nothing to do

export function healthAction(state: RTCPeerConnectionState): HealthAction {
  switch (state) {
    case 'failed':
      return 'fail-now'
    case 'disconnected':
      return 'watch'
    case 'connected':
      return 'recovered'
    // 'new', 'connecting' and 'closed' all mean "not a fault".
    default:
      return 'ignore'
  }
}
