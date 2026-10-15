# Project Design Document: Living Window

## 1. Executive Summary & Vision
**Living Window** is a self-hosted, browser-based ambient simulation that transforms any desktop, ultrawide monitor, or mobile screen into a living, breathing, pixelated window looking out into four distinct worlds. Unlike static looping GIFs or predictable screensavers, this project emphasizes **emergent, non-repeating realism**—both visually and acoustically. Through a 2.5D depth-sorted rendering engine, perspective-scaled wildlife state machines, dynamic weather, interactive windowsill mechanics, and reactive spatial soundscapes, staring out this digital window feels as organic and unpredictable as looking out a real one.

---

## 2. Core Pillars & User Experience

### A. The Interactive Window Frame & 2.5D Perspective
*   **Minimalist Physical Frame:** A pixel-art window frame and bottom sill border the edges of the viewport, occupying minimal screen real estate so the landscape remains the star while grounding the viewer inside a cozy room.
*   **Perspective Scaling ($z$-Depth):** Creatures scale dynamically based on their distance from the window. Distant birds in the sky or street appear only a few pixels tall, whereas birds or cats visiting the immediate foreground windowsill are rendered at full, intricate pixel detail.
*   **Open vs. Closed Window State:**
    *   **Window Open (Default):** The glass sash is raised out of the way. Exterior sounds are crisp and unobstructed, and birds can hop directly onto the interior/exterior sill ledge.
    *   **Window Closed:** A subtle animation slides the glass pane shut. Exterior ambient audio passes through a real-time acoustic low-pass filter (muffling outside noise), while rain droplets and snow physically hit and streak down the glass pane.
*   **Birdseed Ledge Mechanic:** Users can click to place birdseed in a small bowl on the bottom windowsill. While seed is present, the probability of nearby birds flying up to the foreground sill to perch, peck, and eat increases significantly until the bowl is depleted.

### B. UI, Audio Mixer & Lofi Radio
*   **Auto-Hiding Pixel UI:** Moving the mouse (or tapping on mobile) reveals a sleek, minimalist pixel-art overlay menu that automatically fades out after a few seconds of inactivity.
*   **Multi-Channel Audio Sliders:** Users have granular volume sliders for independent audio buses:
    1.  *Master Volume*
    2.  *Wildlife & Birds* (chirps, wings flapping, footsteps)
    3.  *Weather* (rain, thunder, wind gusts)
    4.  *Landscape Ambience* (ocean waves, city hum, stream water, rustling leaves)
    5.  *Lofi Radio*
*   **Diegetic Lofi Radio Toggle:** Users can toggle a built-in lofi music stream on or off. The audio is processed with a warm indoor acoustic profile so it sounds like it is playing from a small radio sitting inside the room right beside the window (remaining unmuffled even when the window is closed).

### C. Chronos (Time) & Weather Engine
*   **4-Hour Simulated Day Cycle ($6\times$ Speed):** By default, $1\text{ full simulated day (24 hours)} = 4\text{ real-world hours}$ ($10\text{ real-world minutes} = 1\text{ simulated hour}$).
*   **Manual Time Scrubbing & Freeze:** Users can pause time progression at their favorite lighting state or manually scrub/set the clock to any hour (Dawn, Morning, Midday, Golden Hour, Dusk, Night, or $2\text{:}00\text{ AM} - 4\text{:}00\text{ AM}$ Late Night) and let the clock continue playing from that point.
*   **Algorithmic Weather with Manual Override:** An internal weather state machine (driven by Markov chains and Simplex noise) organically transitions between Clear Skies, Overcast, Light Rain, Heavy Thunderstorm, and Snow. Users can also manually lock or switch the weather at any time via the UI overlay.

### D. Anti-Pattern Realism (Living Simulation)
*   **No Detectable Loops:** Entities are driven by **Finite State Machines (FSMs)** and probabilistic timers rather than fixed keyframe loops.
*   **Ecological Interactivity:** Entities react to one another and the environment—fish scatter when a seagull dives; pedestrians open umbrellas or clear the streets when it rains; birds scatter if the rooftop cat approaches; nocturnal animals replace diurnal ones at dusk.

---

## 3. Landscape Specifications

### Scene 1: Downtown City Rooftop
*   **Perspective:** Elevated rooftop vantage point looking through the foreground window sill across neighboring skyscrapers and down into a lively city street.
*   **Time-of-Day Dynamics:**
    *   *Morning Rush:* Commuters gradually fill the sidewalks; daytime street vendors set up stalls.
    *   *Daytime:* Steady foot traffic, active stalls, ambient city hum.
    *   *Evening/Night:* Streetlights flicker on; building windows light up randomly (occasionally showing subtle pixel silhouettes walking past or watching TV); night-market shops open; vibrant evening crowd.
    *   *Late Night ($2\text{:}00\text{ AM} - 4\text{:}00\text{ AM}$):* Streets empty out almost completely; most building lights turn off; peaceful late-night urban quiet.
*   **Wildlife & Entities:**
    *   *Birds:* Pigeons, sparrows, and crows flying in with realistic trajectories—appearing tiny when perching on distant streetlamps or rooftops, and large/detailed when landing on the foreground window ledge to eat birdseed.
    *   *The Rooftop Cat:* A rare, autonomous feline visitor that strolls across foreground ledges, stretches, naps, or stalks birds (causing them to scatter).

### Scene 2: The Meadows
*   **Perspective:** Lush, rolling green pastures framed by trees, an open sky, and a clear foreground/midground stream.
*   **Environment:** Swaying tall grass, wildflowers, trees, and a flowing stream with an underwater view.
*   **Wildlife & Entities:**
    *   *Land Mammals & Fowl:* Cows slowly grazing and shifting positions in the mid/background fields during the day; chickens pecking; wild rabbits darting between bushes; squirrels climbing trees.
    *   *Avian Life:* High diversity of meadow songbirds (finches, bluebirds, robins) visiting the windowsill and trees; an occasional eagle soaring high in the background thermal currents.
    *   *Aquatic Life:* Schools of fish appearing in the stream, swimming against the current or darting away.
    *   *Night Shift:* Grazing cattle rest or leave; owls, fireflies, and crickets take over the night soundscape.

### Scene 3: The Beach
*   **Perspective:** Coastal shoreline looking out over rolling waves toward the horizon, with a weathered wooden beach-house window frame in the foreground.
*   **Environment:** Wet/dry sand transitions as waves crash and recede, tide pools, coastal sky.
*   **Wildlife & Entities:**
    *   *Marine Life:* Schools of fish visible in the shallows; sea turtles slowly crawling onto the shore and retreating back into the surf; distant dolphins breaching near the horizon.
    *   *Avian & Predator/Prey Loop:* Seagulls and shorebirds walking along the wet sand, hopping, calling, diving into the water to hunt (scaring nearby schools of fish), or landing on the wooden windowsill.
*   **Audio Focus:** Multi-layered wave crashes (distant swells vs. shore break), authentic gull cries, gentle coastal breeze.

### Scene 4: The Deep Forest
*   **Perspective:** Dense woodland cabin window looking through multiple layers of massive tree trunks and canopy.
*   **Environment:** Towering trees that gently sway in the wind, falling leaves, dappled sunlight (god rays) filtering through the canopy.
*   **Wildlife & Entities:**
    *   *Forest Fauna:* Deer quietly walking between the $z$-indexed tree layers (passing behind one trunk and in front of another); squirrels darting up bark and onto the cabin windowsill; diverse woodland birds (woodpeckers, jays, chickadees).
*   **Audio Focus:** Rich, organic foley—wood creaking in the wind, leaves rustling dynamically based on wind speed, varied bird calls echoing through the timber.

---

## 4. Technical Architecture & Recommendations

### 1. Rendering & Responsive Multi-Aspect Ratio Strategy
Because the application must adapt seamlessly across **standard 16:9 monitors, 21:9/32:9 Ultrawides, and 9:16 Vertical Mobile browsers** without stretching pixels, we should separate the canvas into two coordinate systems using **PixiJS**:
*   **World Canvas (Panoramic 21:9 Base, e.g., $840 \times 360$ native pixels):**
    *   All landscapes are drawn on a wide panoramic canvas scaled using crisp nearest-neighbor interpolation (`scaleMode: NEAREST`).
    *   On **Ultrawide** displays, the entire panoramic width is visible.
    *   On **16:9** displays, the center $640 \times 360$ is shown.
    *   On **Vertical/Mobile** displays, the viewport zooms to fit the height ($360\text{ px}$ scaled up) and allows the user to **touch-drag/pan horizontally** left and right to look across the window view (like turning your head while looking out a window).
*   **Screen-Space Window Frame (9-Slice / Procedural Edge Pinning):**
    *   The foreground window frame and bottom sill are pinned dynamically to the actual browser viewport edges using a **Nine-Slice Plane (`PIXI.NineSlicePlane`)**. This guarantees the window frame always borders the user's screen regardless of whether they are on an iPhone in portrait mode or a curved ultrawide monitor.
    *   The birdseed bowl and primary perching spots sit anchored along the bottom sill within the visible viewport bounds.

### 2. 2.5D Perspective & Scale Math
To achieve realistic depth where distant birds look tiny and windowsill birds look detailed:
*   Assign every depth layer a normalized depth coordinate $z \in [0.0, 1.0]$, where $z = 0.0$ is the foreground windowsill and $z = 1.0$ is the distant horizon.
*   Calculate an entity's render scale $S(z)$ and movement speed multiplier using a perspective curve:
    $$S(z) = S_{\text{min}} + (1 - S_{\text{min}}) \cdot (1 - z)^2$$
*   *Practical Tip for Pixel Art:* Scaling a single high-res pixel sprite down to $15\%$ can cause ugly shimmering ("pixel crawl"). Instead, create **2 to 3 discrete LOD (Level of Detail) sprite sheets** per bird species:
    1.  **Foreground Sill ($z = 0.0$):** $48 \times 48\text{ px}$ highly detailed sprite for up-close perching/eating seed.
    2.  **Midground Trees/Ledges ($z \approx 0.4$):** $16 \times 16\text{ px}$ medium sprite.
    3.  **Background Sky/Street ($z \ge 0.7$):** $6 \times 6\text{ px}$ minimalist silhouette sprite for distant flight and street hopping.

### 3. Acoustic Routing & The "Closed Window" Filter
Using the native **Web Audio API** (wrapped with **Howler.js**), structure the audio graph into two distinct acoustic zones:
```
[Exterior Audio Buses]                    [Interior Audio Buses]
 ├── Wildlife & Birds (Stereo Panned)      ├── Lofi Radio Stream (Warm EQ)
 ├── Landscape Ambience                    ├── Window Raindrops (Glass Tap Foley)
 └── Exterior Weather (Wind/Thunder)       └── UI / Birdseed Bowl Sounds
          │                                         │
          ▼                                         │
  [Window State Filter]                             │
  (Open: Bypass / 20,000 Hz)                        │
  (Closed: Low-Pass @ 450 Hz + -8dB Gain)           │
          │                                         │
          └──────────────────┬──────────────────────┘
                             ▼
                    [Master Volume Out]
```
*   **Why this works:** When the user clicks "Close Window," sliding the `BiquadFilterNode` cutoff frequency smoothly from $20000\text{ Hz}$ down to $450\text{ Hz}$ over $0.6\text{ seconds}$ instantly muffles the outside world while keeping the indoor Lofi Radio and the sound of raindrops tapping on the glass crystal clear.
*   **Anti-Repetition Audio Trick:** Whenever a bird chirps, apply a slight random pitch shift ($\pm 8\%$) and random gain variation ($\pm 15\%$), and pan the `StereoPannerNode` to match the bird's horizontal screen coordinate $x \in [-1.0, 1.0]$.

### 4. Art & Authentic Audio Sourcing Pipeline
*   **AI + Hand-Polished Pixel Art Workflow:**
    1.  **Static Background Layers:** Generate separate layer concepts (skybox, distant buildings/mountains, midground trees, foreground sill) on solid/isolated backgrounds, then use **Aseprite** (or an AI pixel-snap post-processor like `PixelIt` / ComfyUI PixelArt nodes) to lock them to a strict color palette and true $1:1$ pixel grid.
    2.  **Realistic Bird & Animal Animations:** Because AI often struggles with consistent frame-by-frame pixel sprite sheets, the fastest path to *hyper-realistic* animal motion is **rotoscoping or reference tracing** in Aseprite: take a short 2-second real video of a bird hopping, pecking, and taking off, scale the video down to $48 \times 48\text{ px}$ at $12\text{ FPS}$, and trace/paint over the silhouettes. This captures authentic avian weight and head-bobbing effortlessly.
*   **Authentic Wildlife Audio Sources:**
    *   **Xeno-canto (`xeno-canto.org`):** The world's largest open-access database of real wild bird recordings categorized by species, call type (song vs. call vs. alarm), and region.
    *   **Freesound (`freesound.org`) & Sonniss GDC Bundles:** Ideal for clean, uncompressed ambient stems (wind through pines, distant urban traffic, gentle waves, rain on glass).

### 5. Self-Hosting & Network Architecture
*   **Lightweight Static + Docker Deployment:** Because the simulation clock, weather engine, and AI run $100\%$ client-side in JavaScript/TypeScript, the server only needs to serve static assets (HTML, JS bundle, `.webp`/`.png` sprite sheets, `.ogg`/`.mp3` audio files).
*   **Containerization:** Package the built app inside an **Nginx Alpine Docker container** (`nginx:alpine`), which consumes less than $15\text{ MB}$ of RAM.
*   **LAN & Online Access:**
    *   *Local Network:* Run on any home server, NAS, or Raspberry Pi and access via `http://<local-ip>:8080` on any PC, tablet, or phone on your Wi-Fi.
    *   *Online Access:* Optionally expose it securely to the web with zero port-forwarding using a **Cloudflare Tunnel (`cloudflared`)** or deploy the static build directly to **Cloudflare Pages / GitHub Pages / Vercel** for free global access.

---

## 5. Step-by-Step Implementation Roadmap

To keep this project fun, manageable, and momentum-driven without getting overwhelmed by creating 4 massive worlds at once, follow this phased execution plan:

### Step 1: Project Scaffolding & Responsive Window Frame (Days 1–3)
1.  Initialize a **Vite + TypeScript + PixiJS v8** project.
2.  Build the responsive viewport manager (handling 16:9, Ultrawide, and Mobile touch-panning).
3.  Render the foreground **Window Sill & Frame** with the **Open/Close Window toggle** and the **Birdseed Bowl** placement mechanic.

### Step 2: The Chronos Clock & Weather Shader Engine (Days 4–7)
1.  Build the **$4\text{-Hour}$ Simulated Clock** ($1\text{ real sec} = 6\text{ sim secs}$) with a UI scrubber to drag time across Dawn, Day, Dusk, Night, and Late Night.
2.  Create the dynamic color-grading/lighting system (tinting sky and midground layers based on time of day, plus a mask layer for lit building windows/fireflies at night).
3.  Build the **Weather Particle & State Machine**: rain streaks, snow flakes, lightning flash overlay, and **rain-on-glass droplets** when the window is closed.

### Step 3: The Audio Engine & Lofi Radio (Days 8–10)
1.  Set up the Web Audio API mixer with the 5 independent volume sliders.
2.  Implement the **Window Closed Low-Pass Filter** ($450\text{ Hz}$ muffle effect) and stereo spatial panning function `playSpatialSound(id, screenX, depthZ)`.
3.  Add the **Lofi Radio** player (supporting local `.mp3`/`.ogg` tracks or an icecast stream URL) with a subtle warm radio EQ filter.

### Step 4: The "Vertical Slice" — Scene 1: Downtown City Rooftop (Weeks 2–3)
*Focus on completing ONE scene to $100\%$ polish so all core AI systems are proven.*
1.  Create and layer the City Rooftop background, midground buildings (with toggleable window lights), and street level.
2.  Build the **Bird Finite State Machine (FSM)**:
    *   States: `FLY_IN` $\rightarrow$ `PERCH_IDLE` $\rightarrow$ `LOOK_AROUND` $\rightarrow$ `HOP` $\rightarrow$ `PECK_SEED` $\rightarrow$ `CHIRP` $\rightarrow$ `TAKE_OFF`.
    *   Connect the Birdseed bowl modifier so birds prioritize the foreground sill when food is out.
3.  Add the **Pedestrian & Vendor Schedule** (crowded at $6\text{:}00\text{ PM}$, empty at $2\text{:}30\text{ AM}$, scattering when rain starts) and the rare **Rooftop Cat** visitor.

### Step 5: Expanding to Scenes 2, 3, and 4 (Weeks 4–6)
Once Scene 1 works seamlessly, reuse the core engine to add the nature scenes:
1.  **The Forest:** Add vertex-swaying shaders for massive trees, z-sorted walking paths for Deer, climbing Squirrels, and woodland bird audio.
2.  **The Beach:** Add the shoreline wave cycle (wet/dry sand fade), Boids schooling algorithm for shallow-water Fish, diving Seagulls, Turtles, and horizon Dolphins.
3.  **The Meadows:** Add grazing Cattle state machines, stream cross-section for fish, soaring background Eagles, and nighttime Fireflies/Owls.

### Step 6: Docker Packaging & Mobile Polish (Week 7)
1.  Test mobile Safari/Chrome touch controls and audio unlock policies (browsers require a single tap to start Web Audio).
2.  Write a `Dockerfile` and `docker-compose.yml` for one-command local network hosting.