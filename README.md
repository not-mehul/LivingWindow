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
Start any static server from the project root. The piece itself has no
dependencies and no build step — `npm install` is for the benches in `tools/`
and nothing else, so this is all it takes from a fresh clone:

```bash
npm run serve                 # python3 -m http.server 8123
# …or, without npm at all:
python3 -m http.server 8123
npx serve . -l 8123
```

Port 8123 by choice rather than necessity: any port serves the piece, but the
benches look for that one, so using it everywhere means one server does for
both. Then open <http://localhost:8123/>.

Two pages: `/` is the window, `/bestiary.html` is the field bench of every
voice and every gait, drawn and sounded card by card.

The window starts shut: press **Begin
listening** and the casement swings open (a browser gesture is required to
start audio). Headphones are recommended, as each voice is placed spatially.

Closing the window again — the last button in the top-right of the frame —
swings the leaves shut, stops every voice and every animal, and ends the
session. The land is not kept: opening it again draws a fresh seed and a new
serial. The piece is meant to be ephemeral, so there is no pause and no way
back to an hour you have closed.

What *is* kept is how you like it set — the theme, the loudness, the five mix
groups, the three cue switches, spatial audio, subtitles and whether the hours
and the sky move on their own. The seed, the place, the hour and the weather
are never written down. Ephemerality is about the land; losing five sliders on
every refresh is not ephemerality, it is a thing that needs setting up again.

Left to itself the light moves on: dawn gives way to day, dusk, night and
round again, an hour of the day every half hour. Both the turning and its
pace live under **The passing of time** in settings.

The shuffle button in the frame's top-right corner takes you somewhere
else entirely — a new place, a new hour, and freshly generated ground,
drawn from a new seed. The serial in the header follows it, since that
serial *is* the land you are looking at. Choosing a place by hand from
settings does not re-roll the seed, so a place you leave and come back to
during a session is exactly as you left it.

### The keyboard

An ambient piece is one you leave running in another window, and reaching for
the mouse is the wrong gesture for it.

```
space  open or shut the casement      h  next hour
← →    previous / next place          w  next weather
↑ ↓    loudness                       m  mute (and put it back)
s      settings      f  fullscreen    e  elsewhere — new ground
esc    close settings
```

Nothing is hijacked while a control has the focus or the settings panel is
open: the arrow keys belong to a slider that is being used, and taking them
away would break the panel for anybody driving it by keyboard. Modifier
combinations are left to the browser.

## Project layout

```
index.html        Markup and the window chrome; links the stylesheet and the entry module
bestiary.html     A developer tool, separate from the piece: every creature at close
                  range, with its animations, voice and field notes (see below).
css/styles.css    All styling. Every colour is a semantic CSS custom property — a raw
                  colour in a component rule is a bug.
js/
  util.js         Shared primitives: seeded PRNG, colour math, world constants, the
                  single mutable `state` object, the weather — which lives here rather
                  than in either canvas or engine because both read it — and what
                  survives a reload (preferences only; never the land).
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
                  the room that goes with it, turn-taking voices, the dawn chorus and
                  the silence after an alarm, the odd church bell, and the record
                  somebody has on in the city.
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

There is a second flag, `?hook=1`, which puts the scene, the engine and `state`
on `window.__lw` and does nothing else. `?perf=1` does that too, but it also
turns on the readout — which wraps every drawing call a second time and paints
a panel over the very thing being measured, so the frame bench must not have
it. The bench uses the hook to hold the hour and the weather still and pin them
to a known point; driving the settings panel instead is not an option, because
the card scrolls and a forced click at a stale coordinate lands on the casement
and shuts the window.

### The bench, and the trajectory recorder

`tools/` holds thirteen harnesses, and shared machinery in `tools/lib/`. None is
part of the piece — the piece itself has no dependencies and no build step —
but they drive a headless Chromium, so they need one installed, and they talk
to a static server on port 8123:

```bash
npm run setup      # npm install && npx playwright install chromium
npm run serve      # python3 -m http.server 8123   (leave running)
```

`package.json` exists only for these. It declares Playwright, and every
harness has a script (`npm run voice`, `npm run bench`, …). The browser is
found by `tools/lib/browser.mjs`: `CHROMIUM_PATH` if you set it, otherwise
whatever Playwright installed. One tool needs neither Playwright nor the
server — `xenocanto.mjs --fetch` downloads with node and curl alone.

```bash
node tools/bench.mjs        label    # frame cost per place
node tools/trajectory.mjs   outdir   # what every animal did, frame by frame
node tools/critters.mjs              # every creature through update and paint
node tools/actors.mjs [outfile]      # every singer, and every way of leaving
node tools/weather.mjs               # the sky drifting, the alarm, and the hour
node tools/mix.mjs                   # how far a call stands clear of its room
node tools/voice.mjs   [id …]        # what each voice is made of, partial by partial
node tools/reference.mjs             # the piece held against real field recordings
node tools/xenocanto.mjs             # …and against the actual species, one by one
node tools/texture.mjs               # which beds are still static
node tools/soak.mjs                  # ninety busy seconds: leaks, growth, clipping
node tools/gradient.mjs              # banding: the GPU held to what the canvas managed
node tools/shot.mjs [place] [hour]   # pictures of it, for the questions that are not numbers
```

`shot.mjs` is the odd one out: every other harness here measures a number, and
this one takes a photograph. Some questions about a place — whether it looks
like anywhere, whether a change to the drawing helped or quietly made it
worse — cannot be answered by a number at all, and before this there was no way
to ask them except by opening a browser and looking, which meant art-direction
work was the one part of the piece that could not be checked the way everything
else here is. It pins the hour, the weather and the seed through the hook for
exactly the reason `bench.mjs` does, so two shots of the same place under two
builds differ by the build and by nothing else:

```bash
SHOT_DIR=shots/before node tools/shot.mjs city    # …change something…
SHOT_DIR=shots/after  node tools/shot.mjs city
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

`mix.mjs`, `texture.mjs` and `soak.mjs` are the three that answer "does it
sound right" rather than "did it throw", and each has one lesson built into it
that cost real time to learn:

- **`mix.mjs` reports the *median* short-term level of a room, not the mean.**
  One wave crest inside a three-second window moved the beach ten decibels
  between runs and made the whole row meaningless — it read as a six-decibel
  regression that did not exist. It also calls the same species (the crow,
  which lives everywhere) in every place, because picking whatever perch bird a
  place happened to have was measuring the species and not the room.
- **`texture.mjs` thresholds the spectral centroid.**
  `getFloatFrequencyData` floors every empty bin at `minDecibels`, and a
  thousand floored bins outweigh the handful carrying the signal, so
  everything more than 40 dB below the loudest bin is not counted. Without
  that, a cow's low and a church bell both measure five kilohertz.
- **`soak.mjs` hushes nothing and fakes nothing.** An earlier version silenced
  the beds to isolate a cue and ended up measuring the click its own
  `setValueAtTime` made. If you need to know what is loud, wrap the emitters
  with timestamps and see what fired just before the peak — the answer here
  was drips, the record's kick and an alarm coinciding, and it was not the
  thing that had been suspected twice.

`weather.mjs` covers the three things a still picture cannot show: that the sky
drifts on its own and every dial moves smoothly (it reports the largest
single-frame step across every pairing of the four weathers), that something
coming through empties the frame and shuts the land up and lets it back
gradually, and that the hour is audible in the beds and in how full the place
sounds. Two of its measurements had to be built carefully, and both lessons
generalise: the alarm test clears any alarm that fired on its own first, or the
repeat guard turns the test's own alarm away and it measures nothing; and the
density test shortens the chorus tide's four-to-seven-minute period, because
four hours measured back to back otherwise land on different phases of it —
which moved dawn from 74% to 30% between runs and said nothing at all about
dawn.

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
- **The ground goes back.** The meadow is one plane in perspective, not a
  stack of ridges: how far below the horizon a thing stands and how big it is
  are the same number, so a rabbit at the back of the field is a quarter the
  size of one at your feet and crosses the frame a quarter as fast. See below.
- **The light comes from somewhere.** Shadows fall away from the sun, stretch
  and soften as it drops, and go out altogether under an overcast sky —
  and a stroke of lightning throws its own, hard, from wherever it happened.
- **The wind has weight.** A gust comes on fast, holds raggedly, and then
  simply drops; it crosses the frame rather than arriving everywhere at once;
  and what it pushes lags into it and springs back past upright when it lets
  go. The grass answers in half a second, the wood in two.
- **The sky comes over.** The weather is three continuous dials, not four
  words, and it drifts on its own the way the hours do — a shower builds from
  a few drops rather than arriving all at once, and fog keeps to the ends of
  the day. See below.
- **Something walks through and the land goes quiet.** A fox, a cat on the
  wall, an otter among the ducks: one bird scolds it, the birds nearest go up
  and away from it, the rabbits bolt, and then nothing says anything for ten
  seconds and creeps back over the next twenty. See below.
- **The rain has depth.** Three bands of it: near drops long, fast, dark and
  leaning hard; far ones short, slow and almost not there. It squalls, it leans
  with whatever the wind is doing, and every drop lands on something — a ring
  where it meets water, a flick of pale spray where it meets ground.
- **Animals notice each other.** A rabbit that sees a fox does not run — it
  stops, dead still with its ears up, and only bolts if the fox keeps coming.
  Pigeons do not freeze at all: they go, and they go together. See below.
- **Things come with young.** A doe walks with a fawn in her tracks, a vixen
  with cubs, a mallard with a brood. See below.

### The things that had never been there

A round of creatures and behaviours, most of which exist to do something no
other animal in the piece does:

- **Turnstones** work rather than run. A party of three to six shuffles along
  the strand line getting the bill under weed and *heaving* — the whole body
  behind it, front end down, tail braced. They arrive together and stay
  together, which is the point: everything else here is alone.
- **A crab** travels along its own width, so the shell never turns to face
  where it is going. It is the only sideways thing in the window. Drawn with
  long radiating legs it read as a spider, which is the one animal a crab must
  not look like; the legs stay under the carapace now and the carapace is
  nearly the whole animal.
- **A seal's head** beyond the surf: up, a long look at the beach, and gone,
  and it does not come back. Drawn as a tall egg it was a rock. A seal's head
  is wider than it is tall, sits *in* the surface rather than on it, and has a
  muzzle.
- **A gull with a shell** carries it up, lets go, follows it down and picks
  over what broke. It is one gesture, so it is one creature with the shell as
  part of it rather than two that have to find each other.
- **Pigeons** on the pavement: the body walks smoothly and the head is held
  dead still and then snapped forward, which is what makes a pigeon read as a
  pigeon at any size. They go up as one — over a cat, a fox, or nothing at all.
- **A moth** at a lit window. It is fastened to a particular window and dies
  when the light does; it does not fly so much as fail to leave.
- **A stoat** bounds, and nothing else here moves like it: the animal is a
  tube, so the back does the work — folding almost double at the gather and
  straightening into a line at the stretch (`GAIT.weave`). Then it stands
  straight up on its hind legs, taller than its own length, and is gone.
- **A bird bathes in a puddle.** This one only happens where the weather has
  already left standing water, so it is the rain that puts it on the screen —
  the surest sign in the piece that one system knows about another. Nothing
  else in the window throws anything.
- **A lizard suns itself**, and it is the only behaviour here that the *light*
  asks for rather than the hour: it comes out when `lit.str` is high, so an
  overcast noon gets nothing and a clear one gets a lizard flat against the
  ground doing nothing at all for a minute. A cat lies out on the warm tiles
  on the same condition, and goes in when the sun does.
- **Mobbing.** An owl caught out in daylight is not left alone. It is one of
  the few things in nature that is a *scene* rather than an animal — neither
  party reads without the other — so the owl and its escort are one creature,
  each small bird on its own loop, shutting the loop down and going in.
- **Movement in depth.** `cr.toward` is a rate of change of depth. An animal
  that has it walks a diagonal: it grows or shrinks, its shadow lengthens or
  tightens, and it slows going away because the plane already said so. None of
  the painters had to be told.
- **Predator and prey.** `Scene.HUNTS` and `Scene.PREY` are two small tables,
  gathered once a frame. Nearness counts in the animal's own terms — something
  at the same distance across the field matters, something two fields back does
  not, however close it looks on the glass. Near enough and a prey animal
  freezes in its most alert pose; nearer still and it bolts. The stillness is
  the tell, and it is far more legible than motion because everything else in
  the field is still moving.
- **Family groups.** A parent with young keeps a short history of where it has
  been, and each young thing is simply *the parent a second and a half ago,
  smaller* (`trailAt`). Everything about the young is therefore right by
  construction: it stops when she stops, it puts its feet where hers went, and
  it slows going away up the field. It needs a step of depth as well as the
  lag — at a doe's walking pace two seconds of trail is a third of her own
  length, so on the lag alone the fawn is drawn inside her. Ducklings are the
  exception: they are actors rather than critters, and they swim in a scribble
  rather than a line, so each gets its own offset and its own rock.

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

**Leaping** — `bound`, `hop`, `lope`, `scamper`, `weave`: gather, drive, a
hollow-backed stretch, and a landing taken on the forefeet with the hind
swinging through. `weave` is the tightest of them, and the odd one out: the
stoat barely leaves the ground, and the arch is what carries it rather than
the height.

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
meadow  clear     −42.3      −25.9     +16.4 dB
meadow  breeze    −38.1      −25.1     +13.0 dB
meadow  rain      −38.1      −23.5     +14.6 dB
forest  clear     −38.5      −20.7     +17.7 dB
beach   clear     −38.6      −21.9     +16.7 dB
beach   breeze    −34.4      −21.8     +12.6 dB
wetland clear     −41.0      −21.4     +19.7 dB
city    clear     −38.9      −18.1     +20.9 dB
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

### What a voice is made of

Every bed here was checked, and none of the *voices* ever were. `tools/voice.mjs`
renders each of the fifty-two calls into an `OfflineAudioContext` on a fixed
seed and takes it apart. The first run said the thing nobody had looked at:

```
                        partials   wobble
  blackbird              0.013      0.25%
  woodpigeon             0.011      0.00%
  owl                    0.009      0.00%
  … 26 of 52 under 0.06
```

`partials` is the fraction of a note's energy that is not the fundamental. A
pure sine reads 0.01 — the analysis window's own skirt and nothing else — and
twenty-six of the fifty-two voices read exactly that, because twenty-six of
them *were* one `OscillatorNode` of type `"sine"`. That is the single sound
everybody recognises instantly as a synthesiser, and it was most of the cast.

A bird is a whistle with a body behind it. Even the voices we call pure — a
blackbird's fluted note, a wood pigeon's coo — carry a second partial ten to
fifteen decibels down and a third below that, and it is those two that make
the difference between a flute and a test tone. So `TIMBRE` in `species.js`
writes out seven of them as partial amplitudes, realised as `PeriodicWave`s
built once per context: `flute`, `silver`, `whistle`, `reed`, `buzz`, `coo`,
`mew`. The rough voices keep their sawtooth — a fox's bark really is closer to
one than to any tidy harmonic series.

Two things travel with the timbre, because they are properties of the same
voice and there is no sense in setting them apart:

- **A hold.** Every note went from its peak straight into an exponential decay
  lasting the rest of its length: measured attack a fifth of measured decay on
  every voice in the catalogue, so every note was a *ding*. `shapeNote` gives
  a note an attack, a hold at level with a slight droop across it, and then a
  decay — and a note in a fast run gets whatever is left, so a trill stays a
  trill.
- **A waver.** Several voices measured a frequency deviation of exactly zero;
  nothing in a wood is that steady. The obvious implementation — an LFO on the
  oscillator's detune — is the wrong *sound*, because an even sinusoidal
  vibrato is an opera singer, not a bird. The curve is written out and handed
  to the param instead: half waver, half slow random drift, depth coming up
  over the first third the way real vibrato develops. It costs no nodes at all,
  where an LFO and a depth gain would have cost two per phrase, and no two
  phrases get the same one.

Amplitudes are pre-scaled to the rms of a unit sine with normalisation off.
Left to normalise itself a `PeriodicWave` is scaled to a *peak* of one, which
would have made every bright voice quieter than the sine it replaced and moved
the whole mix.

Afterwards, nothing reads as a sine, and the mix keeps 16–31 dB of clearance:

```
                        partials   wobble
  blackbird              0.103      3.77%
  woodpigeon             0.088      0.55%
  owl                    0.086      0.27%
  … 0 of 52 under 0.03
```

Two of those readings were the tool's fault before they were the code's, which
is worth recording because both failed silently. Walking raw samples for an
attack time does not work — a sine crosses zero every half cycle, so the walk
back from the peak stops at the first crossing and every voice reported an
attack of half a millisecond. And the first wobble reading took three frames
twenty-four milliseconds apart, which is an eighth of one cycle of a five-hertz
waver, off a spectrum quantised to 23 Hz bins: a held note wavering seven cents
at 400 Hz moves a fourteenth of one bin. It reported dead-steady zeros for
exactly the thing it was built to find. It now steps frames across the whole
note, fits a line through the frequency track so an intentional glide is not
counted as vibrato, and interpolates a parabola through the peak bin.

### Held against the world

Every harness above measures this piece against *itself*: is the mix
balanced, did the frame get slower, is that bed still static. None of them can
answer the only question that matters for something pretending to be a window
onto a field — does it sound like the thing it is imitating.

`tools/reference.mjs` fetches real field recordings, runs the *same*
instrument over them that the other two harnesses run over the synthesis, and
prints the two columns side by side. The instrument lives in `tools/lib/dsp.js`
and all three import it; a comparison between the piece and the world is worth
nothing unless both sides are measured with one ruler.

```bash
node tools/reference.mjs --fetch     # download the clips (once, ~33 MB)
node tools/reference.mjs             # measure and compare
```

The recordings are ESC-50 — five-second environmental clips drawn from
Freesound, assembled by Karol Piczak, the standard reference set for this kind
of work. They land in `refaudio/`, which is git-ignored: they are other
people's recordings under CC BY-NC, used here to measure against and never
shipped.

What it said the first time it ran:

```
                    harmonics    breath    wobble%
  real crow            0.150     0.664      16.06
  ours                 0.338     0.210       0.22
  real rooster         0.328     0.435      25.77
  ours                 0.127     0.003       0.02

                     flutter     drift%   centroid
  real rain            0.129       5.0       3717 Hz
  ours                 0.393       2.3       6454 Hz
  real wind            0.243      38.7       1494 Hz
  ours                 0.302      30.7        379 Hz
  real sea_waves       0.454      20.6       2567 Hz
  ours                 0.644      31.9        351 Hz
```

Four things came out of that, three of them things nobody would have found by
listening for them:

- **The pitch went in straight lines.** Every note glided from f0 to f1 down a
  single exponential ramp, and measured as scatter about its own trend — which
  is exactly what a straight line has none of — the catalogue read 0.0 to 1.2%
  where real animals read 11 to 26%. An animal does not slide evenly between
  two pitches: it snaps most of the way in the first tenth of the note and
  eases after, and it does not travel in a straight line while doing it. The
  glide is bowed now, in log-frequency so the bow is the same musical size
  wherever it lands, with the caller's endpoints kept exactly.
- **Some calls are one sound, not a string of notes.** A cockerel's last
  syllable, a crow's caw: the pitch moves about *inside* a single sustained
  sound. `noteTrain` could only re-articulate, so those were written as flat
  notes. A note marked `link` is not re-articulated and the one before it does
  not release, which lets a gesture be written as segments and still come out
  as one note with a contour in it. The cockerel went from 0.02% to 7.3%, the
  crow from 0.2% to 3.8%.
- **The wind was two octaves too dark** — 379 Hz against the world's 1494. Two
  lowpasses at 420 and 1500 leave a rumble, and a rumble is what a microphone
  in a pocket records. Wind anybody stands out in is mostly the hiss of air
  dragging over things, and that lives above a kilohertz.
- **The sea had no drain.** 351 Hz against 2567: between one wave and the next
  the foam was scheduled to exactly nothing and only the body was left. A beach
  is never silent between waves — the last one is still draining back through
  the shingle while the next is still out, and that drain is most of what a
  beach actually sounds like. It lives high.

And the rain was both too bright and too spattery — a hiss with clicks in it
rather than a wash with grain in it. Three poles of roof instead of two, lower
down, and three times as many drops at a third of the level each.

Where it stands now:

```
                     flutter     drift%   centroid
  real rain            0.129       5.0       3717 Hz
  ours                 0.172       4.2       4680 Hz
  real wind            0.243      38.7       1494 Hz
  ours                 0.257      39.1       1243 Hz
  real sea_waves       0.454      20.6       2567 Hz
  ours                 0.407      31.9       2214 Hz
```

Three cautions on reading any of this, all of them learned by getting them
wrong first:

- **Attack, decay and crest do not survive the trip.** A synthesised call is
  rendered into silence, so its envelope really does fall thirty decibels
  either side of the peak. A five-second field recording is a continuous
  scene: the level never reaches the floor, the walk runs to the edge of the
  clip, and the tool cheerfully reports that a real blackbird has a
  two-and-a-half-second attack. It has no such thing — that number is the
  length of the recording. Where the floor is never reached there is now no
  reading given.
- **Window length is part of the measurement.** Our beds are captured live so
  the reading contains real gusts and squalls; a five-second clip cannot
  contain those. Comparing a twenty-second capture with a five-second clip
  scored our own weather as grain, and the rain looked three times as spattery
  as it was. The capture is cut into five-second pieces and the median taken.
- **The whole bed, not one node of it.** The surf is a body *and* a foam band
  on two separate gains. Measuring only the body said the sea was a 351 Hz
  rumble — true of the half that was measured, and useless. A listener hears
  the sum.

Parity is not the target and should not be. A field recording is a *scene* —
the bird is at a distance, in a room, with everything else that was going on
that morning — so its breath column is partly the wood rather than the animal,
and its wobble is partly the analysis window spanning several syllables of a
call that never stops. What the tool is for is direction and size: it will not
tell you the right number for a wood pigeon, and it will tell you instantly
that twenty-six of your voices are sine waves and your sea has no foam in it.

### One species at a time

ESC-50's classes are broad: one `chirping_birds` bucket stands in for a
blackbird, a robin, a wren and a chaffinch at once. That is enough to discover
that half the catalogue was sine waves. It is not enough to ask whether *our
blackbird* sounds like a blackbird.

`tools/xenocanto.mjs` asks that question. xeno-canto holds half a million
quality-rated recordings filterable by species, sound type and length, and
every entry in `SPECIES` already carries the Latin binomial needed to request
one — so the mapping is exact rather than a judgement call. It queries per
species, takes the top-quality recordings between three and thirty seconds
long, and prints the real bird against ours side by side, with harmonics,
breath, wobble and fundamental in one table.

```bash
export XC_KEY=<your key>            # from https://xeno-canto.org/account
node tools/xenocanto.mjs --fetch    # download — node and curl only
node tools/xenocanto.mjs            # measure — needs Playwright and the server
```

Fetching deliberately needs nothing but node and curl. Reading the species
list by importing `species.js` into a page would have put a browser, a
running web server and a fifty-megabyte dependency between somebody and their
first download; every id sits on the same line as its binomial, so a regex
over the source is all it takes.

Sound type matters and is set per species: most of these birds are being
imitated *singing*, but a crow, a gull and a heron are only ever heard here
calling, and a recording of the wrong one is a comparison against a sound the
piece never makes.

**The key never touches the repository.** It is read from `XC_KEY` and from
nowhere else — never written to a file, never put in the manifest, and
scrubbed out of every error message before printing, because it travels in
the query string and a failed request would otherwise spill it into a terminal
log or a CI transcript. curl's stderr is captured rather than inherited for
the same reason. Passing the key as a command-line argument is refused
outright: arguments end up in shell history and in the process table.

The recordings land in `refaudio/xc/`, git-ignored like the rest. They are
other people's work under Creative Commons licences, mostly CC BY-NC-SA;
`manifest.json` records the catalogue number, recordist and licence of every
one, which is what any use of them would have to credit.

The first real run of it produced a table that was mostly wrong, in three
ways that are worth writing down because none of them announced itself.

**It asked an archive of birds for mammals.** This catalogue contains a fox, a
badger, a roe deer, a house cat, an otter, a hedgehog, a squirrel and a frog.
xeno-canto holds birds, grasshoppers and bats. Asked for `gen:Meles sp:meles`
anyway, the search did not return nothing — it returned three recordings of
something else, which decoded, measured and printed exactly like any other
row. The query is `grp:birds` now, and every recording's own genus and epithet
are checked against what was requested before it is kept; a mismatch is
refused and reported rather than filed under the name that was asked for.

**Its pitch estimator was wrong.** Picking the loudest bin and asking whether
half of it also carries energy put a blackbird at 4784 Hz and a tawny owl at
2423 Hz — a blackbird sings around two kilohertz and an owl hoots at four
hundred. It was locking onto an upper partial. It now takes the strongest
peaks, considers that each might be the first, second, third or fourth
harmonic of something, and scores each implied fundamental by how much energy
its whole comb explains. Checked against synthetic tones of known pitch,
including the case where the second harmonic is louder than the first — the
classic way this fails — it is exact on all of them.

That estimator was upstream of the harmonic column, so correcting it moved the
ESC-50 table too, and reversed a conclusion drawn from it: real crow harmonics
read 0.150 before and 0.476 after, against our 0.34. Our harsher voices are if
anything not harmonic *enough*, where the broken measurement had said they
were too buzzy.

**It reported bandwidth as biology.** Twenty species read exactly 0.000
harmonics. A bird singing at five kilohertz has its second harmonic at ten and
its third at fifteen, and field recordings are routinely high-passed by the
recordist and low-passed by mp3 — so those harmonics were missing from the
*file*, not from the bird. Where fewer than two harmonics fit under what the
recording actually carries, there is now no reading rather than a zero, and
the table prints each recording's bandwidth beside the pitch.

Run against 127 verified recordings of the actual species, it then said one
thing loudly and consistently. Across every bird whose pitch could be trusted,
the real animal carried **three to eight times more of its energy above the
fundamental** than this piece did — a blackbird 0.33 against our 0.08, a robin
0.48 against 0.04, a kingfisher 0.68 against 0.06, a skylark 0.62 against
0.10. The timbres had already been raised once, from bare sines to something
with a second and third partial; that had not gone nearly far enough. Every
tonal timbre is richer now, and since the amplitudes are pre-scaled to the rms
of a unit sine, a richer voice is not a louder one — the energy moves out of
the fundamental and into the partials, which is exactly where the difference
was. The blackbird now reads 0.29 against the real 0.33.

A harmonic share close to 1.0 is the other thing that run turned up, and it is
not a bird: it means the bin the estimator called the fundamental holds
nothing, so everything else counts as "above" it. That is a pitch error an
octave down, and the estimator now requires a candidate fundamental to carry
real weight rather than merely to be non-zero. Anything still above 0.92 is
printed under a heading telling you to disregard it.

Two things still need reading with care. An `f0` ratio within a hair of a
whole octave is far more likely to be the estimator disagreeing with itself
about which partial is the fundamental than a bird singing an octave away from
where it does, so those are listed separately, to be checked by ear rather
than acted on. And a field recording is a *scene* — the bird is at a distance,
in a room, with everything else that was going on that morning — so its breath
column is partly the wood rather than the animal.

### The wind you can hear, and the wind you can see

The audible wind was the last thing in the frame not reading `GAIT.gust`. The
grass, the reeds and the chimney smoke had all been answering it for some time;
the wind itself aimed a `setTargetAtTime` at a new level every few seconds,
which is a smooth swell — and measured against the leaves rustling in the same
frame it was less than a quarter as lively (flutter 0.17 against 0.63). An
exponential approach has no *inside*: it goes to the new level and sits there,
and wind never sits anywhere.

A gust is now written out as a whole curve sampled from the same table — the
long lull, the fast arrival, the ragged top, the drop — and the level, the
cutoff, the moan and the leaves all ride one copy of it, because they are one
gust. Flutter 0.24, and the spectral drift went 7.5% to 29%: it gets brighter
as it arrives, which is what a stronger flow does.

The cost of that is one piece of book-keeping. A curve still unrolling makes
any `setTargetAtTime` inside its span a throw rather than a glitch, and the
weather, the hour and the breath tide all set those same parameters on clocks
of their own. `AudioEngine.set` truncates a parameter known to be riding a
curve before aiming it. `cancelScheduledValues` will not do it — a curve that
*started* before now is not scheduled after now, so it survives the cancel and
the throw happens anyway; it takes `cancelAndHoldAtTime`.

### Everything the same size as everything else

A bird's size came from `15.5 - depth*0.62` — a straight line in a unit
invented for perches — while every mammal in the frame was scaled by
`planeScale(z)` off the ground plane. Two systems, never compared. Drawing
each painter alone on a blank canvas and measuring the ink says what that cost:
at the near edge a blackbird came out **52 pixels tall against a rabbit's 45
and a fox's 43** — a songbird larger than the fox that eats it.

The unit was already there and unread. Ground perches are literally built as
`depth = 2 + z*12`, so `perchZ()` reads it back and birds are sized by the same
`planeScale` as everything standing on the ground. Three things follow at once:
the falloff is perspective rather than linear, birds are in proportion to the
animals under them, and a perch generated nearer really does carry a bigger
bird. Measured at matched depth, a bird is now 0.65 of a rabbit's height —
which is about what a blackbird is against a rabbit.

Below about eleven pixels `paintBird` has its own floor of minimum line widths
and stops shrinking, so the ratio drifts at the far end of the field. At that
size nothing is being judged for proportion.

### What a bird is standing on

The branch under a perched bird was scaled by `s` — the *bird's* size — so it
grew and shrank with whatever landed on it rather than belonging to the tree it
grew from; a wren and a raven on the same twig changed the twig. And there was
exactly one branch: the same quadratic, the same sweep, the same lean, under
every bird in every place for a whole session, which is the kind of repetition
the eye finds long before it can say why.

Perches now carry two things. `hostS` is the size of what the perch grows out
of — the field oak's boughs are an arm's thickness, a hedge top is a springy
twig — so the branch is proportional to its host. And `bseed` is a number
drawn once at build time, from which the branch takes its direction, its reach
either side of the feet, its droop, and whether it forks. Each one is its own
branch and stays its own branch for the session.

### A fox is a spine before it is anything else

The pounce was a stick being flicked, and it could not have been anything else:
the body was one fixed outline, `crouch` shifted it up and down as a block, and
`rot` turned the whole animal about a point. There was nothing in it that bent.

`bend` is a curvature of the back — positive coils it, arching the dorsal line
and tucking the belly; negative hollows it into the long reach of the stretch.
It is applied as a displacement greatest at the middle and falling to nothing
at the shoulder and hip, because that is where a spine bends and where it does
not, and the body outline, the tail root, the brush and the head all read it so
the animal curves as one thing. The pounce drives it through the real sequence:
coil to a hoop, unwind past straight into a hollow-backed reach at the top of
the arc, gather again to come down nose-first, absorb on landing. Even the trot
now has a little of it, because a trotting fox's back is not a plank either.

The joins are what this cost the first attempt: the tail root and the neck were
given fractions of the arch while the body took all of it, and the brush and
head detached from the animal at full stretch. They take the same displacement
as the part they grow from now.

### And a stoat stands up by sitting back

The rearing pose was `rotate(-rear*1.28)` on the whole drawing, which is not
what a stoat does and could not be made to look like it. Rotating about the
feet swings the hind feet off the ground and up into the air; it carries the
tail round with the body instead of letting it drop; and it keeps the spine
the same rigid arc it had on all fours, only tilted. A plank being levered
upright.

What the animal does is sit *back*. The hind feet stay flat where they were
and take the weight, the hips drop over them, the spine straightens into a
long S — curving back off the haunches and forward again into the shoulders —
the forelegs come up and dangle at the chest, and the tail curves down behind
to the floor so the whole thing stands on a tripod. So none of it is a
rotation now: every point is carried from its four-footed place to its upright
one, and the parts that belong on the ground stay on the ground.

The back is one cubic in both poses so the two can be crossfaded — the
quadruped's quadratic is converted to its exact cubic equivalent (control at
P + ⅔(Q − P)) and the upright pair written directly, so the bound is
bit-for-bit what it was and only the rise is new.

### The city, from a roof beside a street

The city has been three things. It began as an elevation: a row of buildings
on a street, seen flat-on from somewhere unspecified, with the bottom twentieth
of the frame given over to a pavement nothing could use. Then it became a
rooftop — the right decision, and the one that gave everything that walks a
floor to walk on. But it was a rooftop with a *panorama* in front of it: a rank
of slabs standing shoulder to shoulder along one flat line, evenly lit, with
nothing to look at and nowhere for the eye to go.

What was missing was a hole in it. A city seen from above is not a wall of
towers; it is a wall of towers with a bright slot cut down through it, and
every good picture of one is composed around that slot. So the street comes
first now and everything else is arranged around it.

```
CITY_EYE      0.478   your own eye level — anything at your height is on it
CITY_PARAPET  0.800   where the deck stops and the parapet wall starts
CITY_WALL_RUNS        three runs of wall, at three heights
```

**The near edge was a shape that could not be built.** For a long time
`CITY_PARAPET` was the single nearest point of the near edge, and the edge
climbed away from it up both sides of the street — a shallow V with the view
down the middle. It was the strongest thing in the composition and it was
impossible.

A straight edge in the world does one of two things on a picture. If it runs
away from you it converges on the vanishing point; if it lies across you it
stays level. Those two arms did neither: they *diverged* from the point the
street ran to, which is a thing no wall can do at any angle from any viewpoint.
That is why the near ground never read as a roof however carefully it was
detailed — the eye had already worked out that the floor it was standing on was
not a shape. It also made the roof enormous. The arms reached eye level at the
corners of the frame, and a floor whose far edge is at the horizon is a floor
several hundred yards deep.

The wall you are behind is the front of the building, and the front of the
building lies across you, so it is level. It steps twice — the two ends of the
building stand higher than the middle, which is what parapets actually do and
what stops a level wall reading as a bar ruled across the picture. The stretch
you can see the city over is the low run in the middle, which is also where the
handrail is, because a rail goes where a parapet is too low to lean on safely
and nowhere else.

What is left is a roof about a fifth of the frame deep, which is what a roof
looks like from a roof, and a great deal more city than the wedges used to
leave room for.

The street itself is one perspective, and it is the same one every plane in
this piece uses: how far down it a thing is gives its height on screen, its
width and its size together, so a stall, a lamp and a person at the same
distance cannot disagree with one another. What is down there is a market —
awnings along both kerbs, sodium lamps on the near side of them, and people
walking between. The people move at a constant rate *in the street*, not across
the picture, so one at the far end creeps and the same one arriving at the near
kerb is striding, and neither of those had to be asked for.

Two mistakes are worth writing down because both look like arithmetic and are
actually composition. The street's furniture was scattered evenly along the
street, which with the far end six times off put nine stalls in ten into the
top third of the slot and swept the near half clean; it is scattered evenly
down the *picture* now, and the perspective is inverted to place it. And the
people were sized as a fraction of the frame's height rather than of the road
they stand in, which made everyone in the street a giant in a narrow window and
a mouse in a wide one — the same street, the same people, two different cities.

**What is actually down there.** A slot with a gradient in it and some marks
moving about is a *diagram* of a street. This one is a **way** rather than a
road — too narrow for anything with wheels, paved from wall to wall, and the
only things that come down it are on foot, which is also why the market is
allowed to stand in the middle of it. There was traffic for a while, and it is
gone: a parked van and a car working up the middle, which read as a street but
made it the wrong kind of street.

So the floor is one surface, and what gives it depth is the courses across it,
laid out along `u` so they crowd toward the far end exactly as real setts do —
worth more for the depth of the street than anything standing on it. They are
faint, and crossed by joints staggered course to course the way flags are
actually laid: at full strength and running unbroken from wall to wall they
read as *steps*, because any set of strong parallel horizontals converging on a
point always will. Break them into cells and a cell is a floor. Against
each wall is a band of different paving where the gullies and gratings go, and
down the middle a runnel, which is how a street with no gutters gets rid of its
rain and is the one line in the floor that runs *away* from you rather than
across.

**And it keeps the market's hours.** The shops here are shut by daylight —
rollers down, corrugations across them, the box the shutter winds into above —
and the stalls are not out at all: what is left in the morning is a trestle
folded against the wall under a sheet, which is a low pale wedge and takes four
lines. At dusk the whole of it opens: the shopfronts light, the canopies go up,
the lamps come on under them, and the vendors appear behind the tables. It is
the largest thing the hour does to this place and it costs one branch.

Drawing the whole market and turning its lights off would have been easier and
much worse — a night market standing empty in the sun is a stranger sight than
either state on its own.

**The people are people.** They used to be two marks, a body and a head, on the
argument that nothing else survives at that size. That is true at the far end
of the street and false at the near end, where a figure is thirty pixels tall
and two stacked rectangles read as a bollard.

Then they were built out of *strokes* — a line for each leg, a line for the
arm, a rectangle for the trunk — and a stroked line has no mass. Whatever you
do to a stick figure it stays a stick figure, and thirty of them is a diagram.
So nothing about a figure is stroked now. The trunk is a coat: one closed
silhouette, domed at the shoulders and swinging wider at the hem, which is the
shape a person makes when you are too far off to see a person. The limbs are
tapered *filled* shapes — the same `limb` every animal in this piece is built
from — so they thicken toward the body and run out toward the hand and the
foot. And the whole figure takes one gradient across it, lit from wherever the
sun is, because a flat silhouette is a paper cut-out and this is the one thing
in the frame there are thirty of.

None of that is articulation. There are no joints, no IK and no per-limb
behaviour. It is a blob with a weight to it, which at eight storeys is
everything a person is.

**What the crowd is doing.** A street where everybody moves at their own fixed
rate in one direction for ever is a conveyor with figures on it. What makes a
crowd read as a crowd is that its members are each in the middle of
*something*, and that those somethings are different lengths and interrupt each
other. Four states, and no more — this is a hundred yards off and eight storeys
down, and anything finer is invisible:

```
walk    their own pace, going somewhere
hurry   twice that, leaning into it, for a while
browse  stopped at a stall, turned toward the trestle
talk    stopped in a pair, turned to face each other
```

`talk` takes two and both have to agree to it, so it looks for somebody nearby
who is only walking and stops them both, stands them a comfortable distance
apart facing each other, and offsets their gestures by half a cycle so one
talks while the other listens. A figure standing alone gesturing at nothing is
worse than no conversation at all. `browse` picks whichever stall is actually
nearest — and only when the market is open, because somebody gesturing at a
folded sheet in the morning is worse than somebody simply walking past it.

There was a fifth. `yield` took everybody near the moving car out of the road
at once, and a crowd doing one thing together is the clearest sign they are all
in the same world — but the car is gone, and a behaviour with nothing to
trigger it is not a behaviour. Browsing is what the crowd does together now.

**Where a bird is allowed to land.** There used to be three perches on the
roofs of the buildings across the way, and they were wrong twice over. Wrong to
look at, because those roofs are a street's width off and a bird standing on
one is a speck against a wall of windows — the eye never finds it, so the whole
point of putting a singer where it can be seen is lost.

And wrong to *measure*, which is the more interesting half. A perch's depth is
`2 + z*12`, where `z` is a place on the deck plane you are standing on. A
building's `z` is a different quantity in a different space — how far back the
block sits among the other blocks — and feeding one into the other put a bird
on the near-right roof at depth 3.6 against a bird on your own parapet at 14.
The further off it stood, the *bigger* it came out, by nearly a factor of two.
Every perch now takes its depth from the one plane, which is the only way the
sizes can be made to agree; the animals on the ground already did, through
`groundDepth`, which is why they were never wrong in the same way.

**And they walk rather than skate.** The gait used to advance with `p.sp*dt` —
speed along the *street* — and the street is in perspective, so the same speed
is a crawl at the far end and a stride at the near one while the legs turned
over at one rate throughout. That is skating: feet going round at one rate over
ground going past at another. Worse, both feet moved on a sine, so neither was
ever *planted*: a real foot spends most of its cycle on the ground travelling
backward relative to the body at exactly the speed the body goes forward, which
on screen means it does not move at all.

So the legs are given the distance the figure actually covered across the
picture — measured, not derived, because between the perspective, the drift
across the width and somebody easing into a stall there is no closed form worth
trusting. A foot runs linearly from +A to −A through its stance and swings back
faster, with a lift only while it is off the ground. `WALK_A` and `WALK_D` (how
far a foot travels, and the share of the cycle it spends down — a little under
two thirds, which is why a walk has a double-support phase and a run does not)
live in one place, because the painter and the update have to agree about them
to the letter and a walk where they disagree even slightly is a walk on ice.

A straight hip-to-foot limb reads as a pair of scissors, though, and the one
thing a leg does that a scissor blade does not is *bend*. At this size the knee
is the only joint worth having: nearly straight through the stance, taking the
weight, and folded hard through the swing to get the foot past the ground —
which is also why a walking figure's silhouette changes shape rather than
merely shearing. The arm gets an elbow for the same reason and bends the other
way. Both are gated on drawn size, so a figure at the far end keeps the
two-fill straight leg it can afford and nobody pays for a knee they cannot see.

Measured on the running piece: a body moving 0.51 px a frame carries a planted
foot 0.013 px with it. Standing still measures zero travel and therefore zero
gait, which is also right — a figure at a stall does not paddle.

Two things had to be got right for any of it to work. The crowd decides things
as it goes, and deciding them off `Math.random` would draw from the same stream
the animals spawn from, in an order that changes with the traffic — so the same
seed would grow a different set of animals depending on when somebody down in
the street happened to stop for a chat. Every walker carries its own generator
instead. And the person somebody is talking to is stored as an *index* rather
than as the object: a pair pointing at each other is a cycle, and
`trajectory.mjs` JSON-stringifies every argument handed to every painter, so an
object reference there would not have been a wasteful field. It would have been
a crash in a bench.

**The bridge over the street** was a slab: one thin rectangle half again wider
than the canyon at each end, floating clear of both buildings with nothing
holding it up. It is an enclosed glazed link now, which is what a thing at that
height over a street actually is — it lands *on* the walls rather than floating
past them, it has an underside you are looking up at, and it throws a shadow
down the far wall.

**How near the roof is** is one number, and it is the fourth argument to
`makePlane`. Left at its default the deck ran from a scale of 1.25 at the bottom
of the window to 0.69 at the wall — so everything standing on it and everything
*landing* on it was drawn at two thirds size at the far edge, and a pigeon on
the parapet came out the size of a sparrow. The roof is a fifth of the frame
deep; it should read as something you could cross in a few strides. Raising
that term brings the whole deck forward together — the plant, the cast, and
their shadows, all by the same amount, because all three read the same
function.

Around the slot: the pair of buildings that lip it, which are what the frame is
built on. The left goes up out of the top of the picture with a banner down its
inner corner. The right is *lower than you*, so its roof is a floor of pipework
laid out below your eye — pipe runs with elbows that turn down over the parapet
and into the wall, plant boxes, and a hoarding hung flat on its face over the
street. A building lower than the viewer, seen from above, is the single thing
that most says you are up somewhere. Behind those, the rest of the city; behind
that, the far rank, nine tenths of the way to the sky; and in it one landmark,
because every real skyline has the building everybody names and without it a
skyline is a bar chart.

**What is fixed and what is drawn afresh.** The street's place in the frame,
how wide its mouth is, where it runs away to and the footbridge across it are
all constants — as, now, is every building in the view (see above). A composition that is
different every time is not a composition. What the seed decides is what
*stands* in it: how many buildings, how tall, how wide, how they are shaded,
how many windows are lit and when they change, how many hoardings and banners
and what is on them. You do not get a different street; you get a different
evening on it.

**Signs, and why they are panels.** They used to be lengths of tube. A city's
signs are not lengths of tube — they are panels: a tall narrow banner down a
corner with marks on it, or a lit hoarding on struts with a picture. The marks
are deliberately not letters. Anything legible at this size is either a word in
a language the piece has no business choosing or a smear the eye keeps trying
to read and cannot; a squiggle, a bar and a blob are what a sign at three
hundred yards actually resolves to. Each panel is a board whether it is
switched on or not, so by day the city is covered in unlit hoardings, which is
also true.

**A line round everything.** Every solid thing here is drawn and not merely
filled — near lines heavier than far ones, scaled to the frame rather than left
at a fixed pixel. This is the single thing that makes thirty overlapping
rectangles read as a drawing of a city instead of as a stacked bar chart, and
it is worth more than any amount of shading. Its companion is that no two
buildings are the same colour: a shade either way, which is nothing on one wall
and everything on thirty. The near ones only ever get the darker half of that
swing, because paler *is* further here and a near building that comes out paler
than the rank behind it reads as a hole in the city.

**One warm thing.** A city is cold stone with hot light in the cracks, and if
the stone is also warm there are no cracks. The street is the only warm thing
in the frame and everything else is read against it — which is why the walls
are a genuinely cool slate after dark and why the deck is the palest thing in
the lower half of the picture. That last one is not a stylistic choice: a
rooftop is a flat horizontal surface with the whole sky falling on it, standing
among vertical ones that have only the narrow band of sky they happen to face.
Painting the near ground dark, which is right for a hedge and right for a dune,
made a rooftop look like a hole.

**Its own palette, and its own sky.** Every other place in the piece is a warm
etching: one brown ink, mixed with the sky at whatever ratio the distance calls
for. The city has its own tokens because that will not do here — and its own
sky in three bands rather than two, because a real sky at either end of the day
is cool overhead, warm at the horizon and something else again in between. The
pink between a dawn's violet and its gold is a band, not a crossing point. The
third stop lands on the city's own eye line, so the warm strip sits behind the
skyline instead of below the parapet where nothing would ever see it.

Its walls also change colour with the hour rather than only in value. Mixing
one grey with the sky gets a city right at midnight and exactly backwards at
noon: a city at noon is warm brick and tan concrete against a cold blue sky,
and the same city at midnight is cold slate against a warm-lit one. So there
are four wall colours, blended over the turn the way the sky is. And what
distance mixes them *toward* is not the colour of the sky sitting on the
skyline but the colour of the air a third of the way up it — mixing toward the
horizon band itself turned every distant tower the colour of the one bright
stripe in the picture, and a night city came out teal from top to bottom.

The city is also lit on its own clock. `nightness` answers a question about the
sky; `cityLit` answers one about the city, and they are not the same question.
A street lamp and a shop sign come on the moment the sun is off the buildings
and stay on until well after it is back, so at dusk the signs are at full
strength against a sky that still has colour in it and at dawn they are still
burning while the horizon goes gold.

**What is up here with you.** A roof reads as real when its plant is a *system*
and not a scatter of boxes, so nothing on this one is standing anywhere a
builder would not have put it. There is one way up and it is the stair
bulkhead, which is the only object on the roof with a door in it and therefore
the only one that gives the deck a human scale to measure against. The two
condensers stand on housekeeping pads, because nothing heavy is ever allowed to
sit on a roof covering, and a duct on sleepers runs between them. The vent
stacks come up in a group, because the risers under them are in one wall, and
each has the flashing collar round its foot that a pipe coming out of a flat
surface always has. There is a water tank on a braced frame with a ladder up
it, a dish, a hatch standing open the way every roof hatch is left standing
open, and a string of bulbs along the wall that nothing in the city put there —
somebody who comes up here did.

The covering itself is the other half of it. A flat roof is not a slab you
could park on: it is bitumen sheet laid in metre rolls running down the fall,
lapped at every course, dressed up the parapet at its edges and held down with
gravel ballast. All four of those leave a mark, and between them they are what
tells the eye it is a roof rather than a terrace or a car park. Then the water:
it is laid to a fall toward a drain, and where the fall is not quite true it
stands and leaves a ring. Ponding is the single most convincing thing on any
real roof and it costs three ellipses.

One thing is placed for the picture rather than for the building — a large duct
close enough to be cut off by the bottom of the window. Without it the deck was
a band of objects at much the same size, and a band of objects at the same size
is a backdrop: the eye has nothing to measure the near end against and the floor
collapses to a strip. One big near object does more for the depth of a roof
than everything standing behind it put together, and it is what every
photograph taken from a roof has in the corner of it.

Every one of these is also a perch, and each reads its distance back off the
plane, so a pigeon on the bulkhead is a different size from one on the wall.

Three things had to be undone along the way. The two telegraph poles were
street furniture rooted in the floor, and a street pole standing eight storeys
up was the loudest thing wrong with the view; they became cables, and the
cables in turn were ruled from one edge of the window to the other at eye
height, which put two hard horizontals straight through the skyline. A wire
crosses the gap it has to cross: they span the canyon now and stop at the
buildings either side of it. The cat carried a block index because it walked
the top edge of a building across the way — it is simply an animal on the
ground now. And a sign used to be painted after every wall in the frame, which
put a distant building's banner flat on the face of the near slab standing in
front of it. A sign belongs to a building; it is painted with it.

What the city costs, and what was done about it, is its own section above —
short version: it was the most expensive place in the piece by a factor of
four, the cost was overdraw rather than submissions, and the composition being
written down is what made it possible to stop paying for it twice a frame.

One note on looking at any of this. The sky is painted on a *second* canvas
behind the scene one, so a probe that grabs `scene.ctx.canvas` gets a picture
with no sky in it — which is what every render in this repo's development did
for a long while, and why several of them look oddly pale at the top.
Screenshot the stage element instead.

### The city is written down

Every other place here grows from the seed. Where the trees stand, how the
hedges run, which way the shore lies — all of it is redrawn from a fresh number
each session, and for a field that is exactly right, because a field is a
texture and any acre of it is as good as any other.

It is not right for a city. A city view is *composed*: the street goes there,
the near slab holds this edge, the eye is led down that slot. A composition
that is rolled again from scratch every session is not a composition — it is
twenty arrangements of the same parts, and the good one is an accident that
happens once and is never seen again. The generator was already fighting this:
two of its towers were placed by hand as "the pair that lip the street", two
more were nailed to the edges of the frame, and the landmark on the skyline
carried a comment saying it was drawn rather than generated *because a skyline
needs one shape the eye can hold on to*. That argument was right, and it was
being applied to exactly one building.

So the frame is written down. `CITY_BLOCKS`, `CITY_SKYLINE`, `CITY_ROOFKIT` and
`CITY_PERCHES` are the whole of it: where every mass sits, how deep it is, what
it is built of, and where a bird can land. None of it moves between sessions.

What the seed still does is *dress* it. Every field in a block is one of two
kinds, and the two used to come off the same stream:

```
composition (written down)          dressing (still the seed's)
  x, w, z, top — where a mass is      which windows are burning, and when
  which blocks lip the street         what is printed on the hoardings
  the skyline's silhouette            which way a vent is pointed
  where the perches are               how the smoke goes, where a beacon is
```

Which is how a real view works, and it is a better fit for the piece than the
roll it replaced. This is a *window*. Windows have fixed views; what is living
about them is the light, the hour, the weather and the company. You do not get
a different street — you get a different evening on it, and the same pigeon
comes back to the same rail.

That last part is not a small thing. A perch used to be wherever the generator
happened to leave a flat surface, so the cast of a session landed in a
different set of places every time and the frame could never be composed around
any of them. They are chosen now: the near rail where a pigeon is close enough
to read, the two arms of the parapet, the kit on the deck, three roofs across
the street at their own depths.

### A building is a box

Every block was one rectangle, filled flat, with a pale strip down its left
edge standing in for a lit corner. Twenty of those is not a city; it is a bar
chart with windows on it, and no amount of texture on the face was going to fix
it, because what was missing was not detail. It was the third dimension.

A block is drawn now as what it is: a front face, one side of it, and — if its
roof is below your eye — the roof itself, all three running to the same
vanishing point the street runs to. Which side you see follows from where the
block sits: one to the left of the point shows its right flank, one to the
right shows its left, one straddling it shows neither, exactly as a real row
does. Whether that flank is the lit side or the shadowed one is not a matter of
taste either — `updateLight` has known where the sun is since the sky was
drawn, and the flank reads it.

Three materials, because a facade is not a grid of holes, it is a substance,
and the three are told apart at a glance long before any one window can be made
out:

```
brick     warm, small punched openings, a course line at every floor
concrete  pale bands of spandrel with a darker glazing ribbon between
glass     a curtain wall — mullions the height of the building, and the sky
          in it rather than a colour of its own
```

How much of any of that is drawn is decided by how big the building lands on
the screen and not by how far off it is supposed to be — those are the same
question and only one of them can be measured. Under about four pixels a bay
there is nothing to draw but a tint; over about nine there is a frame, a
mullion and a sill worth having.

### A flat fill is a cutout

Everything standing in this city was one colour per face. The tank was a
rectangle with lines ruled down it, the condensers were crates, the vent stacks
were paint tubes and the vehicles were two boxes stacked. More outline on any
of them would not have helped, because what was missing was not detail.

A flat fill is not what a surface looks like. It is what a *cutout* looks like,
and a roof full of cutouts is a collage. Light falls off across a face — a
little, and always in the same direction — and that fall-off is nearly the
whole difference between a box and a rectangle. `faceRamp` puts one gradient on
each face, keyed on `updateLight`'s own idea of where the sun is, so every
surface in the frame agrees about it. It costs one gradient a face and it is
worth more than any amount of line work laid over the top.

Round things needed more than a ramp. `cylinder` draws a standing cylinder as
one: the light wraps round it, bright a third of the way from the lit side and
falling to both edges, and its foot is an *ellipse* rather than a line, because
you are above it and the end of a cylinder is a circle. Once that existed the
tank could be a tank — staves spaced by the sine of the angle round the barrel
so they crowd at the edges the way real boards do, hoops that are arcs going
round the back rather than straight lines crossing the front, a cone with a
curved eave and a finial, and the ladder standing off on its own brackets
instead of lying flat on the side.

The rest followed from asking what each thing actually is:

- A **condenser** is a machine, not a crate. It stands on a skid, the skid
  stands on a housekeeping pad because nothing heavy sits on a roof covering,
  its flanks are close-set coil fins, and the fan is sunk into the lid behind a
  ring guard — drawn on the *top* face, so its guard is an ellipse squashed the
  way the lid is. Nothing else says "seen from above" so cheaply.
- A **vent stack** has a flashing collar at its foot and a goose-neck at its
  head, turned over so rain cannot go down it.
- A **bulkhead** has a hood over the door on two brackets, a threshold to step
  over, and a handle on the side it opens from.
- A **vehicle** is a silhouette before it is anything else, and the silhouette
  is the whole of what tells a van from a car at forty yards. A bonnet that
  starts at the roofline is a shape no car has ever had. Each is one path now —
  car with a raked screen and a boot, van with a low nose and a high box — and
  the wheels sit *in* arches, because a wheel drawn outside a body is a trolley.

One bug worth writing down, because it is the kind that only ever appears in a
finished drawing. Two arcs in a single path are joined by a straight line from
the end of the first to the start of the second — so the tank's two hoops came
with a strap running diagonally across the barrel, at an angle nothing else in
the frame was at. One path per hoop.

### What a frame in the city actually costs

Measured, the city cost **34.8 ms a frame against a budget of 16.7**, and better
than twice what any other place here costs. The first thing tried was the
obvious one: the concrete facades were emitting two `fillRect`s per floor per
building, which on a forty-storey slab is eighty rasterizations on its own.
Batching them into one path each took the submissions from **874 to 462** and
moved the clock **not at all**.

Which is the whole diagnosis, and it is exactly the distinction `?perf=1` is
there to make. A frame in this city is not made of submissions, it is made of
*fill rate*: twenty large opaque faces, each painted over the top of the one
behind it, with a facade over each of those again. No amount of batching
touches overdraw.

What touches it is not painting it again. The composition is written down now,
so the only things in the frame that differ between one sixtieth of a second
and the next are the lights, the people down in the street, and the smoke.
Everything else — every wall, every window grid, the whole floor, the whole far
rank — is the same picture it was a moment ago and can simply be kept.

It is kept as **two** layers rather than one, because the things that move have
to go *between* them:

```
  blit   the far rank, and the buildings behind the street
  draw   the lights burning in them, their signs, the smoke
  blit   the street, the two blocks that lip it, and the roof you stand on
  draw   the people, the lamps, the bulbs along the parapet
```

Anything the near layer covers is thereby covered, which pays for itself twice:
a light in a far tower that falls where the street is gets painted over by the
street, exactly as it would have been had the whole thing been drawn in order.
Within a layer there is no such protection, so the bake also works out once —
and never again until it is rebuilt — which windows have a nearer building
standing in front of them.

The layers are rebuilt when the size changes, when the land is reseeded, when
the theme changes, and on a coarse step of the light. Built at device
resolution, not layout resolution: this city is nothing but lines, and a layer
blitted back up from the logical size would arrive a pixel and a half thick.

```
                before    batched     baked
city            34.8 ms   35.4 ms     5.9 ms
ops per frame       874       462        74
```

Read those the way `bench.mjs` means them: a software rasterizer, 1920×1080,
and the hour pinned to day — which is the cheapest hour the city has, because
nothing is lit and no glow is blitted. A night frame costs more. What does not
change with the hour is the shape of the win, because what was removed was the
overdraw and the overdraw is the same at midnight.

From four times the cost of the meadow to below it — and the point of that is
not the number. It is that detail in a baked layer is very nearly free, so what
the city can afford to *be* is now a different question entirely. The plant on
the roofs you look down on, the streaking on the deck, the grain in the far
rank and the gradient seating every building in its own depth all went in
*after* this, and together they cost less than a millisecond.

### Three materials instead of one ink

Every solid thing in the land was `mix(ink, skyBottom, k)` — one dark warm
brown, mixed with the sky at whatever ratio the distance called for. That is a
single hue for the entire world: grass standing on ground was the same colour
as the ground, a tree was the same colour as the hill behind it, and the whole
picture collapsed into a brown fog with shapes in it.

A landscape reads because its materials are different substances, so there are
three now, kept close in value — this is still an etching — but far enough
apart in hue to tell one from another:

```
--scene-leaf    #27301b   foliage: green, and the only green here
--scene-earth   #3a2c1c   bank, trunk, ploughed ground: warm
--scene-stone   #2c2b30   rock, brick, shingle: cool, slightly violet
```

The ground plane is earth washing to the sky at distance, its tonal patches
are leaf, the grass and undergrowth are leaf, and the crowns are leaf. What
distance does is unchanged — the far end still washes toward the sky, because
that is what air does — but the *hue* of the thing being washed now differs
from the hue of what stands on it, and the frame acquires depth it could not
have had before.

One consequence had to be paid for. Foliage that is no longer near-black does
not recede on its own: at the old wash of a tenth, distant crowns came out
pale, saturated and pasted onto the haze. A far tree is very nearly sky, so
the wash runs to nearly half at the back of the field.

### Bushier

`smallTree` was three circles — a big one with a smaller one either side —
which is a lollipop with two ears, and every tree in every place had the same
three. A crown is many masses of leaf at many sizes with a broken edge. Nine
lobes now, placed on a seed taken from the tree's own position so each tree
keeps its shape all session and no two are alike.

They go into *one* path and one fill. An `arc` following a previous subpath
draws a line to it, so each lobe opens with a `moveTo` — and a crown of nine
masses then costs exactly what a crown of one did. Measured before and after,
the ops per frame did not move.

### Beds that are two sounds rather than one

A bed can be perfectly granular, perfectly weathered, and still contribute
nothing but mush — because of where it sits rather than what it is. Two beds
in the same octave are not two sounds, they are one hiss, and the texture
bench measures each one alone so it could never say so.

Two collisions were hiding in plain sight in that table:

- **Rain at 4.7 kHz against leaves at 4.8 kHz.** A wood in the rain was one
  undifferentiated seethe. Rain is also, separately, an octave brighter than
  real rain measures. Both are fixed by the same move — a roof over the whole
  bed rather than over the wash inside it. Darkening the wash alone had made
  matters worse: it left the drops, whose short rings are broadband, as the
  brightest thing in the bed, and the measured centroid went *up*. The drops
  are what makes rain grain rather than hiss, so they stay; they simply do not
  get to be the top of it. 3341 Hz now, against the world's 3717 and well
  clear of the leaves.
- **Traffic at 1.1 kHz against wind at 1.4 kHz.** A breezy city was one
  mid-range wash with no street in it. The tyre-noise band had a Q of a half,
  whose skirt reached an octave above where it was centred; tyre roar is lower
  and narrower than that in life. 553 Hz now.

### What a mammal has that a bird does not

The mammals were the least examined voices here — xeno-canto holds birds,
grasshoppers and bats, so the one comparison that works species by species
cannot see them at all, and ESC-50 has only a cat. They were still bare
sawtooths through a band-pass long after the birds had been rebuilt.

A sawtooth is not wrong about a bark's spectrum. It is wrong about everything
else, and the two things it misses are the two that matter:

- **A throat.** The one feature that separates a mammal's voice from a bird's
  is a long resonant tract above the larynx with *fixed* resonances — they do
  not move when the animal changes pitch. That is why a fox barking high and
  barking low both sound like a fox, and it is exactly what a band-pass cannot
  do: a band-pass has one hump and no character. `FORMANT` gives each mammal
  two or three peaking filters at frequencies belonging to the animal rather
  than to the note, and `throat()` returns the node to sing into. Big animals
  get low, closely spaced ones; small ones get high, wide ones.
- **An unsteady larynx.** A mammal's vocal folds do not vibrate evenly: the
  pitch shakes, wanders and breaks, and the ear reads that unsteadiness as an
  animal rather than an oscillator. The `bark` and `growl` timbres carry three
  times the waver of any bird here, and it is fast.

The harmonic share moved the way a vocal tract moves it — deer 0.41 to 0.60,
heron 0.34 to 0.79, badger 0.35 to 0.87 — which is what a real mammal reads,
because in a real mammal most of the energy is in the formant region and not
in the fundamental at all.

### Noise, and how it stops sounding like noise

Nearly every bed here is filtered noise, and filtered noise is one small step
away from static. What separates them is measurable, and `tools/texture.mjs`
measures it — two numbers per bed, taken from the bed's own tap:

- **flutter** — the standard deviation of the short-term level as a fraction of
  its mean. Static holds one level and scores near zero. Anything granular —
  leaves, foam, rain on a roof — is thousands of small events and scores high.
- **drift** — how much the spectral centroid moves. A fixed filter on steady
  noise never moves; water gets brighter as it breaks and darker as it drains.

The leaf bed is the reference. It already did the granular trick — a second
noise source taken down to a few hertz and used to modulate the level, which is
noise driving noise, two nodes, and what the real thing is — and it is the one
bed nobody ever complained about. Three others were not doing it:

```
                    flutter          centroid
                 before  after    before   after
the record's hiss  0.037  0.559    3814 →  2206 Hz
surf foam          2.257  2.768    8623 →  3402 Hz
surf body          0.328  0.639     470 →   440 Hz
rain               0.395  0.395   10227 →  6463 Hz
leaves (reference) 0.593    —      4863        —
```

**The record's noise floor** scored 0.037 — the flattest thing in the piece,
and the textbook description of static. Two things were wrong and they
compounded. It ran *into* the glue compressor, so between beats, when the only
signal is the noise floor, the glue released and its makeup gain lifted the
hiss by the better part of twenty decibels. And the hiss did not move at all.
It now goes in after the glue and is never compressed — which is where a
record's surface noise belongs anyway, on the record rather than in the
mastering — at a third of its old level, darker, and granular. What carries
the character instead is **crackle**: two to five small ticks a bar, none in
the same place twice, most barely there and one now and then you actually
notice. (Those went through the hiss's own gain at first, which is to say at a
hundredth of their amplitude. A click at a hundredth of its amplitude is not a
click.)

**Surf foam** was a high-pass at 1100 Hz on pink noise and nothing else, which
measured a centroid of 8.6 kHz. That is a cymbal. Breaking water lives between
about seven hundred hertz and four kilohertz, so the band is closed at both
ends now, and it is granular too — foam is bubbles.

**Surf body** is swept by the wave scheduler, so during a wave it moves
plenty. Between waves it did not move at all, and the sea between waves is most
of the time. It breathes on its own now.

**Rain** was white noise split at 1 kHz and weighted. White noise carries as
much power in the octave above ten kilohertz as in the whole of the rest of the
spectrum, so that still left a centroid of 10.2 kHz — television static. It has
a two-pole roof at 4.2 kHz now (one pole was not enough: at 6 dB an octave it
only came down to 8.4 kHz), and the wash has **patter** written into it — some
240 individual impacts a second, each a short ring on whatever it landed on.
The loop is pre-rendered, so a downpour costs exactly what a drizzle does at
run time, which is nothing.

One trap worth recording: the modulation is *added* to the texture gain, so a
base of 1 with noise swinging around it averages more than one and peaks a
great deal more. Left uncompensated it put ten decibels back on the beach and
took a bird's headroom there from twelve to six. Base and depth are set
together.

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
a sine bass, a brushed kit, and a surface that crackles (see above — the
crackle is the point of it; the hiss underneath is nearly nothing, and it does
not go through the compressor, which is what used to turn it into static).

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

### The weather, as three dials rather than four words

`state.weather` is still the name a listener picks, but nothing draws or sounds
from the name any more. Everything reads `state.wx`:

```
wet    how much rain is falling, 0 to 1
haze   how much of the air you cannot see through
gust   how hard the wind is working
```

The four named weathers are corners of that space (`WEATHER` in `util.js`), and
`stepWeather` — called once a frame from `Scene.update`, the only clock in the
piece that runs at the rate a listener perceives — eases each dial toward
whichever corner has been asked for. Everything between them is a real state
the window can be in and does not have a name.

That is the whole difference between weather that can *change* and weather that
can only be switched. Rain used to arrive at full density in one frame while
the audio glided under it, because the scene read `state.weather === "rain"` as
a boolean in about forty places. Now a shower comes on as a few faint drops and
builds: `wet` buys the *number* of drops as well as how faint each one is, so
the beginning of a shower costs what it looks like it costs.

Each dial has its own time constant, coming and going separately, because
weather is not symmetrical:

| | arriving | leaving |
|---|---|---|
| **wet** | 14 s | 34 s |
| **haze** | 55 s | 75 s |
| **gust** | 11 s | 18 s |

A shower arrives much faster than it clears. Fog neither comes nor goes in a
hurry and is the slowest thing in the piece. Wind changes its mind quickest.
Measured across every pairing of the four weathers, the largest single-frame
step in any dial is **0.0033** — a hard cut is exactly what this replaced.

With **Let the sky come over** on, `stepWeather` also decides now and then that
the weather has become something else. It is not a shuffle: `WX_NEXT` weights
what plausibly follows what — a wet morning does not become a foggy one without
clearing first — and fog is additionally rationed to the ends of the day,
because fog at noon reads as a mistake. A weather holds for six to fourteen
minutes of window time, on the same `timeSpeed` the hours run on, so speeding
the day up brings the sky with it. A weather chosen by hand gets its full span
before anything moves.

One number is worth writing down. Clear and breeze sit at *exactly* zero haze
rather than nearly zero. A resting 0.05 is invisible — two hundredths of an
alpha — but the fog bands draw whenever there is any haze at all, so it cost
three full-width gradient fills a frame in every weather, and put four
milliseconds on every frame in the piece. A dial that means "none" has to be
able to say so.

### Something has come through

A fox on the path, a cat up on the wall, an otter surfacing among the ducks.
One bird sees it and says so — and then the whole place shuts up, which is the
part that carries. A wood going silent is far louder than anything in it, and
nothing else in the piece does it.

The scene knows only that it happened and where (`Scene.raiseAlarm`); the
engine decides what is said about it and how long the silence runs
(`AudioEngine.alarm`). Who says it is drawn from the birds actually present and
weighted by `alarm` in `species.js` — a blackbird or a magpie will scold
anything that moves, a chiffchaff will not. The call is the species' own voice;
there is no separate alarm synth. It is placed near, said two or three times
over, and it does not wait its turn.

Three things had to be measured rather than guessed:

- **The repeats must not overlap.** Fixed spacing put three of a blackbird's
  calls inside the length of one of them — three voices at arm's length. Each
  repeat is now booked from the length the last one actually turned out to be,
  which is also what a bird scolding something does: it says it, then says it
  again.
- **It should be a few decibels over an ordinary call, not ten.** Measured on
  quiet ground, twelve of each, medians: an ordinary blackbird peaks at
  −21.8 dB and the same bird alarmed at −17.6 dB, so **+4.3 dB** — startling,
  not a burst. It gets there by being *near* rather than by being boosted.
- **It must be rare.** A fox comes through every minute or two. Silencing the
  land for three quarters of a minute each time leaves a third of the session
  in the aftermath of something, which is not an event any more — it is the
  weather. So the hold is 10 s, the recovery 22 s, and only half of them are
  remarked on at all.

A ninety-second soak appears to show the alarm putting twelve decibels on the
master peak. It does not: the same soak *with no alarms at all* ranges from
−14.8 to −5.8 dBFS between runs, and that spread is thunder, which is random
and bypasses the duck by design. Nothing ever clips.

The land does not switch back on. `AudioEngine.settle()` returns 0 through the
hold and then `u²` over the recovery — slowest at first, which is how it goes:

```
17 s → 0.10      25 s → 0.46      35 s → 1.00
```

Visually, `Scene.flush(x)` sends the birds up. Ones nearest it go first and go
furthest, and they go *away* from it; a bird on the other side of the frame
looks up and stays. Rabbits, hares, squirrels, deer and hedgehogs bolt, laid
over whatever gait they were already running rather than replacing it.

### The hour, in the sound

`state.time` used to reach the engine in three places, all of them scheduling —
which birds are awake and how often they try. The *sound* of three in the
morning was identical to noon.

`nightness()` is borrowed from the scene rather than worked out again from
`state.time`, so it is the same crossfade the light uses and the room turns
over at exactly the rate the sky does. Settled readings, in the city:

```
        wind    traffic   voice LP    chorus
dawn   0.0244   0.0289   10339 Hz     ×2.46
day    0.0236   0.0300   10425 Hz     ×1.15
dusk   0.0204   0.0244    9747 Hz     ×1.84
night  0.0153   0.0139    8387 Hz     ×0.81
```

The wind drops after dark. A city empties out overnight — it never goes silent,
a town at four in the morning still hums, but the difference between that and
the middle of the afternoon is most of what tells you which one you are in.
Night air is dense, so a call across it arrives duller as well as further off.

And the dawn chorus, which is the whole point of the hour. Which birds are
awake is already the species' own `weights`; what that could never say is that
at first light *everything sings at once*, far more than the sum of who happens
to be up. Counting voices actually sounding, over 75 s at full density, with
the curve's own four-to-seven-minute tide shortened so every hour is measured
against the same average:

```
dawn    0.93 voices    73% of the time something is calling
dusk    0.94 voices    71%
day     0.54 voices    50%
night   0.38 voices    38%
```

Night is thinner by time than by voice count, because the things that own the
small hours — an owl, a cricket — say long things rather than many.

### The meadow, and the ground it stands on

The meadow was three stacked bands: a ridge at 0.62, a second at 0.78 and a lip
of foreground at 0.92. Each was a filled outline with a hard edge, none of them
agreed about where the ground was, and every animal lived in the **5.8 per cent
of frame height** between the last two. A rabbit at the back of the field stood
thirty pixels above one at the front and there was nothing else to say it was
further off. Theatre flats, not a field.

It is one plane now, and one relation does all of it. For a camera at a fixed
height above flat ground, an object's distance *below the horizon on screen*
and its *apparent size* are the same number — both go as 1/d:

```
y(z)     = horizon + near/(1 + z(d−1))
scale(z) = 1/(1 + z(d−1))
```

`z` is 0 at the near edge and 1 at the far edge of the field; `d` is how many
times further away the far edge is. In the meadow that gives a ground band of
**0.65 to 1.035** — roughly 38% of the frame, against 5.8% before — and a size
range of about **four to one**.

Everything that stands on the ground reads the same pair, so nothing can
disagree with anything else: grass, flowers, stones, hedges, cattle, the field
tree, every animal, the puddles, and where the rain lands. Three things fell
out of it that had been wrong on their own:

- **Speed is not a separate choice.** An animal covering a metre of ground at
  twice the distance crosses half as many pixels, so the screen speed *is* the
  scale. Setting the two independently is what made a far rabbit hop the same
  distance as a near one.
- **So is leap height.** The rabbit, the hare and the squirrel all lifted by a
  fixed fraction of the *frame* — `y: D.y*H − hop*H*0.035` — so a rabbit at the
  back of the field jumped as many pixels into the air as one at your feet.
- **Depth is where the birds sing from.** A ground perch's `depth`, which is
  what the audio pans and filters by, is now read off the same z, so a bird
  that looks far away sounds far away.

The hills are gone. What replaced them is a single low ridge on the horizon —
scenery, nothing walks on it — and **field boundaries**: three hedgerows
crossing the plane at known depths, each drawn at the height, twig thickness,
wind response and haze that its depth allows. A real field is not an empty
plane, it is a plane with lines across it, and those lines are what tell you
how big it is.

Two bugs found by drawing it:

- `Math.pow(rng(), 0.55)` pushed the grass *away* from the viewer, not toward
  it. An exponent below one biases toward 1, which is the far edge — so the
  near third of the field was bare while the far edge was a thicket. It wants
  to be above one.
- A blade that leans by a fixed few pixels stands near-vertical when it is
  40 px tall. Two hundred of those is a bed of nails. Grass leans by a fraction
  of its own length.

And one performance lesson worth keeping. The plane is painted as a gradient
across half the frame, and at 1920×1080 that is a million pixels of gradient
evaluation every frame — **6.5 ms**, where the flat `Path2D` fills it replaced
were nearly free. It is rendered once to an offscreen canvas and blitted, keyed
on a coarse step of the light, and the field's tonal patchwork is painted into
the same image because it never moves either. That took the meadow from 17.4 ms
back to 12.3 against a 10.6 ms baseline — about two milliseconds for a field
with 360 blades of perspective grass, three hedgerows and twice the flowers,
where before there were 110 blades and one hedge.

Worth recording how that was found: a JS profile of the whole draw came to
**1.36 ms**. All of the cost was rasterization, which no amount of function
timing will show — the bench forces it to land with a `getImageData`, and only
the A/B of one drawing call against another finds it.

### The same ground under every place

The meadow's plane was the first; all five have one now, built from the three
numbers a place already knows about itself — where its horizon is, where the
ground meets the bottom of the frame, and how far back a creature can stand.
`makePlane` works out the depth factor from those, so nothing has to guess:

```
            horizon   band            size range
meadow       0.52     1.035 … 0.645     4.0 ×
forest       0.60     1.045 … 0.864     1.7 ×
beach        0.53     1.030 … 0.821     1.7 ×
wetland      0.57     1.030 … 0.675     4.4 ×
city         0.48     1.070 … 0.864     1.7 ×
```

The bands they replaced were 4.7%, 9.5%, 4.3% and 2.6% of frame height. The
shallow ones are honest: a strand seen from a dune really is foreshortened, and
the ledge at the corner of a rooftop is a wedge, not a field. What matters is
that a cat crossing the near edge is now bigger than one at the far, and
crosses faster.

Each place also had one thing standing on it that ignored depth entirely, and
each is the same fix:

- **The wood's trunks** all met the floor on one line at 0.93. A wood is the
  one place where the recession of the ground is completely hidden by what
  stands on it — unless what stands on it recedes too. The three ranks now
  carry depths and meet the floor where their own depth puts it.
- **The reed bed** was forty-two identical stems on one line: a picket fence
  standing in water. Seventy-eight at every distance is a bed.
- **The beach** had pebbles all one size from the tide line to your feet, and
  groyne posts all one height. A shingle at your feet is the size of a fist
  and one at the water's edge is a speck.
- **The wood's undergrowth** — grass, ferns, mushrooms — was a fringe pinned
  along the bottom of the picture at 0.93 and 0.945.

`drawDepthTufts` is the meadow's grass routine generalised: three passes far to
near, one path each, the far pass paler and finer, every blade leaning by a
fraction of its own length. The meadow, the wood and the dune all use it.

And the cattle graze. They were the slow background motion this view is built
around and they had been pushed too far back to read — three pale specks
behind the haze. They are nearer now, the haze goes down before them rather
than over them, and they work their way across the field head-down at a
hand's breadth a minute, turning at the boundary rather than walking out of
the field. It is the slowest motion in the piece and the only one you notice
by having looked away and looked back.

### Where the near edge of a plane actually is

Every plane's near edge is deliberately *below* the bottom of the frame: that
is what puts the grass at your feet off the glass, where it belongs. How much
of the plane that costs varies enormously, and nothing was checking.

`nearZ()` is the nearest depth at which an animal is still in the picture —
`planeZ(0.988)`, the depth whose ground line sits just inside the bottom edge.
Spawning, `crossing()` and the depth-travel clamp all use it, so no place can
put a creature under the sill.

The city was where this showed. It had a horizon at 0.885, a pavement one
twentieth of the frame deep, and a plane fitted into that: sixteen pixels of
usable ground for everything that walks, with everything nearer than z ≈ 0.41
drawn below the window. A quarter of the street's animals had never been
visible. The ground is deeper now — one constant where there had been six
copies of `0.95` — and the plane comes with it. It has since become the near
edge of a rooftop, and then the *nearest point* of one: see "The city, from a
roof beside a street" above for why that edge is a V and not a line.

The road went dark at the same time and for the same reason. It had been mixed
a tenth of the way toward the sky, which is exactly where the animal-colour
ramp ends: a pigeon standing on the road came out the colour of the road. It
was there and it could not be seen. The road is now a twenty-fifth of the way
up, with a paler pavement across the back of it, and the city's animals get
their own ramp well clear of both. The city is the only place where this is
needed — everywhere else has a pale far hill behind the animals, and contrast
runs both ways.

### The light

The sun's position was worked out from the first — `drawCelestial` sets `celX`
so the water can catch a glitter off it — and then nothing else in the frame
used it. Every shadow in the piece was a small dark pool directly under its
animal, which is what a shadow looks like at noon and at no other hour.

`updateLight()` refreshes three numbers once a frame, and everything that casts
reads them:

```
x     where the light is, 0..1 across the frame
alt   how high it is: 1 overhead, 0 on the horizon
str   how hard it is — cloud, rain and fog all soften a shadow until
      there is not one, which is most of what an overcast day looks like
```

A shadow falls away from the light, stretches as `alt` drops (up to about
three and a half times its width at the horizon), and goes softer as it
stretches, because a long shadow has a large penumbra. Anchored at the feet:
the near end stays put and the far end travels.

Two things had to change for it to be visible at all. **Birds had no shadow.**
`contactShadow` was called ten times from `drawCritters` and not once from
`drawActors` — every bird in the piece floated a pixel above the ground. Only
the ones actually on the ground get one now; a bird on a twig six feet up casts
its shadow somewhere else entirely. And it shrinks and fades as the bird hops
or springs, which is most of what says the feet were really touching.

**And it is multiplied, not painted.** A shadow drawn as flat ink the colour of
the darkest token is invisible on ground that is already nearly that colour —
which the meadow at dawn is. They were being drawn and could not be seen.
Multiply darkens whatever it lands on by a proportion, which is what a shadow
does, and it reads on pale sand and dark turf alike.

Lightning uses the same machinery. A stroke happens *somewhere*, and for the
tenth of a second it lasts it is the only light there is: `updateLight` swings
to the stroke's position, low and hard, and the wash over the land goes on as
`screen` from the same point. The effect is the contradiction — the flash does
not brighten a lit scene, it lights an unlit one. A landscape under a storm has
no shadows at all until the sky opens, and then it has very sharp ones.

### What the wind gets hold of

`windBend` was read eighteen times in `scene.js` — grass, hedgerow, reeds,
trees, clouds, smoke, rain — and by nothing that was alive. A gust would cross
the frame, the grass would lie over, and the bird standing in it would not
move.

- **Perched birds** sit on the end of a lever that is being pushed about, so
  the bird goes where the twig goes and the twig goes with it. Birds on the
  ground are barely touched (a tenth of the exposure).
- **They fluff.** A gust ruffles a bird's plumage — the same reflex as
  fluffing in the cold, and the thing you actually see from a window.
- **The light fliers are carried.** A butterfly does not fly through a gust,
  it is taken by it; a bee less so; a dragonfly is a far better flier and
  hardly notices. Those three numbers are 0.115, 0.055 and 0.028.
- **Falling leaves** ride the same field the branches they fell from are
  riding, and spin faster the harder they are carried.

### Wet ground

The engine has tracked this since the drips were added — `wetUntil` keeps the
land dripping for the best part of a minute after the rain stops — and nothing
showed it anywhere but the beach.

`groundWet` follows `wx.wet` with a soak of twenty seconds and a dry of ninety,
because ground takes a while to soak and a long while to give it up, and the
dark patch a shower leaves behind is one of very few things in a landscape that
tells you what the weather was doing a minute ago.

Wet ground does two things at once and both are drawn: it goes darker (a
multiply, strongest at the near edge) and it starts reflecting the sky (a
screen of the sky's own colour). Above about a third wetness, standing water
appears — puddles drawn from the session seed so a place keeps them in the same
hollows all session, and skipped entirely where there is already water in the
frame.

They took three attempts to stop looking wrong. A bright sheet with a rim
highlight reads as a saucer set down on the grass; standing water in a field is
mostly just a place where the ground has stopped being matt. What works is a
soaked ring underneath and a very low-contrast sheet of sky over it, and
nothing else.

### What stands in water

`drawReflections` mirrors the far tree line and nothing else, so a heron in a
marsh had none.

This is deliberately **not** a mirrored re-paint. Running every painter a
second time under a flipped transform is the faithful way and it doubles the
cost of every animal near water — for a shape that is, at the size these
appear, a dark smear broken by ripples. So it is drawn as what it looks like
rather than as what it is: a soft column of the animal's own colour under its
feet, cut across by two strips of the surface, because a reflection is always
broken and always broken horizontally. Three ops instead of twenty-five.

How much there is to reflect is how much of the animal is above the water: an
egret on its legs throws a long one, a duck — sitting *in* the water rather
than above it — throws almost none.

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
  Web Audio API — nothing is sampled. A session's seed drives the landscape and
  its cast. The city is the one exception and deliberately so: its composition is
  written down (see above) and the seed dresses it rather than building it,
  because a view worth looking out of is composed and not rolled.
- **Faithful.** Each place keeps its own company; a species only sings where it
  would actually live (see `habitats` / `hw` in `species.js`). The same applies to
  behaviour: the fox's mousing pounce, the heron's strike, the squirrel caching a
  nut and the cuckoo's drooped-wing calling posture are all drawn from life.
- **Ephemeral.** There is no pause and no going back. A shut window keeps no
  time, holds no animals and makes no sound; opening it begins somewhere new.
  How you like it set is remembered; what you were looking at is not.
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
