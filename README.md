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
                  and three tables the drawing reads — `PSTYLE`, each species' field
                  marks, `ANIM`, the idle motion every perched bird shares, and `GAIT`,
                  every animal's cycles — strides, wingbeats, pecks — written out
                  frame by frame (see below).
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
`prefers-reduced-motion`, and it wears the window's own stylesheet, so the two
pages read as one piece of work.

Showing you the creatures is the whole of what it does. It edits nothing and
saves nothing — no panels, no sliders over the drawing code, nothing kept in
`localStorage`. Changing how an animal looks or moves means editing the painter
in `scene.js` or its row in `PSTYLE`, and the bestiary is where you go to see
what that did. It is reached from **The Bestiary** in the window's settings card,
and there is a link back in its footer.

Only cards whose creature is in view are painted (an `IntersectionObserver`
watches each canvas), so a page of sixty animated canvases costs about what one
does.

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
- **Nothing here is driven by a sine.** A limb driven by a sine has two poses
  in it and slides evenly between them, which is why the deer used to swim
  rather than walk and the small birds used to row rather than fly. Every
  animal in the window — four-footed, winged or otherwise — now runs a frame
  table from `GAIT` in `species.js`. See below.

### The gaits, frame by frame

`GAIT` holds one table per way of moving, and each is written out as frames
around one cycle:

```
[u, x, y]                 a foot: where in the stride (0..1), how far forward
                          it is (−1..+1), how far it is clear of the ground
[u, …channels]            the body: the rise of the chest, the nod of the head,
                          the arch of the back — named in the table's `chan`
```

`gaitSample` runs a Hermite through them, tangents taken from the neighbouring
frames, so the curve passes through every frame written and closes on itself at
u = 0 without a seam; the frames need not be evenly spaced, because a cycle's
interesting moments are not.

**On the ground** — the deer's `walk`, the fox's `trot`, the cat's `pad`, the
badger's `trundle`, the hedgehog's `scurry`, and for the birds the two-footed
`birdHop` and the walker's `strut`. What a frame table buys here is the thing a
sine cannot give: a **stance**, where the foot is planted and travels backwards
at exactly the speed the ground goes past, and a much quicker **swing**. The
plant is what makes an animal look to weigh something. `strut` also carries the
head-bob, which is not a bob at all — the head is thrown forward and then held
*still in the air* while the bird walks on under it, and darts forward only at
the last moment. That hold is a straight slide in the data and a jump between
two frames set close together; there is no sine that has it in it.

**Leaping** — `bound`, `hop`, `lope`, `scamper`: gather, drive, a hollow-backed
stretch, and a landing taken on the forefeet with the hind swinging through.

**In the air** — `beatSlow` (gull, tern, heron, goose, owl), `beatQuick` (small
birds, cuckoo, pigeon, duck, pheasant), `beatWhir` (lark, kestrel, swift) and
the bat's `flit`. Each carries `beat`, `span` and `sweep`: the downstroke is
quicker than the recovery, the wing is at full span through it and shortens as
the wrist flexes on the way back up, and the tip is carried forward on the way
down and swept back on the way up — so it describes a flattened figure of eight
rather than sliding up and down a line.

**In the water** — the otter's `swim` and the porpoise's `roll`, which is not a
sine either: the snout breaks, the back wheels over in a fifth of the cycle,
and then the animal is gone for a long while.

**And the standing cycles** — `graze`, `groom`, `dig`, `peck`, `probe`, `song`,
`drum`, `paddle`, `flutter`, `swish`. `song` is the bill through one note and
every singer in the window reads it, so the note is thrown open and *held*
rather than swung evenly shut and open again. `peck` has the beat on the ground
where the thing is actually seized, and the head thrown back to swallow.

The tables say only what the shape of a cycle is. How many of them go by in a
second stays with the animals, in `scene.js`, in radians as it always was —
`TURN` is the one conversion between the two.

Painters sample the table themselves where only they need it (the four feet of
a walk); where the scene needs a channel too — a leaping animal's `rise` lifts
its contact shadow as well as the animal — `gaitPose` builds the pose once in
`drawCritters` and hands it to the painter, the way the fox's pounce already
worked. Where only one channel is wanted in a loop that runs dozens of times a
frame — a skein of geese, a sky full of distant birds — `gaitAt` returns it
without building the object. The bestiary drives the same tables at the same
rates, so a card and the window show the same stride.

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
