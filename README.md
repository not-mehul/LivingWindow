# Living Window

A self-hosted, browser-based ambient simulation: a pixel-art window looking out
onto living, non-repeating worlds. See
[`living_window_project_design_document.md`](./living_window_project_design_document.md)
for the full vision and roadmap.

## Status

**Step 1 — Project scaffolding & responsive window frame** ✅

- Vite + TypeScript + PixiJS v8 project.
- Responsive viewport manager for the 840×360 panoramic (21:9) world:
  - **16:9**: the central 640×360 is shown; drag / scroll / arrow keys to look around.
  - **21:9 ultrawide**: the whole panorama is visible.
  - **32:9 super-ultrawide**: crops up to 20% vertically, then pillarboxes with the room's wall.
  - **Portrait mobile**: fits the height and touch-drags horizontally, with inertia.
  - The world renders at native resolution into an off-screen texture, then scales
    up with nearest-neighbour sampling, so every entity sits on a true pixel grid.
- Screen-space window frame (nine-slice), windowsill and interior wall, pinned to
  the viewport edges at an integer device-pixel scale so they stay crisp.
- **Open / close window**: the glass sash slides shut over 0.6 s (the same
  duration as the future audio low-pass sweep). Click its bottom rail, press
  `W`, or use the overlay.
- **Birdseed bowl** on the sill: click it (or press `B`) to fill it. Its state
  exposes `consume()` and an `attraction` multiplier for the birds in Step 4.
- Auto-hiding pixel-art overlay UI (fades after 3 s of inactivity, along with the cursor).
- A procedural placeholder city skyline stands in for the real scene art (Step 4).

**Step 2 — Chronos clock & weather engine** ✅

- **Simulated clock** running at 6× (a full day every 4 real hours, one
  simulated hour every 10 real minutes), starting from your local time. Pause
  it, scrub it with the slider or `[` / `]`, or jump to Dawn, Morning, Midday,
  Golden Hour, Dusk, Night or 2–4 AM; it carries on from wherever you leave it.
- **Lighting**: a 24-hour palette of keyframes drives a dithered pixel sky,
  sun and moon arcs with glows, twinkling stars and tinted clouds. Every
  scene layer is authored in daylight and multiplied by an ambient tint, with
  extra haze on distant layers. The room itself picks up daylight by day and a
  warm lamp glow at night.
- **Emissive layers**: city windows switch on and off one by one following a
  daily schedule (busy evenings, an almost dark 2–4 AM), and streetlamps
  flicker on individually at dusk.
- **Weather engine**: a Markov chain moves between Clear, Overcast, Light Rain,
  Thunderstorm and Snow on simulated time, while simplex noise drives gusts,
  downpour swells and lightning bursts so nothing repeats. Pick the weather by
  hand to lock it, or choose Auto to hand it back.
- **Weather rendering**: rain streaks that follow the wind and snowflakes that
  sway, in two depth layers (behind and in front of the nearest towers), with
  splashes on the street. Lightning flashes the world and the room, with
  pixel bolts for nearby strikes.
- **Rain on the glass** when the window is closed: drops land, merge, grow
  into runners that slide down, swallowing others and leaving bead trails,
  then dry off after the rain. Snowflakes stick and melt.

**Step 3 — Audio engine & lofi radio** ✅

- **Web Audio mixer** in two acoustic zones. Exterior buses (wildlife, landscape
  ambience, weather) pass through the **window filter**: closing the window
  sweeps a low-pass from 20 kHz to 450 Hz and drops it 8 dB over 0.6 s, in step
  with the sash. Interior sounds (radio, rain tapping the glass, room foley)
  stay crisp. A limiter guards the output.
- **Five volume sliders**: Master, Wildlife & Birds, Weather, Landscape and Lofi
  Radio, plus mute (`M`). Settings persist in the browser.
- **`playSpatialSound(id, screenX, depthZ)`** pans a one-shot to its screen
  position (−1…1), makes distant sounds quieter and duller, and gives every play
  a random ±8% pitch and ±15% gain so nothing repeats exactly.
- **Weather audio**: rain and wind follow the live weather, with gust whistles,
  thunder delayed and softened by distance and panned to the strike, and drops
  tapping the glass when the window is shut.
- **City ambience**: a low hum, cars passing below (rush hour busy, 3 AM quiet,
  hissing on wet roads), the odd distant horn, birdsong by day with a dawn
  chorus, and snow muffling it all.
- **Lofi radio** (`R`): plays an internet stream URL or a local playlist through
  a warm "small radio in the room" chain (band-limited, mid bump, soft
  saturation, room reverb, slightly left of centre). With neither configured,
  the built-in **Living Window FM** generates endless lofi tracks: jazzy chord
  progressions, bass, lazy swung drums, vinyl crackle and tape wobble.
- **Everything is synthesized**, so no assets are needed. Real recordings can
  replace any sound: see [`public/audio/README.md`](./public/audio/README.md).
- Browsers start audio only after a gesture: the first tap or key press anywhere
  enables sound (the Sound panel also offers a button).

**Step 4 — Vertical slice: Downtown City Rooftop** ✅

- **Procedural pixel-art sprites**: birds and the cat are built from body-part
  shapes and rasterized at exactly the pixel size their depth calls for, so
  instead of three fixed LODs every size is crisp and nothing shimmers. They
  follow S(z) = S_min + (1 − S_min)(1 − z)²: 48 px on the sill, ~16–20 px mid
  distance, 6 px silhouettes on the horizon. Pedestrians, stalls and window
  occupants are small hand-built pixel maps.
- **Birds** (pigeons, sparrows, crows) run the design's state machine:
  FLY_IN → PERCH_IDLE ⇄ LOOK_AROUND ⇄ HOP ⇄ PECK_SEED ⇄ CHIRP → TAKE_OFF, with
  species temperaments and weighted, never-looping transitions. They perch on
  rooftops, water towers, antennas, street lamps and the sidewalk, grow as they
  fly in towards the window, land on the sill and peck at the bowl. Seed raises
  the odds of a sill visit up to 6× and lasts several minutes. Distant flocks
  cross the sky. Every call goes through `playSpatialSound`.
- **Scattering**: birds take off from the closing sash, close lightning, the
  start of rain, seed poured beside them, the stalking cat, or a tap.
- **The rooftop cat** (a rare visitor, in one of four coats) pads along the
  sill, sits, blinks, stretches, naps, stalks birds and pounces. Tap it for a
  meow, or a purr if it's napping. Rain or a closing window sends it off.
- **The street**: pedestrians follow the city's day: a morning rush, a crowded
  6 PM, a lively night market and an empty 2–4 AM. When rain starts they open
  umbrellas or dash into doorways. Day vendors set up their stalls in the
  morning and pack away at dusk; night-market stalls glow from evening to
  midnight. A crowd murmur follows the number of people.
- **Windows come alive**: silhouettes stroll past lit windows and TVs flicker.

**Step 5 — The Meadows, the Beach and the Deep Forest** ✅

- **Four landscapes**, switched with the chips at the top of the panel or `1`–`4`
  (City, Meadows, Beach, Forest) with a short fade; the choice is remembered.
  Each has its own birds and soundscape; the window, clock, weather, lighting,
  rain-on-glass, sill and birdseed are shared.
- **13 bird species** from the same generator, now driven by per-landscape
  "ecologies": pigeons, sparrows and crows downtown; robins, bluebirds, finches
  and sparrows in the meadows; seagulls at the beach; chickadees, jays,
  woodpeckers (which drum) and robins in the forest; owls by night in the
  forest and meadows; an eagle soaring over the hills.
- **The Deep Forest**: three depths of trunks with bark, moss and perches;
  crowns, canopy and ferns that sway with the wind (vertex-animated meshes);
  light shafts through canopy gaps that follow the sun; falling leaves; deer
  walking between the trunk layers, grazing, looking up and bounding off at a
  fright; squirrels climbing trunks, plus one that raids the sill bowl. The
  soundscape has wind in the canopy, rustling leaves, creaking trunks, distant
  calls and crickets.
- **The Beach**: a sea that takes its colour from the sky, with swells that
  roll in, break, wash up the sand and drain away (leaving wet sand that slowly
  dries); a glitter path under the sun or moon; a boids fish school in the
  shallows that scatters when a gull dives on it; sandpipers chasing the
  waves; sea turtles hauling out (mostly at night); dolphins breaching at the
  horizon; gulls on the groyne posts and the sill. The soundscape has distant
  swells, each wave's crash and backwash, a breeze and gulls.
- **The Meadows**: hills, a tree line and an old oak that sway; a herd of cows
  that graze, wander, moo and lie down at night; hens pecking round the hen
  house who go in at dusk; rabbits darting between bushes; a clear stream seen
  side-on with fish holding against the current (tap to make them dart);
  fireflies on dry nights. The soundscape has a babbling stream, grass in the
  breeze, songbirds and crickets.

**Step 6 — Mobile, performance and deployment** ✅

- **Touch & mobile**: swipe to look around, tap to show the controls (which
  fold their less-used sections on phones, portrait or landscape), no
  accidental page scroll, pinch-zoom or long-press callouts.
- **Audio unlock**: browsers only start Web Audio after a gesture, so the first
  tap or key press anywhere unlocks it. On iOS the session is set to
  `playback` (so the silent switch doesn't mute it) and a silent buffer is
  played inside the gesture. Audio resumes when you return to the tab, and the
  radio picks up again if it was on.
- **Keep screen awake** (Window section): the Screen Wake Lock API keeps a
  phone or tablet on as an ambient display. It is remembered and re-acquired
  when the tab returns. The button is hidden where unsupported.
- **Install to home screen**: a web app manifest and icons, so it opens
  fullscreen without browser chrome on Android and iOS.
- **Lighter start**: each landscape is a separately loaded chunk (preloaded
  when you hover its chip). The initial bundle dropped from ~506 KB to
  ~140 KB (~44 KB gzipped).
- **Adaptive quality**: if frames stay slow for a few seconds, the rain-on-glass
  drop count, precipitation density and sea animation rate are halved. They
  come back once the device keeps up again. Force a level with `?quality=low` or
  `?quality=high`. Lightning flashes are softened under
  `prefers-reduced-motion`.
- **Docker**: one command to host it on your network (see
  [Deployment](#deployment)).

**Interface — neon HUD**

The control panel is a cyberpunk heads-up display: dark scanlined glass with
chamfered corners and corner brackets, a cyan/magenta neon glow, numbered
sections, notched chips, and command-style buttons with a lit rail. A
`FEED://<landscape> ● LIVE` readout sits under the title, which glitches now and
then, and the panel flickers on when it reappears. All of this motion is off
under `prefers-reduced-motion`. The palette lives in the `--hud-*` custom
properties at the top of `src/style.css`. The pixel-art window and scenes are
unchanged.

**Redesign, part 1 — the rustic casement window** ✅

Rebuilt after a hand-drawn reference (the landscapes follow one at a time):

- **Timber casement**: a heavy head beam and plank posts, with knots, grain,
  cracks and nails, and the wall's depth showing inside them. Two sashes, each
  with two panes, a glazing bar, iron butt hinges and a D-handle, **swing
  outward** on their hinges in true perspective. Tap a sash (or the meeting
  stiles when shut), press `W`, or use the panel. Hinges creak, and the latch
  thunks shut.
- **Rain and snow on the glass** run on the closed pane and swing with the
  sashes.
- **Deep sill** with a worn top. A **terracotta seed dish** sits on it, among
  spilled seed that pours add to and visiting birds tidy up.
- **The dish is taken in while the window is shut**: it lifts away as the
  sashes start to close and comes back once they're open. Feeding is paused
  until then (the panel reads "Open window to feed").
- A **potted plant** on the left of the sill and a **linen curtain** on the
  right stir in the breeze while the window is open. Visitors such as the cat
  and squirrel come and go from behind them.
- Open sashes stay slim on ultrawide and portrait screens.

**Redesign, part 2 — the forest valley** ✅

The forest is rebuilt after its reference drawing. From a cabin on a wooded
rise, you look through a wood (a great gnarled oak at left, a tall pine at
right) onto a valley running away between two mountains.

- **A real wood, in depth.** About 40 trees are scattered over a ground plane
  (`sim/groundPlane.ts`), sized and hazed by distance: spruces, broadleafs and
  tall old pines. In the middle, the front pines lift their crowns out of view,
  so their bare trunks frame the valley. Further back only young trees stand
  there, keeping the valley, the far range and the sunset visible. The floor is
  moss, earth and leaf litter with ferns and shrubs, and a small sunlit glade
  where the deer path crosses.
- **Mountains:** sunny and shady flanks, ravines and a banded cliff face, with
  thousands of small trees down the slopes shrinking into the haze.
- **Deer walk between the trunks.** A ground walker (`sim/groundWalker.ts`) lets
  them wander towards and away from the window, growing and shrinking. They
  steer round every trunk's footprint and never stand inside one. They pass
  behind nearer trunks and ferns and in front of further ones. They come up
  from the valley or in from the sides, graze and look up, and when startled
  bound for cover, dropping out of sight over the brow.
- Squirrels climb the oak, the pine and the wood's trunks. Birds perch on
  treetops, boughs, logs and the forest floor.
- **Hand-drawn feel in pixels.** Spruces are built from whorls of drooping,
  ragged branches with ink outlines. Textures use smooth value noise and
  ordered dither (`scene/common/paint.ts`). Light shafts fall through the oak's
  leaves.

**Redesign, part 3 — the beach** ✅

The beach is rebuilt after its reference drawing. Palms lean in from the left
over grassy dunes and a winding sand path, a wide beach runs away to a wooded
point on the horizon, and the sea lies to the right.

- **A shoreline in perspective** (`sim/shore.ts`, unit tested). The waterline
  sweeps from the lower right to a point on the horizon, laid out on a ground
  plane, so the beach, surf and sea all converge correctly. Everything about
  the sea is measured in shore coordinates: along the beach, and across it from
  the waterline.
- **The sea runs parallel to the shore.** Swells roll in as crests with darker
  faces. Lines of white surf lie along the shallows, and breakers churn into
  foam and lace before washing up the sand as a thin sheet that leaves it wet,
  drying slowly. Turquoise shallows deepen to blue, wind ripples drift across
  the open water, and a glitter path follows the sun or moon. The renderer
  works from precomputed colour ramps per row and still halves its frame rate
  on slow devices.
- **Dunes and palms.** Feathery coconut palms have ringed, curving trunks and
  sway in the wind. The dunes are sandy, with clumps of marram and low scrub
  sized by distance, sorted among the palms. There are driftwood logs, an old
  fence, shells, and wildflowers on the front dune.
- **Life along the waterline.** Sandpipers chase the edge of every wave up and
  down the beach, shrinking with distance. Turtles crawl straight up the sand
  and back to the sea. The fish school swims in the shallows beyond the
  breakers, where a gull dives on it. Dolphins breach far out on the sea side.

**Redesign, part 3b — a curving bay, thicker dunes** ✅

- **A bay.** The waterline is now a smooth arc set by a few screen points and
  joined by a monotone cubic. It enters at the lower right, sweeps up and to the
  left, and curls round along the horizon under the far headland. The sea,
  surf, wet sand, dunes, path and every creature follow it unchanged.
- **Thick vegetation.** A belt of overlapping, inked scrub (dune bush, olive
  saltbush and glossy sea grape) fills the dunes under the palms, hazier with
  distance and with sandy gaps between the masses. Palm saplings come up
  through it. About 200 swaying marram clumps, bushes and flowers sit in front,
  four more palms join the grove, and the front dune bank gets denser grass,
  big marram clumps, more flowers and bushes along its crest. Plants too far
  away to see sway are painted into the static layer, so the sprite count stays
  modest.

**Redesign, part 4 — the meadows** ✅

The meadows are rebuilt after their reference drawing, keeping the farm life.

- **Laid out in depth** (`sim/meadowGeometry.ts`, unit tested). A two-track
  path comes in from the lower left, swings right across the field and winds
  away over a rise to the tree line. A creek meanders across the right of the
  pasture towards the window. Both are smooth curves read back onto a ground
  plane, so their widths converge with distance.
- **Scenery.** Hazy hills sit behind a ragged two-row tree line of oaks,
  broadleaves, poplars and spruces. The rolling pasture lightens on its rises
  and has bare earth patches and scattered flowers. Big spreading field oaks
  stand on the left, and their dithered shadows swing round with the sun: to
  the right in the morning, short at noon, long in the evening, fading under
  cloud. There's a red hen house with a fence by the creek, and a hedge along
  the right. A bank of wildflowers nods in front of the window: poppies at
  left, then daisies, cranesbill, bluebells, thistles and seed grasses.
- **The creek** is animated water seen from above. It takes the sky's colour,
  with ripples streaming towards you, sun glints and raindrop rings. Its trout
  and minnows are dark shapes holding against the current; tap and they dart.
- **Life in depth.** Cows wander and graze across the pasture, towards and
  away from the window, round the oaks, the hen house and the creek. They lie
  down at night. Hens peck about the yard and file in through the coop door
  at dusk. Rabbits peek out of the hedge and the field bushes. Squirrels climb
  the oaks, and birds perch on their limbs, the coop roof and the fence posts.

## Getting started

Requires Node.js 22.12 or newer.

```sh
npm install
npm run dev        # http://localhost:8080 (also reachable from your LAN)
```

| Command             | What it does                                |
| ------------------- | ------------------------------------------- |
| `npm run dev`       | Start the Vite dev server                   |
| `npm run build`     | Type-check and build the static site to `dist/` |
| `npm run preview`   | Serve the production build                  |
| `npm test`          | Run the unit tests (Vitest)                 |
| `npm run typecheck` | Type-check only                             |

### Controls

| Input                          | Action                |
| ------------------------------ | --------------------- |
| Drag / swipe, scroll, `←` `→`  | Look around (when the view is cropped) |
| `1` `2` `3` `4`                | City / Meadows / Beach / Forest |
| Tap a sash (or the closed window's middle), `W` | Open / close the window |
| Click the bowl, `B`            | Add birdseed          |
| `Space`                        | Pause / resume time   |
| `[` `]`                        | Scrub time ∓30 minutes |
| Tap a bird / the cat / a deer / the fish | Shoo it, pet it, or make it dart |
| `R`                            | Radio on / off        |
| `M`                            | Mute / unmute         |
| `F`                            | Toggle fullscreen     |

## Deployment

### Docker (one command, local network)

```sh
docker compose up -d --build
```

Then open `http://<this-machine's-LAN-IP>:8080` on any device on your network,
such as an old tablet, a TV browser or a phone. The image is a multi-stage
build. Node type-checks, tests and builds the site, then a small `nginx:alpine`
image (~100 MB, ~5 MB RAM) serves it with long-lived caching for hashed assets,
gzip, a strict Content-Security-Policy and a `/healthz` endpoint. The
container runs read-only with no extra privileges.

| Setting | How |
| ------- | --- |
| Port | `LIVING_WINDOW_PORT=9000 docker compose up -d` |
| Your own recordings | Uncomment the `public/audio` volume in `docker-compose.yml` (see `public/audio/README.md`) |
| Reach it from outside your network | `CLOUDFLARE_TUNNEL_TOKEN=… docker compose --profile tunnel up -d` runs a Cloudflare Tunnel next to it (configure the tunnel to point at `http://living-window:8080`) |
| Docker Hub rate-limited | `docker compose build --build-arg NODE_IMAGE=mirror.gcr.io/library/node:22-alpine --build-arg NGINX_IMAGE=mirror.gcr.io/library/nginx:alpine` |

Without Compose:

```sh
docker build -t living-window .
docker run -d -p 8080:8080 --read-only --tmpfs /var/cache/nginx --tmpfs /var/run --tmpfs /tmp living-window
```

### Any static host

`npm run build` writes a self-contained static site to `dist/` with relative
asset paths. It runs from any sub-path on GitHub Pages, Cloudflare Pages,
Netlify, Vercel, a NAS web folder or `python3 -m http.server`. If your host
sets a Content-Security-Policy, the app needs no `unsafe-eval`.
`docker/nginx.conf` has a working policy.

### Phones and tablets

See [`docs/MOBILE_TESTING.md`](./docs/MOBILE_TESTING.md) for the real-device
checklist (audio unlock, silent switch, wake lock, home-screen install).

## Project layout

```
src/
  config.ts                 Tuning constants (world size, timings, time scale)
  main.ts                   Bootstraps PixiJS and wires everything together
  core/
    viewportLayout.ts       Pure screen → world mapping math (unit tested)
    Viewport.ts             Off-screen world render target, panning & inertia
    input.ts                Pointer / wheel / keyboard input
    pixelTexture.ts         Helpers for drawing pixel art into crisp textures
    simplex.ts              Seedable 2D simplex noise
    pixelBuffer.ts          RGBA buffer for large procedural art (with ink outline)
    quality.ts              Frame-time monitor and adaptive quality level
    wakeLock.ts             Screen Wake Lock (keep the display on)
    Emitter.ts, math.ts, random.ts, color.ts
  state/
    WindowState.ts          Open/closed window model + transition events
    BirdseedState.ts        Seed level, depletion and bird attraction
    Clock.ts, timeOfDay.ts  Simulated clock, day phases and presets
    Weather.ts              Markov + noise weather engine, lightning events
  window/
    WindowFrame.ts          Wall, timber frame and windowsill
    casement.ts             Swinging-sash perspective maths (unit tested)
    CasementSashes.ts       The two hinged sashes, with rain mapped onto their glass
    SillDecor.ts            Potted plant, curtain and spilled seed
    woodArt.ts              Procedural plank / grain / knot painter
    BirdseedBowl.ts         The seed dish (taken in while the window is shut)
  sim/                      Pure behaviour logic (unit tested): bird and cat
                            state machines, perspective, crowd and stall schedules,
                            groundPlane + groundWalker (creatures moving in depth),
                            shore (the beach's shoreline geometry)
  sprites/                  Procedural pixel-art generators (birds, cat, street)
  landscapes/               The four landscapes and the registry that builds them
  life/                     Living things: BirdSystem (any ecology), city, forest,
                            beach and meadow creatures, sill visitors
  scene/
    WorldScene.ts           Contract every landscape implements
    Environment.ts          Per-frame lighting + weather passed to scenes
    lighting.ts             Time-of-day / weather lighting model (unit tested)
    sky/Sky.ts              Gradient, stars, sun, moon, clouds
    city/ forest/ beach/ meadow/   The four landscapes' scenery
    common/SwayMesh.ts      Wind-swayed vertex meshes for trees and plants
    common/trees.ts         Procedural conifers and broadleaf trees
    common/paint.ts         Value noise, ordered dither and colour ramps
    weather/                Rain/snow particles, lightning, rain on the glass
  audio/
    AudioEngine.ts          Buses, window filter, limiter, playSpatialSound
    AudioSystem.ts          Assembles engine, radio and soundscapes
    mixer.ts, spatial.ts    Volume/settings and spatial maths (unit tested)
    sounds/                 Synthesized voices + recorded-sample bank
    soundscapes/            Weather sound and city ambience
    radio/                  Radio chain, generative lofi station, music theory
    manifest.ts             Optional recordings from public/audio/manifest.json
  ui/
    Overlay.ts              Auto-hiding control panel
    SoundPanel.ts           Mixer and radio controls
public/
  manifest.webmanifest, icons/   Home-screen install (PWA manifest + icons)
  audio/                    Optional recordings (see its README)
docker/nginx.conf           Static server config used by the Docker image
Dockerfile, docker-compose.yml  One-command local hosting
```

### Extension points

- `WindowState` emits `toggle` (with its duration) and `settled`; the audio
  low-pass filter follows it.
- A landscape is a `WorldScene` + `SceneLife` + frame theme + `Soundscape`,
  registered in `src/landscapes/registry.ts`.
- In development, `window.livingWindow` exposes the systems, including
  `fastForward(seconds)` to run the simulation without drawing,
  `setLandscape(id)` + `landscapeReady()` (switching is asynchronous), and
  `life.birds.summonToSill()` / `life.cat.summon()` for demos.
- New scenes implement `WorldScene` and get the sky, lighting, precipitation,
  lightning and rain-on-glass for free. Expensive effects can read
  `quality.scale` (1 or 0.5) to thin themselves out on slow devices.
- `Viewport.world` is where scene layers go, in native world pixels;
  `Viewport.worldXToStereo()` maps a world x to a stereo pan for spatial audio.
- The `sill-layer` container (in `main.ts`) holds z = 0 foreground entities.
  `BirdseedBowl.perchPoint` and `BirdseedState.attraction` feed the bird FSM.
