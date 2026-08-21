# Recording the demo GIF

The README has a slot for `docs/demo.gif`. It is deliberately empty in the repo:
recording the wall means recording live camera footage, and this repo is public.
Point the cameras somewhere you are happy for the internet to see, or use the
synthetic option below.

## Option A — your own cameras

```bash
echo "RING_ACCESS_TOKEN=..." > .env.local     # token from the Playground, ~30 min life
npm run dev                                    # http://localhost:3000
```

Record the viewport, not the whole screen, so no other window leaks in:

```bash
# macOS, 12s at 15fps, 1280x720 region starting at 0,0 — adjust with `-i "1:"` list
ffmpeg -f avfoundation -framerate 15 -video_size 1280x720 -i "1:" -t 12 raw.mov

# raw.mov -> a README-sized gif. gifski beats ffmpeg's palettegen for gradients.
ffmpeg -i raw.mov -vf "fps=12,scale=900:-1:flags=lanczos" -f image2 frames/%04d.png
gifski --fps 12 --width 900 --quality 80 -o docs/demo.gif frames/*.png
```

Keep it under ~4MB. GitHub serves larger files but they will not autoplay for
anyone on a slow connection, which defeats the point.

## Option B — synthetic sources, nothing private

Shows the layout, the status pills and the reconnect behaviour without pointing a
real camera at anything. Label it as synthetic in the README caption if you use
it, so nobody reads it as live output.

1. Serve four test patterns as WHEP endpoints (`ffmpeg -f lavfi -i testsrc2`
   into any WHEP-capable server, e.g. MediaMTX).
2. Point `app/api/ring/devices` at a fixture list of four devices.
3. Record as above.

## What the shot should actually show

In order, because the README claims all four:

1. the grid filling in, tiles going `connecting` -> `live`
2. one tile in `error` while its neighbours keep streaming
3. that tile reconnecting on its own
4. a browser resize, so the responsive columns are visible

## Then

```bash
git add docs/demo.gif
# and in README.md, uncomment the image line under "## This fork"
```
