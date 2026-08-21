# Ring API Hello World

Get started with the [Ring Partner API](https://developer.amazon.com/docs/ring/api-documentation.html) — explore device APIs from your terminal and stream live video in your browser.

![Next.js](https://img.shields.io/badge/Next.js-16-black)
![TypeScript](https://img.shields.io/badge/TypeScript-5-blue)
![Python](https://img.shields.io/badge/Python-3.8+-blue)

---

## This fork: BroadwayVideoWall

A fork of [AmazonAppDev/ring-api-helloworld](https://github.com/AmazonAppDev/ring-api-helloworld)
that adds a **multi-camera video wall**. The upstream sample streams
`devices[0]` only, behind a "Start Live Stream" button. This renders every camera
on the account at once, each in its own tile, each holding its own WHEP session.

Everything below this section is the upstream documentation and still applies:
you need a Ring token the same way, and setup is unchanged.

<!-- Demo GIF: drop the file at docs/demo.gif and uncomment the line below.
     Deliberately not committed — recording the wall records live camera footage
     and this repo is public. See docs/capture-demo.md for the capture recipe,
     including a synthetic-source option that exposes nothing.
![The video wall: tiles going connecting -> live, one tile erroring and reconnecting](docs/demo.gif)
-->

### What it does

Open the app and the wall loads. `GET /api/ring/devices` returns the account's
devices, and each one becomes a tile that starts streaming on mount. No clicking
through cameras one at a time.

Tiles lay out responsively: one column on mobile, two at `sm`, three at `lg`,
four at `xl`. Each tile is 16:9 and shows the device name plus a status pill:

| Pill | Meaning |
|------|---------|
| `live` (green) | track received, video is playing |
| `connecting` (yellow) | negotiating, or waiting on the first frame |
| `offline` (grey) | the device reported itself offline |
| `error` (red) | negotiation or the stream request failed |

A tile that fails does not take the wall down. Each one owns its own connection
and its own error state, so one dead camera shows red and the rest keep running.

### How a tile streams

`useWebRTCStream` owns one `RTCPeerConnection` per tile:

1. Adds a **recvonly video** transceiver. Audio is never requested
   (`offerToReceiveAudio: false`), so this is a video-only wall by design.
2. Creates the offer, then waits for ICE gathering to complete, with a 3-second
   timeout so a stalled candidate search cannot hang the tile forever. STUN is
   Google's public servers.
3. `POST /api/ring/stream` with the SDP offer and the device id, then applies the
   returned `sdpAnswer` and keeps the `sessionUrl`.

Teardown is the part worth reading. Ring sessions do not clean themselves up, so
a closed tab would otherwise leave sessions open server-side. `stopStream` closes
the peer connection and sends `DELETE /api/ring/stream` with **`keepalive: true`**,
which is what lets the request survive the page going away. It is wired to both
React unmount and the `pagehide` event, because unmount alone does not fire on a
tab close.

### Files this fork adds

| Path | Role |
|------|------|
| `app/components/VideoWall.tsx` | fetches devices, renders the responsive grid |
| `app/components/CameraTile.tsx` | one camera: video element, name, status pill, lifecycle |
| `app/hooks/useWebRTCStream.ts` | one WHEP session: negotiation, ICE, cleanup |
| `app/lib/retry.ts` | reconnect backoff and the retry predicate |
| `app/lib/connection-health.ts` | what a connection state change means |
| `app/lib/stall.ts` | decoder-progress stall detection |
| `vitest.config.ts`, `test/setup.ts` | test harness |

### Tests

```bash
npx vitest run     # 61 tests across 6 files
```

What they actually assert: the offer adds a recvonly video transceiver and **no**
audio transceiver, the SDP offer and device id are POSTed to
`/api/ring/stream`, `stopStream` DELETEs the session, that DELETE is marked
`keepalive`, the stream starts on mount and stops on both unmount and
`pagehide`, one tile renders per discovered device, and the empty and error
states render.

The ICE wait has its own pair, because it is the one place the hook can hang: one
proves the 3-second fallback releases a gathering that never completes, the other
proves the offer goes out on the `icegatheringstatechange` event without the
clock ever reaching 3000. Both were mutation-checked — killing the timeout fails
only the first, killing the event handler fails only the second.

The `offline` and `connecting` pill states are still uncovered.

### Reconnect

A tile that fails reconnects on its own: 2s, 4s, 8s, 16s, then 30s, five attempts,
and the pill reports which attempt it is on. Reaching `live` resets the counter, so
the next outage starts from 2s instead of inheriting a long delay. After five it
stops and shows the error with a Retry button.

Two things it is careful about, both tested:

- **It tears the old session down first.** Ring does not reap sessions, so calling
  `startStream` again without the `DELETE` strands one server-side session per
  attempt.
- **An offline device is never retried.** That failure is not transient, and five
  attempts per offline camera is load for nothing.

The cap on the backoff matters on a large account: N tiles retry independently, so
an uncapped curve becomes a slow thundering herd against the Ring API.

### Detecting a stream that dies quietly

Negotiation succeeding is not the same as the stream staying up. `startStream`
returns as soon as the answer is applied, so a session that dies afterwards used
to leave the tile on a green `live` pill in front of a frozen last frame — the
worst state to be in, because nothing looks wrong.

`onconnectionstatechange` is now watched for the life of the session, and the two
bad states are handled differently:

| State | Treatment |
|-------|-----------|
| `failed` | terminal. ICE is out of candidates and will not recover without a restart, so it errors immediately and the reconnect takes over |
| `disconnected` | given 5 seconds. A wifi handoff or NAT rebind routinely returns to `connected` on its own, and tearing down on sight turns a two-second blip into a full renegotiation across every tile |
| `connected` | cancels a pending failure |
| `closed` | ignored — that is our own `stopStream`, and treating it as a fault would make every deliberate stop trigger a reconnect |

Late events from a connection already replaced or closed are dropped, so a
reconnect cannot be triggered by the session it just tore down.

That covers the transport. The picture is a separate problem: a session can hold
at `connected` with a healthy ICE pair while frames stop arriving, because the
encoder wedged or the camera rebooted. So `getStats()` is polled every 2 seconds
and `framesDecoded` on the inbound video stream is checked for progress. Three
consecutive flat samples, about 6 seconds of frozen picture, is a stall.

Why it is built the way it is:

- **Three strikes, not one.** A single flat sample is a GC pause or a slow
  report, and taking a working tile down over one is worse than the stall.
- **Missing stats are not a stall.** No inbound-rtp row, no `framesDecoded`
  field, or a `getStats()` rejection all mean *no news* and leave the strike
  count alone. Counting them as evidence would fire on any browser that
  publishes stats late, and on every connection in the middle of closing.
- **It strikes from zero.** A track that has produced no frames 6 seconds after
  `ontrack` fired is as broken as one that froze. Treating "never started" as a
  special case is how that goes unreported.
- **A counter going backwards is a new track, not a freeze.** The browser resets
  `framesDecoded`, so it re-baselines instead of striking.
- **Audio is ignored.** It decodes happily while the picture is frozen, which is
  exactly the case this exists to catch.

A declared stall stops the polling and sets the error, which hands off to the
same reconnect path as any other failure.

### Dependency posture

`npm audit` reports zero advisories. Getting there was mostly deletion rather
than version bumps, and the chain is worth recording because each removal
unblocked the next:

| Removed | Why it could go | What it cleared |
|---|---|---|
| `onnxruntime-web` | imported nowhere | both `protobufjs` advisories, 141MB |
| the `webpack` block in `next.config.js` | it stubbed `fs`/`path`/`crypto` for the browser, the standard onnxruntime workaround | Next 16's Turbopack default, which was failing the build on it |
| `null-loader` | only existed for that webpack block | 72 packages |
| `@vitejs/plugin-react` | vitest 4 transforms the JSX itself | the last `vite` and `esbuild` advisories |

Next 16 then patched `next` plus the `postcss` and `sharp` it bundles, which no
15.x release could. vitest 4 cleared the critical advisory in the test runner.

Two things to know if you touch the test setup:

- **A `vi.fn()` mock used with `new` must be a `function`, not an arrow.** vitest
  4 requires a constructible implementation. Under an arrow the returned object
  is discarded and every test touching the fake `RTCPeerConnection` fails on
  `Cannot read properties of undefined`.
- **`tsconfig.json` now has `jsx: "react-jsx"`**, set by Next 16 itself. It used
  to be `preserve`, which vitest 4's rolldown transform cannot parse. The
  upgrade order matters: Next 16 before vitest 4, not the other way round.

### Known limits

- **Video only.** No audio track is requested anywhere.
- **Every camera starts at once.** N cameras means N concurrent WHEP sessions
  from one browser. Fine for a handful; untested at large device counts.
- **Reconnect is bounded.** Five automatic attempts, then the tile waits for a
  click. It does not keep trying forever, because the Ring token expires in about
  30 minutes and retrying past that is pure load.

---

## What's Inside

| Path | What it does | You need |
|------|-------------|----------|
| `scripts/` | Python scripts to call Ring APIs from your terminal | Python 3.8+ and a token |
| `app/` | Next.js web app with live video streaming and real-time event dashboard | Node.js 18+ and a token |

---

> 🚀 **Coming from the [Ring Developer Playground](https://developer.amazon.com/ring/console/playground)?**
>
> You already have a token — jump straight to:
> - **[Explore APIs from your terminal →](#step-2-explore-apis-python-scripts)** (Python, no web app needed)
> - **[Live stream in your browser →](#step-3-live-video-stream-web-app)** (Node.js, one command)

---

## Step 1: Get Your Token

1. Go to the [Ring Developer Playground](https://developer.amazon.com/ring/console/playground)
2. Click **Generate Token**
3. Copy the access token

The Playground gives you a short-lived access token (~30 minutes) that works with all Ring APIs. No app registration, OAuth setup, or client credentials needed — just the token.

> **Note:** When the token expires, return to the Playground and generate a fresh one.

---

## Step 2: Explore APIs (Python Scripts)

Call any Ring API directly from your terminal. Each script is a self-contained code snippet you can copy into your own project.

### Setup

```bash
cd scripts
pip install -r requirements.txt
```

### Usage

Run the interactive explorer:

```bash
python explore_apis.py --token "eyJ..."
```

This shows a menu where you pick which API to call:

```
=== Ring API Explorer ===
Use your token to call any Ring API.

1. List Devices
2. Device Status
3. Device Capabilities
4. Device Location
5. Device Configurations
6. Event History
7. User Profile
8. Run All
0. Exit

Select an API to call:
```

Or run individual scripts directly:

```bash
# List all your devices
python list_devices.py --token "eyJ..."

# Check if a device is online
python device_status.py --token "eyJ..." --device-id "ava1.ring.device.XXX"

# Get device capabilities (video codecs, motion detection, etc.)
python device_capabilities.py --token "eyJ..." --device-id "ava1.ring.device.XXX"

# Get device location (country/state)
python device_location.py --token "eyJ..." --device-id "ava1.ring.device.XXX"

# Get device configurations (motion zones, privacy zones)
python device_configurations.py --token "eyJ..." --device-id "ava1.ring.device.XXX"

# Get event history (motion events, doorbell presses, live views)
python event_history.py --token "eyJ..." --device-id "ava1.ring.device.XXX"

# Get your user profile
python user_profile.py --token "eyJ..."
```

> **Tip:** If you don't pass `--device-id`, scripts that need one will auto-discover your first device.

Each script prints the equivalent `curl` command so you can copy it into Postman, your own code, or any HTTP client:

```
→ GET https://api.amazonvision.com/v1/devices
  curl -X GET "https://api.amazonvision.com/v1/devices" \
    -H "Authorization: Bearer $TOKEN"
```

### Available Scripts

| Script | API Endpoint | Description |
|--------|-------------|-------------|
| `list_devices.py` | `GET /v1/devices` | List all accessible devices |
| `device_status.py` | `GET /v1/devices/{id}/status` | Check if device is online/offline |
| `device_capabilities.py` | `GET /v1/devices/{id}/capabilities` | Video codecs, motion detection, image enhancements |
| `device_location.py` | `GET /v1/devices/{id}/location` | Country and state (for compliance) |
| `device_configurations.py` | `GET /v1/devices/{id}/configurations` | Motion zones, privacy zones, image settings |
| `event_history.py` | `GET /v1/history/devices/{id}/events` | Past motion, doorbell, and live view events |
| `user_profile.py` | `GET /v1/users/me` | Your Ring account ID, name, and email |
| `explore_apis.py` | All of the above | Interactive menu to call any API |

---

## Step 3: Live Video Stream (Web App)

Stream live video from a Ring device directly in your browser using WebRTC.

### Setup

```bash
# Install dependencies
npm install

# Create your environment file
cp .env.example .env.local
```

Edit `.env.local` and paste your token from Step 1:

```env
RING_ACCESS_TOKEN=eyJ...paste_your_token_here
```

### Run

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

The app will:
1. Auto-discover devices associated with your token
2. Show a **Start Live Stream** button
3. Click it to begin a WebRTC live video stream from your Ring device

When the token expires, paste a fresh one from the Playground into `.env.local` and restart the server.

---

## Advanced: Full Dashboard (Refresh Token Mode)

For production integrations with long-lived sessions, the app supports OAuth refresh tokens with auto-renewal. This mode shows the full dashboard including webhook events, video processors, and canvas overlays.

### Setup

```env
RING_REFRESH_TOKEN=your_refresh_token_here
RING_CLIENT_ID=your_client_id_here
RING_CLIENT_SECRET=your_client_secret_here
```

All three variables are required. The app automatically refreshes the access token when it expires.

See [Authentication](https://developer.amazon.com/docs/ring/authentication.html) for how to obtain refresh tokens through the OAuth account linking flow, and [Configure Your Ring Application](https://developer.amazon.com/docs/ring/app-registration.html) for how to get your client credentials.

### Device ID (Optional)

```env
NEXT_PUBLIC_RING_DEVICE_ID=your_device_id_here
```

If set, the app uses this device directly instead of auto-discovering.

### Important

Do not set both `RING_ACCESS_TOKEN` and `RING_REFRESH_TOKEN` — the app will show a configuration error. Use one or the other.

---

## Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `RING_ACCESS_TOKEN` | Access token from the [Playground](https://developer.amazon.com/ring/console/playground) | Yes (if not using refresh token) |
| `RING_REFRESH_TOKEN` | OAuth refresh token from [account linking](https://developer.amazon.com/docs/ring/authentication.html) | Yes (if not using access token) |
| `RING_CLIENT_ID` | OAuth client ID from [app registration](https://developer.amazon.com/docs/ring/app-registration.html) | Yes (only with refresh token) |
| `RING_CLIENT_SECRET` | OAuth client secret from [app registration](https://developer.amazon.com/docs/ring/app-registration.html) | Yes (only with refresh token) |
| `NEXT_PUBLIC_RING_DEVICE_ID` | Device ID (skips auto-discovery) | No |
| `NEXT_PUBLIC_RING_DEVICE_NAME` | Display name for the device | No |
| `RING_WEBHOOK_SECRET` | Bearer token for [webhook auth](https://developer.amazon.com/docs/ring/notifications.html) | No |

---

## Features

### Access Token Mode (Playground)
- **Live Video Streaming** — WebRTC-based low-latency video from Ring devices
- **Auto Device Discovery** — Automatically finds devices linked to your token
- **Simplified UI** — Full-screen live view, no distractions

### Refresh Token Mode (Production)
- Everything above, plus:
- **Webhook Events** — Real-time SSE for Ring camera webhooks (motion, doorbell, etc.)
- **Video Processors** — Plugin system for real-time video analysis
- **Hand Tracking Game** — Catch-the-box game using MediaPipe hand detection
- **Canvas Overlays** — Bounding boxes, heatmaps, and visual effects

---

## Architecture

```
scripts/
├── explore_apis.py            # Interactive API explorer
├── list_devices.py            # GET /v1/devices
├── device_status.py           # GET /v1/devices/{id}/status
├── device_capabilities.py     # GET /v1/devices/{id}/capabilities
├── device_location.py         # GET /v1/devices/{id}/location
├── device_configurations.py   # GET /v1/devices/{id}/configurations
├── event_history.py           # GET /v1/history/devices/{id}/events
├── user_profile.py            # GET /v1/users/me
└── requirements.txt           # Python dependencies

app/
├── page.tsx                   # Main dashboard
├── components/                # UI components
├── hooks/
│   ├── useWebRTCStream.ts     # WebRTC connection management
│   ├── useEventStream.ts      # SSE with auto-reconnect
│   └── useCanvasOverlay.ts    # Optimized render loop
└── api/
    ├── webhook/               # Webhook receiver + SSE endpoint
    └── ring/                  # Ring API integration
        ├── config/            # Auth mode detection
        ├── devices/           # Device discovery + status
        ├── stream/            # WebRTC WHEP live streaming
        ├── events/            # Event history
        └── token/             # Token info

lib/
├── auth.ts                    # Token management (access token / refresh token)
├── video-processors/          # Plugin system for video analysis
├── schemas/                   # Zod validation schemas
└── sse-broadcast.ts           # SSE client management
```

---

## Video Processors

Built-in processors (available in refresh token mode):

| Processor | Description |
|-----------|-------------|
| 🎯 Catch the Logo | Hand-tracking game with fire effects |
| 🌡️ Motion Heatmap | Visualizes motion as color overlay |
| 💡 Brightness Analyzer | Analyzes frame brightness levels |

### Creating Custom Processors

```typescript
import {VideoProcessor, ProcessorResult} from './types';
import {processorRegistry} from './registry';

class MyProcessor implements VideoProcessor {
  id = 'my-processor';
  name = 'My Processor';
  description = 'Does something cool';
  enabled = false;

  async process(
    frame: ImageData,
    canvas: HTMLCanvasElement,
    video: HTMLVideoElement,
  ): Promise<ProcessorResult | null> {
    return {
      id: `my-${Date.now()}`,
      processorId: this.id,
      timestamp: Date.now(),
      data: {},
      boundingBoxes: [{x: 0, y: 0, width: 100, height: 100, label: 'Detected'}],
    };
  }
}

processorRegistry.register(new MyProcessor());
```

See [docs/video-processors.md](docs/video-processors.md) for the complete guide.

---

## Webhook Integration

Available in refresh token mode. The dashboard receives webhook events via POST and broadcasts them to connected clients via SSE.

```bash
# Send a test event
curl -X POST http://localhost:3000/api/webhook \
  -H "Content-Type: application/json" \
  -d '{"event_type": "motion_detected", "device_id": "camera-1"}'
```

Configure your Ring webhook to POST to `/api/webhook`. Set `RING_WEBHOOK_SECRET` in `.env.local` for authentication.

---

## API Reference

For full API documentation:
- [Ring Partner API Documentation](https://developer.amazon.com/docs/ring/api-documentation.html)
- [Live Video Streaming (WHEP)](https://developer.amazon.com/docs/ring/live-video.html)
- [Device Discovery](https://developer.amazon.com/docs/ring/device-discovery.html)
- [Authentication Guide](https://developer.amazon.com/docs/ring/authentication.html)

---

## Tech Stack

- **Scripts**: Python 3.8+ with `requests`
- **Web App**: Next.js 14 (App Router), TypeScript, Tailwind CSS
- **Video**: WebRTC (WHEP protocol), MediaPipe Hands
- **Validation**: Zod
- **Events**: Server-Sent Events (SSE)

---

## Development

```bash
# Run web app with hot reload
npm run dev

# Type checking
npx tsc --noEmit

# Build for production
npm run build
```

---

## License

[MIT](LICENSE)
