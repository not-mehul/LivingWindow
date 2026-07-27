# The Living Window

An open casement onto a small wild place. A generative art-and-sound piece:
five etched landscapes — meadow, forest, shore, wetland, city — that compose
themselves in the browser, inhabited by birds and beasts whose voices are
**synthesized in real time from a fresh seed**. No recordings, no loops; no two
sessions are alike. Everything runs locally — nothing is sent anywhere.

## Running it

Because the app is split into ES modules, it must be served over HTTP — opening
`index.html` directly from the filesystem (`file://`) will not load the modules.
Start any static server from the project root:

```bash
# Python 3
python3 -m http.server 8000

# …or Node
npx serve .
```

Then open <http://localhost:8000/>. The window starts shut: press **Begin
listening** and the casement swings open (a browser gesture is required to
start audio). Headphones are recommended, as each voice is placed spatially.

Closing the window again — the last button in the top-right of the frame —
swings the leaves shut, stops every voice and every animal, and ends the
session. Nothing is kept: opening it again draws a fresh seed and a new
serial. The piece is meant to be ephemeral, so there is no pause and no way
back to an hour you have closed.

Left to itself the light moves on: dawn gives way to day, dusk, night and
round again, an hour of the day every half hour. Both the turning and its
pace live under **The passing of time** in settings.

The shuffle button in the frame's top-right corner takes you somewhere
else entirely — a new place, a new hour, and freshly generated ground,
drawn from a new seed. The serial in the header follows it, since that
serial *is* the land you are looking at. Choosing a place by hand from
settings does not re-roll the seed, so a place you leave and come back to
during a session is exactly as you left it.

## Project layout

```
index.html        Markup and the window chrome; links the stylesheet and the entry module
bestiary.html     A developer tool, separate from the piece: every creature at close
                  range, with its animations, voice and field notes (see below).
css/styles.css    All styling. Every colour is a semantic CSS custom property — a raw
                  colour in a component rule is a bug.
js/
  util.js         Shared primitives: seeded PRNG, colour math, world constants, and the
                  single mutable `state` object.
  species.js      The voices and their marks: field-guide pictograms, the low-level synth
                  primitives, the species catalogue (habitat, hour weighting, synth), and
                  two tables the bestiary's studio edits — `PSTYLE`, each species' field
                  marks, and `ANIM`, the idle motion every perched bird shares.
  scene.js        The `Scene` class — canvas rendering of the five landscapes and their
                  drifting inhabitants.
  sky.js          The sky and what hangs in it — gradient, stars, sun, moon, clouds —
                  painted on a second canvas underneath by the GPU, with a Canvas 2D
                  backend that takes over verbatim where there is no WebGL2.
  audio.js        The `AudioEngine` class — wind, aeolian drift, per-place ambience,
                  turn-taking voices, and the odd church bell.
  main.js         Entry point: theme toggle, the casement (opening and shutting the
                  window), the turning of the hours, subtitles, and all DOM wiring.
                  Boots the scene and the audio engine.
  bestiary.js     Logic for the bestiary page. Borrows the Scene's painters and the
                  species' synths; adds nothing to the piece itself.
```

### Watching what a frame costs

Open the piece with `?perf=1` — <http://localhost:8000/?perf=1> — and a small
readout sits in the corner of the window: the smoothed frame time and the frame
rate that implies, the number of rasterization submissions the frame made
(every `stroke`, `fill` and blit), the render scale the adaptive quality has
settled on, and the size of the backing store. It is a bench, not part of the
piece: without the flag the counting wrappers are never installed and the
canvas context is left exactly as the browser handed it over.

What it is for is knowing which of the two costs you are looking at. A frame
here is either *submissions* — many small strokes, each rasterized separately —
or *fill-rate*, a few very large translucent blits. They are fixed by opposite
means, and the ops number is what tells them apart: if it is high and the frame
is slow, batch; if it is low and the frame is still slow, the cost is overdraw
and no amount of batching will touch it.

### The bench, and the trajectory recorder

`tools/` holds five harnesses. None is part of the piece; all need a static
server running and drive a headless Chromium through Playwright.

```bash
node tools/bench.mjs        label    # frame cost per place
node tools/trajectory.mjs   outdir   # what every animal did, frame by frame
node tools/critters.mjs              # every creature through update and paint
node tools/actors.mjs [outfile]      # every singer, and every way of leaving
node tools/gradient.mjs              # banding: the GPU held to what the canvas managed
```

`bench.mjs` reports the time a frame really takes — it hands the page a
synthetic 60 fps clock, because `adaptQuality` otherwise settles on a different
render scale for every scene and no two measurements can then be compared, and
it forces both canvases to finish before stopping the clock.

`trajectory.mjs` is the one to reach for before touching how anything moves. It
seeds `Math.random`, silences the audio schedulers (they run on real timers and
draw from the same random stream, so left alive no two runs agree), rewinds the
scene to a fixed start, and records two things every frame for 900 frames: the
state of every critter, actor, flyer, ripple and meteor, **and the arguments
handed to every painter**. Both matter, and for different reasons — a state
dump proves a deer still decides to stop grazing on the same tick, and the
paint log proves it is still drawn with the same crouch and the same wing
flare.

How much to trust it: across two runs of the same build, all ten scenes give
byte-identical **state**, and seven of the ten give byte-identical **paint**.
The three that do not are the night scenes, and they differ only in firefly
positions in the third decimal of a pixel — the fireflies are seeded during
`reseed`, which runs when the place changes and therefore before the recorder
puts the random stream back to a known point. So: treat any state difference as
real, and any paint difference larger than a firefly's third decimal as real
too.

What it cannot see is **actors**. Singers arrive only when the audio schedulers
call for them, and the recorder has to silence those schedulers to be
deterministic at all — they run on real timers and draw from the same
`Math.random` stream the critters spawn from. So no recording contains a single
bird on a perch, and one can come out byte-identical while `drawActors` is
thoroughly broken. That is not hypothetical: it is how a missing `sing`
shipped.

`tools/critters.mjs` and `tools/actors.mjs` close that hole by driving the cast
directly rather than waiting for it. Time is the enemy of coverage here — a fox
keeps a ninety-second cooldown, a cat walks a city roofline only after dark,
litter is kicked up by a badger that has decided to dig, and a bird's exit
depends on its species — so each is hunted for deliberately: the place is
reseeded, the hour forced, the cooldowns cleared, and every creature and every
manner of leaving is stepped through both halves. Run all four before trusting
a change to how anything moves.

Give `actors.mjs` a filename and it writes down every argument handed to every
painter, so two builds can be compared value for value and not merely for
whether they threw. That is how the shared `ANIM` table was proved to have
changed nothing: 1.43 million recorded values, byte-identical before and after.
It quiets the audio, stops the scene's own frame loop and reseeds the random
stream before recording, because an actor's build — its scale, its plumpness,
which way it looks and when — is drawn from `Math.random` the moment it is
spawned.

`tools/gradient.mjs` watches for banding, which is the one thing that cannot be
caught by comparing pictures. An eight-bit buffer has to step a smooth ramp
somewhere, and Skia hides those steps by dithering its gradients — so the 2D
path got it free and the GPU had to be told. When it was not, the sun and moon
wore rings and the dusk halo stepped in bands two hundred pixels wide, while a
whole-image comparison reported better than 99% agreement: a dither is a
difference of one level, and that comparison was counting differences greater
than two.

So this measures the thing itself. Along a line across a smooth ramp, how far do
you travel before the colour changes at all? Short runs read as smooth; a long
run *is* a band. It pins the scene (seeded randomness, a synthetic clock, a
reseed before each shot) so both backends photograph the same sky, takes the
median over forty columns and thirty rows so one line passing behind a cloud
cannot skew it, and then requires the GPU to come within 1.6× of the canvas at
every place and hour. Undithered, thirty-nine of the forty bands fail, some by
forty-fold; dithered, none do.

### A note on caching

There is no build step, so the stylesheet and every module carry an explicit
`?v=N` on their URLs — in `index.html`, `bestiary.html`, and on every `import`
inside `js/`. Browsers cache scripts and styles far more eagerly than markup,
and a cached script running against fresh markup fails in confusing ways (a
handler that binds to a control which no longer exists throws, and every
control wired after it silently stops working). **Bump the number everywhere
at once when shipping a change**; keeping them equal is what guarantees the
whole app is one version. As a second line of defence, `main.js` binds through
a small `on(id, …)` helper that warns about a missing control instead of
taking the rest of the page down with it.

### How the modules fit together

The dependency graph is acyclic:

```
util.js  ◄─────────────┐
   ▲                   │
   │                   │
species.js ◄──┐        │
   ▲          │        │
   │          │        │
scene.js   audio.js    │
   ▲  │       ▲        │
   │  └► sky.js        │
   └────┬─────┘        │
      main.js ─────────┘
```

`sky.js` knows nothing of the scene beyond a handful of shapes it is asked to
paint, which is what lets the same calls go either to the GPU or back onto the
2D canvas.

`main.js` owns the concrete instances. Rather than reaching for globals, the
audio engine is **given** what it needs: `new AudioEngine({ scene, emit })`,
where `scene` is the live `Scene` and `emit` is the subtitle callback. This
keeps `audio.js` free of any direct dependency on the DOM or the canvas.

## The bestiary — a developer's field bench

Open <http://localhost:8000/bestiary.html> (from the same static server) for a
tool that sits apart from the piece itself: every animal and bird in the window
laid out as field-guide cards. Each card shows

- the creature **animated at close range**, with buttons to switch between its
  states (idle / sing / take off, walk / graze, drum, probe, blink, and so on);
- a **▶ voice** button that plays the species' call through the very same
  synth the window uses — freshly generated each press, never sampled;
- **when** it appears — its hour weighting across dawn, day, dusk and night;
- **where** it appears — its habitats, faded where it is rarer, plus a note on
  how it enters the scene (perched, afloat, crossing the sky, or voice-only).

The bestiary imports the live `Scene` painters and `SPECIES` catalogue, so it
can never drift out of date: what you inspect there is exactly what the window
draws and sings. It honours the same Dawn/Dusk themes and
`prefers-reduced-motion`.

### The studio — tuning marks and motion

Press **Studio** in the header and click any picture. Two tables drive the
birds, and the panel edits them both:

- **Marks** — `PSTYLE` in `species.js`, a species' own field marks: how long a
  bill, how plump a body, whether it carries a cap, a wingbar, a crest. Numbers
  become sliders, marks become checkboxes, tones become a choice of amber or
  sage. There is an **add a mark** picker too, over every mark any species uses,
  so a dunnock can be given a crest to see how it looks.
- **Motion** — `ANIM` in `species.js`, the rates and depths of the idle motion
  every perched bird shares: the swell of its breathing, how often it glances
  about and how far, the flick of the tail, the pulse of the bill through a
  phrase. These used to be literals written out twice, once in the window and
  once in the bestiary, which meant a number tuned against a card at close range
  was not the number the window would use. Now both read `ANIM`, so what you
  tune here is the thing itself.

Every control is generated from the data rather than written out by hand, so a
mark added to `PSTYLE` or a rate added to `ANIM` turns up in the panel on its
own, with a slider range taken from the spread of that value across all the
species. `perchDraw` reads both tables afresh every frame, so edits show
immediately — nothing to rebuild, nothing to wire.

**Copy JS** gives you the edited rows in the formatting `species.js` already
uses, ready to paste back; **Reset this** and **Reset all** restore the shipped
values. Edits persist in `localStorage` under `lw.bestiary.studio` so a reload
does not lose your work — the bestiary only, never read by the window, which
keeps its promise that nothing is kept.

What the studio cannot reach: the eighteen birds with their own painters (the
owl, the cuckoo, the pheasant and the rest) and every mammal keep their shapes
as literal numbers inside the painting code, with no table standing between. The
panel says so rather than offering sliders that would move nothing. Motion is
shared by all of them, so that half still applies.

## Behaviour worth knowing about

- **Song posts are held.** An arriving bird takes a perch nobody is already
  sitting on (`Scene.pickPerch`), and a bird that sings again from the post it
  already holds is the same bird, not a second one drawn on top of the first.
- **Counter-singing.** Neighbouring territory-holders answer each other across a
  boundary: one sings, the other replies from its own post the moment the first
  falls quiet, and the turns tighten as the exchange goes on. Which species do
  this, and how readily, is `COUNTERSING` in `species.js`; the exchange itself is
  `AudioEngine.answer`.
- **Ground birds have somewhere to be.** A bird that comes down to a stone or a
  tussock takes a few steps — hopping or walking according to its species — has
  a look round, and works the turf for food before flying off.
- **Nothing dissolves in place.** Every visitor leaves by doing something: the
  owl tips off the branch and rows away, the pheasant walks out of frame or goes
  up like a firework, the kingfisher drops into the water, the cockerel sinks
  back behind the hill it came over.

## Design notes

- **Generative.** Every voice is built from oscillators and filtered noise via the
  Web Audio API — nothing is sampled. A session's seed drives both the landscape
  and its cast.
- **Faithful.** Each place keeps its own company; a species only sings where it
  would actually live (see `habitats` / `hw` in `species.js`). The same applies to
  behaviour: the fox's mousing pounce, the heron's strike, the squirrel caching a
  nut and the cuckoo's drooped-wing calling posture are all drawn from life.
- **Ephemeral.** There is no pause and no going back. A shut window keeps no
  time, holds no animals and makes no sound; opening it begins somewhere new.
- **Cheap to run.** A phrase costs two audio nodes, not two per note
  (`noteTrain` / `pulseTrain` in `species.js`), every voice's signal chain is
  unwired from the graph once it has decayed, and the canvas holds to a pixel
  budget with an adaptive render scale, so full screen on a dense display stays
  smooth. Anything drawn many times in one colour — grass, reeds, ferns, the
  rain — goes down as a single path and is stroked once rather than once
  apiece; the land's fixed outlines are kept as `Path2D` and refilled, not
  rebuilt, each frame.
- **Accessible.** Honours `prefers-reduced-motion` and `prefers-color-scheme`, and
  ships light ("Dawn") and dark ("Dusk") themes.
- **Private.** No dependencies, no build step, no network calls. Just static files.
