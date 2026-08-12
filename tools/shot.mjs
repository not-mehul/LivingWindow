/* Pictures of the window, taken from outside it.

   Every other harness here measures a number. This one is for the times the
   question is not a number at all — whether a place *looks* like anywhere,
   whether a change to the drawing helped or quietly made it worse. There was
   no way to answer that without opening a browser and looking, which meant
   art-direction work could not be checked the way everything else here is.

   It pins the hour and the weather through the hook for the same reason
   `bench.mjs` does: a turning sky means no two shots of the same build are of
   the same thing, and a comparison between builds is then worthless.

     node tools/shot.mjs                      # every place, every hour
     node tools/shot.mjs city                 # one place, every hour
     node tools/shot.mjs city dusk            # one place, one hour
     node tools/shot.mjs city dusk rain       # …and one sky

   Files land in `shots/` as `<place>-<hour>-<weather>.png`. Set `SHOT_DIR` to
   put them somewhere else — which is what a before/after wants:

     SHOT_DIR=shots/before node tools/shot.mjs city
     …change something…
     SHOT_DIR=shots/after  node tools/shot.mjs city
*/
import { chromium } from 'playwright';
import { chromiumPath } from './lib/browser.mjs';
import { mkdir } from 'fs/promises';

const URL_BASE = process.env.SHOT_URL || 'http://127.0.0.1:8123/';
const OUT = process.env.SHOT_DIR || 'shots';
const W = +(process.env.SHOT_W || 1600);
const H = +(process.env.SHOT_H || 900);
/* The seed matters here in a way it does not anywhere else: two shots of the
   same place under different builds have to be of the same land, or the
   difference between them is the seed and not the change. */
const SEED = process.env.SHOT_SEED || '20240101';
const SETTLE_MS = +(process.env.SHOT_SETTLE || 2600);

const PLACES = ['meadow', 'forest', 'beach', 'wetland', 'city'];
const HOURS = ['dawn', 'day', 'dusk', 'night'];

const places = process.argv[2] ? [process.argv[2]] : PLACES;
const hours = process.argv[3] ? [process.argv[3]] : HOURS;
const weather = process.argv[4] || 'clear';

await mkdir(OUT, { recursive: true });

const browser = await chromium.launch({
  ...chromiumPath(),
  args: ['--autoplay-policy=no-user-gesture-required', '--enable-gpu', '--use-gl=swiftshader']
});
const page = await browser.newPage({ viewport: { width: W, height: H } });
/* A throw inside the render loop stops the loop, and the canvas then keeps
   whatever was last on it — so the harness cheerfully writes out a PNG of an
   empty sky and says nothing. That is the worst possible failure for a tool
   whose whole job is to be looked at, and it cost a full cycle of wondering
   why the city had vanished. Now it says so, and exits non-zero. */
let broke = null;
page.on('pageerror', (e) => { if (!broke) broke = e; });
await page.goto(`${URL_BASE}${URL_BASE.includes('?') ? '&' : '?'}hook=1`,
  { waitUntil: 'networkidle' });

/* Stand in for fullscreen, exactly as bench.mjs does — the canvas is a band
   inside an 880px column until the frame goes :fullscreen, and a shot of that
   is a shot of the chrome. */
await page.addStyleTag({ content: `
  header, footer, .window-tools, .caption, .glow-layer { display: none !important; }
  .container { max-width: none !important; padding: 0 !important; }
  .window-frame { padding: 0 !important; border: none !important; border-radius: 0 !important; }
  .window-inner { border-radius: 0 !important; }
  #scene { height: 100vh !important; }
` });

await page.click('#beginBtn');
await page.waitForTimeout(1000);

for (const place of places) {
  for (const hour of hours) {
    await page.evaluate(([place, hour, weather, seed]) => {
      const { state, scene } = window.__lw;
      state.timeFlow = false;
      state.weatherFlow = false;
      state.time = hour;
      state.weather = weather;
      state.location = place;
      state.seed = seed >>> 0;
      /* Set the blend outright rather than waiting for it to cross. The hour
         is a mix of four phases that eases from one to the next over seconds,
         and a shot taken mid-crossing is of an hour that has no name. */
      scene.timeMix = { dawn: 0, day: 0, dusk: 0, night: 0 };
      scene.timeMix[hour] = 1;
      scene.clearLife();
      scene.reseed(state.seed);
    }, [place, hour, weather, +SEED]);
    await page.waitForTimeout(SETTLE_MS);
    const file = `${OUT}/${place}-${hour}-${weather}.png`;
    /* The stack and not the page: the sky is one canvas and the land is
       another laid over it, and only their common parent is the picture. */
    const el = await page.$('.scene-stack');
    /* SHOT_CLIP=x,y,w,h — as fractions of the frame — for when the question is
       about one corner of a place and a whole 1600-pixel view of it answers
       the question at a twentieth of the size. */
    let opts = { path: file };
    if (process.env.SHOT_CLIP) {
      const box = await el.boundingBox();
      const [cx, cyy, cw, ch] = process.env.SHOT_CLIP.split(',').map(Number);
      opts.clip = { x: box.x + cx*box.width, y: box.y + cyy*box.height,
        width: cw*box.width, height: ch*box.height };
      await page.screenshot(opts);
    } else {
      await el.screenshot(opts);
    }
    console.error(`  ${file}`);
  }
}

await browser.close();
if (broke) {
  console.error(`\n  ! the page threw — the shots above are of a stopped frame:\n    ${broke.message}`);
  process.exit(1);
}
