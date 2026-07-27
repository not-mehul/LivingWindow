/* Drives the rig editor the way a hand would: open the bench on a creature,
   add a shape, drag it, drag one of its points, name a pose, move the shape
   again so the pose differs from rest, then play it back.

   The editor is the one part of this project with no other check on it. The
   painters are covered by the trajectory recordings and the creature sweep, but
   a bench you draw on is all pointer events and panel rebuilding, and every bug
   in it is the kind that only appears when something is actually dragged. So it
   is dragged here.

   Each step asserts on the rig itself — the data the editor is for — rather
   than on pixels, because "the shape moved" is a fact about the rig and
   "something changed on screen" is not. */
import { chromium } from 'playwright';

const URL = process.env.BENCH_URL || 'http://127.0.0.1:8123/bestiary.html';

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium', args: ['--use-gl=swiftshader']
});
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const pageErrors = [];
page.on('pageerror', e => pageErrors.push(e.message));
/* Every confirm the bench raises guards work about to be thrown away, and this
   run means all of them. One handler for the whole session: a second listener
   on the same dialog throws, and a dismissed one leaves the old state in place
   — which reads exactly like a change that worked, if all you check is that
   something is still there. */
page.on('dialog', dlg => dlg.accept());
await page.goto(URL, { waitUntil: 'networkidle' });
await page.evaluate(() => localStorage.removeItem('lw.bestiary.rigs'));
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(500);

const checks = [];
const ok = (name, pass, note = '') => checks.push({ name, pass, note });
const rig = () => page.evaluate(async () =>
  JSON.parse(JSON.stringify((await import('/js/rigs.js?v=7')).RIGS.deer || null)));

/* ---- open the bench ---- */
await page.click('#bz-rig-open');

/* Every creature the picker offers must show its painter in ghost, because the
   ghost is the whole method: you redraw a bad animal over itself. A painter
   that throws on the bench's parameters, or that ignores the scale it is given
   and draws a twelve-pixel cat, leaves nothing to trace — and the guard around
   the ghost call means it does so in silence. So it is measured: ghost off is
   the bench's grid and nothing else, and whatever ghost on adds is the painter.
   Counting against the background colour instead would mostly count grid. */
const offered = await page.evaluate(() =>
  [...document.querySelectorAll('#rig-pick option')].map(o => o.value).filter(Boolean));
ok('the picker offers the mammals and the bespoke birds', offered.length >= 15,
  `${offered.length} creatures`);
const ghostless = [];
for (const id of offered) {
  await page.selectOption('#rig-pick', id);
  await page.waitForTimeout(160);
  await page.click('#rig-ghost');
  await page.waitForTimeout(90);
  await page.evaluate(() => {
    const cv = document.getElementById('rig-canvas');
    window.__bare = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
  });
  await page.click('#rig-ghost');
  await page.waitForTimeout(90);
  const ink = await page.evaluate(() => {
    const cv = document.getElementById('rig-canvas');
    const a = window.__bare;
    const b = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
    let n = 0;
    for (let i = 0; i < b.length; i += 4) {
      if (Math.abs(b[i]-a[i]) + Math.abs(b[i+1]-a[i+1]) + Math.abs(b[i+2]-a[i+2]) > 6) n++;
    }
    return n;
  });
  if (ink < 2000) ghostless.push(`${id} (${ink})`);
}
ok('every creature offered shows its painter', !ghostless.length, ghostless.join(', '));

await page.selectOption('#rig-pick', 'deer');
await page.waitForTimeout(300);
ok('bench opens on a creature', await page.isVisible('#rig-canvas'));

/* ---- the starting skeletons ----
   Each has to load, draw something, and survive being played, because their
   whole point is to be the first thing a person sees on the bench. */
const skeletons = await page.evaluate(() =>
  [...document.querySelectorAll('#rig-start option')].map(o => o.value).filter(Boolean));
ok('skeletons are offered', skeletons.length >= 2, skeletons.join(', '));
const expected = await page.evaluate(async () => {
  const { TEMPLATES } = await import('/js/rig.js?v=7');
  return Object.fromEntries(Object.entries(TEMPLATES)
    .map(([k, t]) => [k, t.rig.parts.map(p => p.id)]));
});
for (const key of skeletons) {
  await page.selectOption('#rig-start', key);
  await page.waitForTimeout(220);
  const s = await rig();
  ok(`${key}: loads as a rig`,
    !!s && JSON.stringify(s.parts.map(p => p.id)) === JSON.stringify(expected[key]),
    s ? s.parts.map(p => p.id).join(' ') : 'nothing');
  ok(`${key}: every part has a unique name`,
    !!s && new Set(s.parts.map(p => p.id)).size === s.parts.length);
  const ink = await page.evaluate(() => {
    const cv = document.getElementById('rig-canvas');
    const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
    let n = 0;
    for (let i = 3; i < d.length; i += 4) if (d[i] > 0) n++;
    return n;
  });
  ok(`${key}: draws on the bench`, ink > 0);
}
/* back to an empty bench for the rest */
await page.click('#rig-reset');
await page.waitForTimeout(250);
ok('reset clears the skeleton', (await rig()) === null);

/* ---- add a shape ---- */
await page.selectOption('#rig-add', 'ellipse');
await page.waitForTimeout(200);
let r = await rig();
ok('adding a shape makes a rig', !!r && r.parts.length === 1,
  r ? `${r.parts.length} parts` : 'no rig');
ok('the new part is listed', (await page.locator('.rig-part').count()) === 1);
ok('the new part is selected', await page.locator('.rig-part.on').count() === 1);

/* Where a point in creature units sits on screen, so it can be grabbed. The
   bench scales itself to the canvas, so its mapping is read off the element
   rather than assumed — a copy of the formula here would drift the first time
   the bench changed how it fits the animal, and the drags would quietly start
   missing. */
const at = async (ux, uy) => page.evaluate(([x, y]) => {
  const cv = document.getElementById('rig-canvas');
  const b = cv.getBoundingClientRect(), v = cv.__bench;
  return { x: b.left + v.ox + x * v.unit, y: b.top + v.oy + y * v.unit };
}, [ux, uy]);

/* ---- drag the part ---- */
const before = (await rig()).parts[0];
let p = await at(before.cx, before.cy);
let q = await at(before.cx + 0.4, before.cy - 0.3);
await page.mouse.move(p.x, p.y);
await page.mouse.down();
await page.mouse.move(q.x, q.y, { steps: 8 });
await page.mouse.up();
await page.waitForTimeout(150);
r = await rig();
let d = (r.poses.rest || {})[before.id];
ok('dragging a part writes into the pose', !!d && Math.abs(d.dx - 0.4) < 0.05 && Math.abs(d.dy + 0.3) < 0.05,
  d ? `dx ${d.dx?.toFixed(2)} dy ${d.dy?.toFixed(2)}` : 'nothing written');

/* ---- drag one of its points, to reshape it ---- */
const part0 = (await rig()).parts[0];
const off = (await rig()).poses.rest[part0.id] || { dx: 0, dy: 0 };
p = await at(part0.cx + part0.rx + off.dx, part0.cy + off.dy);   // the radius handle
q = await at(part0.cx + part0.rx + 0.25 + off.dx, part0.cy + off.dy);
await page.mouse.move(p.x, p.y);
await page.mouse.down();
await page.mouse.move(q.x, q.y, { steps: 6 });
await page.mouse.up();
await page.waitForTimeout(150);
r = await rig();
ok('dragging a handle reshapes the part', r.parts[0].rx > part0.rx + 0.15,
  `rx ${part0.rx.toFixed(2)} -> ${r.parts[0].rx.toFixed(2)}`);

/* ---- a second shape, so depth ordering has something to order ---- */
await page.selectOption('#rig-add', 'leg');
await page.waitForTimeout(200);
r = await rig();
ok('a second shape lands on top', r.parts.length === 2 && r.parts[1].z > r.parts[0].z);

/* ---- name a pose ---- */
await page.click('#rig-newpose');
await page.fill('#rig-posename', 'graze');
await page.fill('#rig-posewhen', 'grazing');
await page.click('#rig-poseadd');
await page.waitForTimeout(250);
r = await rig();
ok('a pose can be named', !!(r && r.poses && r.poses.graze), Object.keys(r.poses).join(', '));
ok('the pose is bound to a flag', !!(r.when && r.when.graze === 'grazing'),
  JSON.stringify(r.when || {}));
ok('the pose is now the one being edited',
  (await page.locator('.rig-pose.on').textContent()) === 'graze');
ok('the pose form closes after adding', await page.locator('#rig-posebox.hidden').count() === 1);

/* ---- move a part in that pose, and confirm rest is untouched ---- */
const restBefore = JSON.stringify((await rig()).poses.rest);
const pa = (await rig()).parts[0];
const grazeOff = (await rig()).poses.graze[pa.id] || { dx: 0, dy: 0 };
p = await at(pa.cx + grazeOff.dx, pa.cy + grazeOff.dy);
q = await at(pa.cx + grazeOff.dx, pa.cy + grazeOff.dy + 0.5);
await page.mouse.move(p.x, p.y);
await page.mouse.down();
await page.mouse.move(q.x, q.y, { steps: 8 });
await page.mouse.up();
await page.waitForTimeout(150);
r = await rig();
ok('posing moves the part in that pose only',
  Math.abs(r.poses.graze[pa.id].dy - (grazeOff.dy + 0.5)) < 0.06
  && JSON.stringify(r.poses.rest) === restBefore,
  `graze dy ${r.poses.graze[pa.id].dy?.toFixed(2)}`);

/* ---- playback ---- */
const still = async () => page.evaluate(() => {
  const cv = document.getElementById('rig-canvas');
  const c = cv.getContext('2d');
  const d = c.getImageData(0, 0, cv.width, cv.height).data;
  let h = 0x811c9dc5;
  for (let i = 0; i < d.length; i += 4) h = Math.imul(h ^ d[i] ^ d[i+1] ^ d[i+2], 16777619);
  return h >>> 0;
});
await page.click('#rig-play');
/* Watch the readout for long enough to go round: every pose must come up, a
   blend of two must be seen, and the picture must differ between the two holds
   — a crossfade that never redraws the creature is not one. A hold is by
   design perfectly still, so the frames have to be taken from *named* moments
   rather than from any two ticks a fixed wait apart. */
const seen = new Set();
let blended = false;
const holdShot = {};
for (let i = 0; i < 110; i++) {
  const s = (await page.textContent('#rig-now')) || '';
  for (const bit of s.split('·')) { const n = bit.trim().split(' ')[0]; if (n) seen.add(n); }
  if (s.includes('·')) blended = true;
  const solo = /^(\w+) 1\.00$/.exec(s.trim());
  if (solo && !holdShot[solo[1]]) holdShot[solo[1]] = await still();
  await page.waitForTimeout(50);
}
ok('play visits every pose', seen.has('rest') && seen.has('graze'), [...seen].join(', '));
ok('play crossfades between them', blended);
ok('the poses look different from each other',
  holdShot.rest && holdShot.graze && holdShot.rest !== holdShot.graze,
  Object.keys(holdShot).join(', '));
await page.click('#rig-play');
await page.waitForTimeout(100);
ok('the readout clears when play stops', (await page.textContent('#rig-now')) === '');

/* ---- undo ---- */
const beforeUndo = JSON.stringify(await rig());
await page.click('#rig-undo');
await page.waitForTimeout(200);
ok('undo steps back', JSON.stringify(await rig()) !== beforeUndo);

/* ---- the draft survives a reload, and the window never sees it ---- */
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(500);
ok('the draft is remembered', !!(await rig()));
/* The file on disk is what the window ships. Comments in it show the shape of a
   rig on purpose, so they have to come off before looking, or the documentation
   reads as a leak. */
const shipped = await page.evaluate(async () => {
  const res = await fetch('/js/rigs.js?v=7');
  const src = (await res.text())
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
  return /RIGS\.\w+\s*=/.test(src) || /\bparts\s*:/.test(src);
});
ok('nothing leaks into the shipped file', !shipped);

/* ---- discard ---- */
await page.click('#bz-rig-open');
await page.selectOption('#rig-pick', 'deer');
await page.waitForTimeout(200);
await page.click('#rig-reset');
await page.waitForTimeout(250);
ok('discarding gives the creature back to its painter', (await rig()) === null);

await browser.close();

let bad = 0;
for (const c of checks) {
  if (!c.pass) bad++;
  console.log(`  ${c.pass ? ' ok  ' : 'FAIL '} ${c.name.padEnd(46)} ${c.note}`);
}
if (pageErrors.length) { console.log('\npage errors:\n  ' + pageErrors.slice(0, 6).join('\n  ')); bad++; }
console.log(bad ? `\n${bad} failing` : '\nthe bench works');
process.exit(bad ? 1 : 0);
