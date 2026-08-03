# The Living Window

An open casement onto a small wild place. A generative art-and-sound piece:
five etched landscapes — meadow, forest, shore, wetland, city — that compose
themselves in the browser, inhabited by birds and beasts whose voices are
**synthesized in real time from a fresh seed**. Nothing is sampled and no two
sessions are alike — down to the record somebody has on two floors down in the
city, which draws its tempo and its chords from the same seed as the skyline.
Each place is heard in its own room, and how much of each kind of sound you
want is yours to set. Everything runs locally — nothing is sent anywhere.

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
  audio.js        The `AudioEngine` class — wind, aeolian drift, per-place ambience and
                  the room that goes with it, turn-taking voices, the odd church bell,
                  and the record somebody has on in the city.
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
- **Nothing dissolves in place, and nothing appears out of nothing.** Every
  visitor leaves by doing something: the owl tips off the branch and rows away,
  the pheasant walks out of frame or goes up like a firework, the kingfisher
  drops into the water, the cockerel sinks back behind the hill it came over.
  And every visitor arrives the same way — on its own feet or its own wings,
  from beyond the edge of the frame, at full weight. The alpha ramp in
  `updateActors` is opt-in (`a.fadeIn`) and nothing sets it.
- **Nothing here is driven by a sine.** A limb driven by a sine has two poses
  in it and slides evenly between them, which is why the deer used to swim
  rather than walk and the small birds used to row rather than fly. Every
  animal in the window — four-footed, winged or otherwise — now runs a frame
  table from `GAIT` in `species.js`, and so does the weather. See below.
- **The wind has weight.** A gust comes on fast, holds raggedly, and then
  simply drops; it crosses the frame rather than arriving everywhere at once;
  and what it pushes lags into it and springs back past upright when it lets
  go. The grass answers in half a second, the wood in two.
- **The rain has depth.** Three bands of it: near drops long, fast, dark and
  leaning hard; far ones short, slow and almost not there. It squalls, it leans
  with whatever the wind is doing, and every drop lands on something — a ring
  where it meets water, a flick of pale spray where it meets ground.

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
`glance` is the one to look at: a bird does not sweep its head, it snaps to a
station, holds it dead still, and snaps again — the frames are the stations and
the jumps between them are pairs set close together, because a movement with no
middle cannot be written any other way.

**The weather, too** — `gust`, `blink`, `swash`, `glint`, `flash`, `plume`,
`cloud`. Same argument, same tables: a wave chases up the sand and *drains*
back rather than going up and down at one speed; a blink shuts fast and opens
slowly; a firefly's flash rises at once and dies away; a glint off water
catches, loses it, catches again and is then dark for a good while.

### Keeping the audio out of the way

A voice's graph is built on the main thread and takes the graph lock while it
does it — two milliseconds on a good day and sixteen on a bad one, most of that
being the shared noise buffer the first burst has to fill. Built twenty
milliseconds ahead of its own first sample, as a reply or a passing flier was,
that could still be in progress when the render thread wanted the sound, and
the beds would stutter just before the bird was heard. So: `VOICE_LEAD` puts a
tenth of a second between the build and the sound, the noise buffer and the
HRTF impulse set are both warmed at startup while nothing is listening, and the
subtitle — an SVG parse and a style recalculation that used to land on exactly
that tick — caches its pictograms, skips the write when the species has not
changed, and waits for the browser's own next frame.

### The mix

Everything used to run into one gain through one 4:1 compressor. A continuous
bed feeding a compressor holds the whole mix down all the time, so a bird
arrives into a room that has already been turned down for it.

Measured at the **master output, after the limiter** — which is the only place
that is what a listener hears; tapping each bus separately measures something
nobody is listening to. The same bird is called in every place (the crow, which
lives in all five), so the numbers compare like with like rather than telling
you which species a place happens to have:

```
                 bed rms   crow peak   clear
meadow  clear     −41.2      −19.9     +21.2 dB
meadow  breeze    −34.2      −19.3     +14.9 dB
meadow  rain      −35.3      −19.4     +15.9 dB
forest  clear     −41.8      −23.3     +18.5 dB
beach   clear     −37.0      −21.5     +15.6 dB
beach   breeze    −35.4      −23.3     +12.1 dB
wetland clear     −40.4      −22.2     +18.2 dB
city    clear     −34.4      −18.8     +15.5 dB
```

Before any of this the same measurement ran from −8.2 dB to +8.5 dB: a call's
*peak* below the bed's *steady level* is the definition of inaudible, and that
is what half the settings were. What fixed it, in order of how much each was
worth:

- **Two buses.** The beds have their own path and the voices have their own;
  the master carries nothing but a limiter, set high enough that it only ever
  catches a peak and can never pump the beds or flatten a call.
- **Ducking.** The beds step back five decibels while anything is calling and
  come back slowly afterwards. There is no analyser and no sidechain — the
  engine knows exactly when every call starts and how long it runs, so it is
  two scheduled ramps on one gain.
- **Stereo beds.** Every bed was one channel of pink noise, which puts the
  whole of the weather in the exact middle of the head — the one place a bird
  also has to be heard. A two-channel noise buffer costs nothing extra in the
  graph (the same filters process both channels) and leaves the centre free.
- **A dip where the birds live.** Three decibels out of a wide band at
  3.2 kHz on the bed bus, and everything below 40 Hz thrown away. The weather
  gives up the one part of the spectrum it does not need.
- **Lower beds all round**, and a narrower spread between weathers: five times
  the wind for a breeze was a different room, not a windier one.

Getting the beds down that far left the piece peaking at −21 dBFS with the
loudness slider at three quarters — a lot of headroom nobody was using and a
window you had to turn the system up to hear. `OUTPUT` spends it. It is the
last thing in the chain, so it moves everything together and changes no
balance: measured at the busiest the piece gets (city, rain, life at maximum,
ninety seconds), the peak lands at −15.8 dBFS with zero clipped samples, and
the limiter is never touched.

### The room each place is heard in

The strongest thing in a recording that tells you *where* it was made is not
the birds in it — it is what happens to a sound after it has been made. Every
voice was arriving into the same room: a wren in a wood and a wren on an open
shore got identical reflections.

`AIR` in `audio.js` gives each place its own. Four numbers — how much of a
voice is sent at all, how long the tail takes to come round, how many times it
does, and how dark it is when it gets back:

| | send | tail | feedback | tone |
|---|---|---|---|---|
| **meadow** | 0.85 | 81 ms | 0.20 | 3.2 kHz |
| **forest** | 1.15 | 52 ms | 0.42 | 2.6 kHz |
| **beach** | 0.45 | 190 ms | 0.16 | 2.1 kHz |
| **wetland** | 0.75 | 155 ms | 0.30 | 4.2 kHz |
| **city** | 1.05 | 128 ms | 0.46 | 1.9 kHz |

A wood is trunks close on every side — the most reflective natural place there
is at short range, and the only one where the return is dense. A shore is the
most open place in the piece: sound goes out over the water and does not come
back, so almost nothing is sent, and what returns is long and dark. Flat water
under open sky is a hard mirror — one long bright slap rather than a wash,
which is most of why a wetland sounds like a wetland and not like a meadow with
ducks on it. A street is hard walls a few metres off and brick that takes the
top off everything before it gets back.

Fog is the exception a listener will actually notice: it absorbs rather than
reflects, so a foggy morning anywhere is a shorter, darker room than the same
place clear. That is what makes fog *sound* like fog rather than merely look
like it.

Measured by exciting the air with a click and reading what is left of it half a
second later:

```
meadow  −52.1 dB      beach   −26.6 dB      city  −17.1 dB
forest  −38.6 dB      wetland −22.4 dB      forest in fog  −52.7 dB
```

It costs nothing: the delay line and the filters already existed for distance,
and a place changes three params on them. The tail's *length* is stepped rather
than ramped, under cover of a 120 ms dip in the return — ramping a delay time
is pitch-shifting it, and sliding from a wood to a shore is a swoop nobody
asked for.

### Keeping the audio thread fed

The stutter when the land got busy was head-related panners: twelve or thirteen
of them convolving at once under load, which is the most expensive thing in the
graph by a long way. It also buys least on a far-off voice, which is already
dull and quiet. So it is spent where it is worth spending — near voices, up to
four at a time — and everything else gets an ordinary stereo pan.

Ninety seconds at the busiest the piece gets — city, rain, life at maximum,
with the record playing — sampled every fifteen seconds:

```
  t(s)  timers  live chains  hrtf  voices  bars
     0       0       0         0       0     1
    15       0       0         0       0     6
    31       0       0         0       0    11
    46       4       3         1       1    17
    62       3       1         1       1    22
    77       1       1         1       0    27
```

Nothing grows. The bar count climbs at exactly the tempo, which is the
look-ahead scheduler never missing and never catching up in a rush. Peak
−15.8 dBFS, zero clipped samples.

### What else the land does

Not everything that makes a sound is somebody's voice. Each of these is built
from the same two primitives the birds are, torn down when it has finished, and
sent to the bed bus so it steps back under a call like the rest of the weather:

| | |
|---|---|
| **thunder** | rain only. The flash goes to the scene at once and the roll waits out the distance at a third of a kilometre a second — light first, then the sound, which is the only thing that has ever told anybody how far away a storm is. Far strokes are duller, later and longer. It is the one cue that bypasses the duck: a robin should not duck a storm. |
| **drips** | rain, and for the best part of a minute after it stops, thinning as the ground dries. Leaf-litter knocks, stone rings, water answers with the rising note everybody knows and nobody can place. |
| **cattle** | a low from whichever beast is actually standing on the hill. |
| **timber** | two trunks leaning on each other, when there is enough wind in the wood to load them. |
| **shingle** | stones dragging down the beach, started by the wave that is taking them. |
| **reeds** | dry stems knocking in the same gust the grass is answering. |

Measured against the room each is heard in, they stand 7.5 to 23 dB clear.

### What the listener gets to decide

Five groups, each a plain coefficient rather than a node — every level in the
engine is worked out from a base and multiplied by its group on the way, so a
slider costs nothing in the graph and a group at zero costs nothing at all
(the emitters check their group and return before building anything):

| | |
|---|---|
| **Birds & animals** | everything with a voice — song, calls, the cattle on the hill |
| **Wind & weather** | wind, rain, leaves, thunder, the drip off a leaf |
| **Water** | surf, the lap of a wetland, stones in the backwash |
| **Town** | traffic, a passing car, the church bell |
| **Music** | the city's record, which sounds nowhere else |

and three switches for the things that happen now and then rather than all the
time: **thunder & lightning**, the **church bell**, and the **lo-fi beats**.

A group is allowed all the way to zero, which is where the one interesting bug
lived: an exponential ramp cannot reach zero and Web Audio throws rather than
rounding, so a peak worked out from a group at zero took the engine down. Every
such ramp now goes through `AudioEngine.ramp`, and the three shared primitives
in `species.js` clamp their own peak. Thunder re-reads its group *inside* the
delayed callback, because the roll arrives up to fourteen seconds after the
flash and the slider may have moved in the meantime.

### The city's record

In the city, and only in the city, somebody two floors down has something on.
It is generated like everything else: a tempo between 70 and 84 drawn from the
session seed, one of three minor-seventh loops over a root drawn with it, an
electric piano voiced with a sine at the bottom and detuned triangles above it,
a sine bass, a brushed kit, and a noise floor with the odd click in it.

Three things make it sound like a record rather than a synthesiser:

- **It is compressed.** Measured at the master, the kit's transient stood 23 dB
  over the record's own average and arriving in the city was a 23 dB jump above
  the meadow — the loudest thing in the piece by a long way, which is not what
  somebody else's music through a wall does. A compressor on the music bus
  alone (−40 dB, 8:1, 18 dB knee) takes the crest to 17.5 dB and leans fifteen
  decibels on a peak, which is the sound of the genre: the kick sits down into
  the keys instead of standing on top of them. Web Audio's compressor makes its
  own gain back, so a lower threshold is also a *louder* record — `MUSIC_TRIM`
  is calibrated against those exact settings and wants re-measuring if they
  change. The city now sits 8.5 dB over the meadow instead of 23.
- **It drifts.** A few cents of tape wow, worked out from the audio clock as
  two sines an irrational ratio apart so the period never quite repeats. It is
  two automation events on a param each note already owns — a shared LFO node
  would have to be wired into every key's `detune` and unwired again when the
  note ended, a thousand times an hour.
- **It is not the same bar four times.** The bar knows where it sits in the
  loop: the last of the four drops its second kick and doubles the hats through
  the fourth beat, so the loop turns over instead of restarting. A sparse line
  over the top sounds on about three bars in five, drawn from the chord with
  the ninth allowed in, always off the beat — two nodes for the whole phrase
  via `noteTrain`.

It is scheduled with a look-ahead, which is the only way to make a rhythm out
of Web Audio that does not stutter: a timer every quarter-second books whatever
falls inside the next second against the audio clock, so the timer's own jitter
never reaches the sound. The graph outlives a pause — leaving the city and
coming back does not rebuild it, only the look-ahead loop stops and starts —
and a new seed disposes of it so the next session gets a new tempo.

It runs into the same duck as the weather, so a bird still comes through it.

### The wind

`windBend(x, stiff)` replaced `windWave(x)`, and it is not a function of `t` at
all — it reads a field that `updateWind` steps. Two rows of springs across the
frame: a light one that grass, reeds, fern and flowers answer, and a heavy slow
one for timber and cloud.

Each spring is driven toward `GAIT.gust` sampled at `t·rate − x·travel`, so the
gust arrives at the far side of the frame first and you watch it cross. What
the spring adds is the part no envelope has: the plant lags into the gust, and
when the gust drops — and `gust` ends by simply dropping, which is the whole
point of the shape — the plant springs back **past upright** and rings down.
Measured over a minute the light row runs −0.16 to 1.08: sixteen per cent of a
full lay-over, back the other way, every time the wind lets go.

Everything in the frame reads the same field, so the frame agrees with itself:
rain leans on it, chimney smoke shears on it, clouds hurry in a gust and are
drawn out flat by it.

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
