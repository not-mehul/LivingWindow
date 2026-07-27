/* ============================================================
   Rigs — creatures as data rather than as code.

   Every animal in the window is a function: paintDeer is four jointed legs, a
   body of six bezier segments and a tail on a nested transform, all of it
   written out in units of the creature's own scale. That is why they stay sharp
   at any size and recolour with the hour — and also why they cannot be drawn.
   You can only edit them by editing the code.

   A rig is the same creature expressed as parts, in the same units, drawn with
   the same primitives. Being data, it can be laid out with a mouse; being the
   same units and the same primitives, it loses nothing by it. Where a rig
   exists it stands in for the hand-written painter; where none does, nothing
   changes. Nothing here is required, and nothing is converted behind your back.

   The shape of one:

     { parts: [ { id, kind, fill, z, … } ],
       poses: { rest: { partId: {dx, dy, rot, sx, sy} }, graze: {…} } }

   Coordinates are in units of `s`, the creature's drawn size, with the origin
   where it meets the ground and y climbing negative — the convention the
   painters already use, so a rig and a painter can stand side by side and be
   compared honestly.

   Colours are named slots, never literals: "color" is the body in the light of
   the hour, "deep" a shaded part, "rim" a lit edge. The window hands those in
   already tinted for the time of day and the depth of field, so a rigged
   creature answers to dusk exactly as a painted one does.
   ============================================================ */

const KINDS = ["poly", "ellipse", "limb", "leg", "wing"];
const SLOTS = ["color", "deep", "rim"];

/* Anchors, plus a curve through them. Two points make a line; more make a
   smooth outline by running quadratics through the midpoints, which is how a
   handful of draggable points becomes the soft filled silhouette these animals
   are drawn as. Full bezier handles would be more exact and far worse to use. */
function tracePoly(c, pts, closed, smooth) {
  const n = pts.length;
  if (n < 2) return;
  if (!smooth || n < 3) {
    c.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < n; i++) c.lineTo(pts[i][0], pts[i][1]);
    if (closed) c.closePath();
    return;
  }
  const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  if (closed) {
    const m0 = mid(pts[n - 1], pts[0]);
    c.moveTo(m0[0], m0[1]);
    for (let i = 0; i < n; i++) {
      const cur = pts[i], m = mid(cur, pts[(i + 1) % n]);
      c.quadraticCurveTo(cur[0], cur[1], m[0], m[1]);
    }
    c.closePath();
  } else {
    c.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < n - 1; i++) {
      const m = mid(pts[i], pts[i + 1]);
      c.quadraticCurveTo(pts[i][0], pts[i][1], m[0], m[1]);
    }
    c.lineTo(pts[n - 1][0], pts[n - 1][1]);
  }
}

const ZERO = { dx: 0, dy: 0, rot: 0, sx: 1, sy: 1 };

/* Where a part stands right now: its own resting transform, plus however much
   of each pose is being asked for. Poses are given as weights rather than one
   name and a blend, so a creature can be part-way into a graze while still
   half alert — which is what a crossfade between two states really is. */
function resolve(part, weights, o) {
  const t = { dx: 0, dy: 0, rot: 0, sx: 1, sy: 1 };
  let total = 0;
  for (const [name, w] of Object.entries(weights || {})) {
    if (!w) continue;
    const p = (o.poses && o.poses[name] && o.poses[name][part.id]) || null;
    if (!p) { total += w; continue; }
    t.dx += (p.dx || 0) * w; t.dy += (p.dy || 0) * w; t.rot += (p.rot || 0) * w;
    t.sx += ((p.sx === undefined ? 1 : p.sx) - 1) * w;
    t.sy += ((p.sy === undefined ? 1 : p.sy) - 1) * w;
    total += w;
  }
  if (total > 1) { t.dx /= total; t.dy /= total; t.rot /= total; }
  /* And an oscillator, for the motion no pose can hold: a leg through a stride,
     a wing through a beat. It reads the phase the engine is already keeping —
     the same `lp` a walking deer counts its steps by — so a rigged leg swings
     in time with a painted one. */
  if (part.osc) {
    const on = part.osc.on ? (o[part.osc.on] ? 1 : 0) : 1;
    if (on) {
      const ph = (o[part.osc.from || "lp"] || 0) * (part.osc.rate || 1)
               + (part.osc.phase || 0);
      const v = Math.sin(ph) * (part.osc.amp || 0);
      if (part.osc.prop === "dx") t.dx += v;
      else if (part.osc.prop === "dy") t.dy += v;
      else t.rot += v;
    }
  }
  return t;
}

/* Draw one creature from its rig. `o` is the same parameter object the
   hand-written painters take — x, y, s, dir, the three colours, alpha — with
   `weights` naming which poses it is in, and whatever phases the oscillators
   read. */
function paintRig(scene, c, rig, o) {
  if (!rig || !rig.parts || !rig.parts.length) return;
  const s = o.s || 20;
  const colours = { color: o.color, deep: o.deep || o.color, rim: o.rim || o.color };
  c.save();
  c.translate(o.x, o.y);
  if (o.dir < 0) c.scale(-1, 1);
  if (o.alpha !== undefined && o.alpha < 1) c.globalAlpha = o.alpha;

  const order = rig.parts.slice().sort((a, b) => (a.z || 0) - (b.z || 0));
  for (const part of order) {
    if (part.hidden) continue;
    const t = resolve(part, o.weights || { rest: 1 }, o);
    c.save();
    c.translate(t.dx * s, t.dy * s);
    if (part.pivot) c.translate(part.pivot[0] * s, part.pivot[1] * s);
    if (t.rot) c.rotate(t.rot);
    if (t.sx !== 1 || t.sy !== 1) c.scale(t.sx, t.sy);
    if (part.pivot) c.translate(-part.pivot[0] * s, -part.pivot[1] * s);
    c.fillStyle = colours[part.fill] || colours.color;

    if (part.kind === "poly") {
      c.beginPath();
      tracePoly(c, part.pts.map(p => [p[0] * s, p[1] * s]),
        part.closed !== false, part.smooth !== false);
      c.fill();
    } else if (part.kind === "ellipse") {
      c.beginPath();
      c.ellipse(part.cx * s, part.cy * s, Math.abs(part.rx * s), Math.abs(part.ry * s),
        part.rot || 0, 0, Math.PI * 2);
      c.fill();
    } else if (part.kind === "limb") {
      scene.limb(c, part.x0 * s, part.y0 * s, part.x1 * s, part.y1 * s,
        part.w0 * s, part.w1 * s);
    } else if (part.kind === "leg") {
      scene.leg(c, part.x0 * s, part.y0 * s, part.x1 * s, part.y1 * s,
        part.bend || 0, part.w0 * s, part.w1 * s);
    } else if (part.kind === "wing") {
      scene.wingBlade(c, part.x0 * s, part.y0 * s, part.x1 * s, part.y1 * s, part.w * s);
    }
    c.restore();
  }
  c.restore();
}

/* A part of each kind, sized to sit sensibly on a creature about one unit tall,
   so a newly added shape lands somewhere you can see and grab. */
let seq = 0;
function newPart(kind) {
  const id = kind + (++seq);
  const base = { id, kind, fill: "color", z: 0 };
  if (kind === "poly") {
    return { ...base, closed: true, smooth: true,
      pts: [[-0.3, -0.5], [0.3, -0.55], [0.4, -0.3], [0, -0.2], [-0.35, -0.28]] };
  }
  if (kind === "ellipse") return { ...base, cx: 0, cy: -0.5, rx: 0.28, ry: 0.2, rot: 0 };
  if (kind === "limb") return { ...base, x0: 0, y0: -0.5, x1: 0.35, y1: -0.7, w0: 0.12, w1: 0.05 };
  if (kind === "leg") return { ...base, x0: 0, y0: -0.45, x1: 0.05, y1: 0, bend: 0.1, w0: 0.1, w1: 0.04 };
  if (kind === "wing") return { ...base, x0: 0, y0: -0.6, x1: 0.6, y1: -0.85, w: 0.18 };
  return base;
}

/* Every point a part exposes for dragging, as [x, y] in creature units, with a
   setter that puts it back. One list, so the editor needs no special case per
   kind: whatever a part is made of, it is grabbed the same way.

   These are the shape's own points, and moving one changes the shape in every
   pose. Moving the *part* is a different act — that is a drag on its body, and
   it belongs to the pose being edited. Keeping the two apart is why an ellipse
   has no handle at its centre: a dot there would sit exactly where you would
   grab the body, and which of the two you got would be a coin toss. */
function handles(part) {
  const h = [];
  const push = (label, get, set) => h.push({ label, get, set });
  if (part.kind === "poly") {
    part.pts.forEach((p, i) => push("p" + i, () => p, (x, y) => { p[0] = x; p[1] = y; }));
  } else if (part.kind === "ellipse") {
    push("radius", () => [part.cx + part.rx, part.cy],
      (x) => { part.rx = Math.max(0.01, x - part.cx); });
    push("height", () => [part.cx, part.cy + part.ry],
      (x, y) => { part.ry = Math.max(0.01, y - part.cy); });
  } else if (part.kind === "limb" || part.kind === "leg" || part.kind === "wing") {
    push("from", () => [part.x0, part.y0], (x, y) => { part.x0 = x; part.y0 = y; });
    push("to", () => [part.x1, part.y1], (x, y) => { part.x1 = x; part.y1 = y; });
  }
  return h;
}

/* Is this point inside the part? Used for click-to-select, and answered by
   drawing the part into a scratch context and asking the canvas — which is
   exact for every kind, including the tapered limbs, and needs no geometry of
   its own. */
function hitTest(scene, part, px, py, s) {
  const cv = hitTest._cv || (hitTest._cv = document.createElement("canvas"));
  cv.width = 1; cv.height = 1;
  const c = cv.getContext("2d", { willReadFrequently: true });
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.clearRect(0, 0, 1, 1);
  c.translate(-px, -py);
  c.fillStyle = "#fff";
  const one = { ...part, z: 0 };
  paintRig(scene, c, { parts: [one] }, { x: 0, y: 0, s, dir: 1, color: "#fff", weights: { rest: 1 } });
  return c.getImageData(0, 0, 1, 1).data[3] > 8;
}

/* ------------------------------------------------------------
   Starting skeletons.

   Redrawing an animal from an empty bench means placing fifteen shapes before
   anything looks like anything, which is enough work to stop the job being
   worth doing. These are not creatures — no deer is this shape — they are the
   parts an animal has, jointed and stacked in the right order and named so the
   list reads. Pick one, and the work becomes dragging its handles onto the
   ghost of the painter you are replacing.

   Units are the same as everywhere else: multiples of `s`, origin at the feet,
   y climbing negative, facing +x. The far-side legs are a shade darker and sit
   behind, which is the trick every painter here uses to suggest a body with a
   width; their oscillators run half a cycle apart, which is what a walk is.
   ------------------------------------------------------------ */
const STRIDE = { on: "walking", from: "lp", prop: "rot", amp: 0.3, rate: 1 };

const TEMPLATES = {
  quadruped: {
    label: "four-legged animal",
    rig: {
      parts: [
        { id: "farForeleg", kind: "leg", fill: "deep", z: 1,
          x0: 0.26, y0: -0.56, x1: 0.26, y1: 0, bend: 0.06, w0: 0.09, w1: 0.04,
          osc: { ...STRIDE, phase: Math.PI } },
        { id: "farHindleg", kind: "leg", fill: "deep", z: 1,
          x0: -0.32, y0: -0.54, x1: -0.36, y1: 0, bend: -0.08, w0: 0.12, w1: 0.045,
          osc: { ...STRIDE, phase: 0 } },
        { id: "tail", kind: "limb", fill: "deep", z: 2,
          x0: -0.44, y0: -0.72, x1: -0.62, y1: -0.52, w0: 0.07, w1: 0.03 },
        { id: "body", kind: "ellipse", fill: "color", z: 3,
          cx: 0, cy: -0.62, rx: 0.42, ry: 0.26, rot: 0 },
        { id: "haunch", kind: "ellipse", fill: "color", z: 4,
          cx: -0.30, cy: -0.60, rx: 0.24, ry: 0.24, rot: 0 },
        { id: "chest", kind: "ellipse", fill: "color", z: 4,
          cx: 0.26, cy: -0.62, rx: 0.22, ry: 0.21, rot: 0 },
        { id: "foreleg", kind: "leg", fill: "color", z: 5,
          x0: 0.28, y0: -0.58, x1: 0.30, y1: 0, bend: 0.06, w0: 0.10, w1: 0.045,
          osc: { ...STRIDE, phase: 0 } },
        { id: "hindleg", kind: "leg", fill: "color", z: 5,
          x0: -0.30, y0: -0.56, x1: -0.34, y1: 0, bend: -0.08, w0: 0.13, w1: 0.05,
          osc: { ...STRIDE, phase: Math.PI } },
        { id: "neck", kind: "limb", fill: "color", z: 6,
          x0: 0.36, y0: -0.70, x1: 0.60, y1: -0.94, w0: 0.16, w1: 0.11 },
        { id: "head", kind: "ellipse", fill: "color", z: 7,
          cx: 0.66, cy: -0.98, rx: 0.15, ry: 0.11, rot: -0.1 },
        { id: "muzzle", kind: "limb", fill: "color", z: 7,
          x0: 0.70, y0: -0.97, x1: 0.86, y1: -0.94, w0: 0.09, w1: 0.055 },
        { id: "ear", kind: "poly", fill: "deep", z: 8, closed: true, smooth: true,
          pts: [[0.60, -1.06], [0.64, -1.20], [0.70, -1.05]] }
      ],
      poses: { rest: {} },
      when: {}
    }
  },
  bird: {
    label: "perching bird",
    rig: {
      parts: [
        { id: "tail", kind: "poly", fill: "deep", z: 1, closed: true, smooth: true,
          pts: [[-0.20, -0.48], [-0.42, -0.47], [-0.58, -0.37],
                [-0.42, -0.29], [-0.20, -0.32]] },
        { id: "farLeg", kind: "leg", fill: "deep", z: 2,
          x0: -0.06, y0: -0.24, x1: -0.04, y1: 0, bend: 0.04, w0: 0.05, w1: 0.028 },
        { id: "leg", kind: "leg", fill: "deep", z: 3,
          x0: 0.04, y0: -0.24, x1: 0.06, y1: 0, bend: 0.04, w0: 0.05, w1: 0.028 },
        { id: "body", kind: "ellipse", fill: "color", z: 4,
          cx: 0, cy: -0.42, rx: 0.30, ry: 0.24, rot: -0.12 },
        { id: "wing", kind: "wing", fill: "deep", z: 5,
          x0: 0.06, y0: -0.50, x1: -0.26, y1: -0.34, w: 0.16,
          osc: { on: "flap", from: "t", prop: "rot", amp: 0.5, rate: 9, phase: 0 } },
        { id: "head", kind: "ellipse", fill: "color", z: 6,
          cx: 0.26, cy: -0.66, rx: 0.16, ry: 0.15, rot: 0 },
        { id: "bill", kind: "limb", fill: "rim", z: 7,
          x0: 0.39, y0: -0.66, x1: 0.57, y1: -0.63, w0: 0.07, w1: 0.02 }
      ],
      poses: { rest: {} },
      when: {}
    }
  }
};

/* Which poses a creature is in, read from the flags its painter was already
   given. A rig says `when: { graze: "grazing", alert: "alert" }` and the
   weights fall out of the parameters the engine passes anyway — so a rigged
   deer changes pose on exactly the tick a painted one did. A numeric field
   counts as a partial weight, which is what makes a crossfade; whatever is
   left over is `rest`. */
function poseWeights(rig, o) {
  const w = {};
  let used = 0;
  for (const [pose, field] of Object.entries(rig.when || {})) {
    const v = o[field];
    const n = typeof v === "number" ? Math.max(0, Math.min(1, v)) : (v ? 1 : 0);
    if (n > 0) { w[pose] = n; used += n; }
  }
  w.rest = Math.max(0, 1 - used);
  return w;
}

export { KINDS, SLOTS, TEMPLATES, paintRig, newPart, handles, hitTest, tracePoly,
         resolve, poseWeights };
