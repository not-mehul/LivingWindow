/* ============================================================
   The rig editor — drawing the creatures instead of writing them.

   A full-screen bench over the bestiary. On the left, the animal at a size you
   can actually work at, with the hand-written painter showing through it in
   ghost so a creature that is badly drawn can be redrawn over itself rather
   than from nothing. On the right, its parts and its poses.

   Everything is direct: click a part to select it, drag it to move it, drag its
   points to reshape it. Shapes are added from the palette and land somewhere
   visible. Colours are the theme's three slots rather than a picker, because a
   creature that keeps its own colours would stop answering to the hour.

   Poses are named arrangements — 'graze', 'alert' — and the runtime blends
   between them by weight, which is what the window's crossfades already are. A
   leg through a stride is not a pose but an oscillation, so a part can be given
   one, reading the same stride phase the engine already counts.
   ============================================================ */
import { SLOTS, TEMPLATES, paintRig, newPart, handles, hitTest } from "./rig.js?v=7";
import { RIGS } from "./rigs.js?v=7";

const DRAFTS = "lw.bestiary.rigs";        // the bestiary only; the window never reads it
const UNIT = 150;                          // fallback px per creature unit, before the first measure
const GRAB = 8;                            // how near counts as grabbing a handle

export function mountEditor(scene, cards, onChange) {
  const el = {};
  for (const id of ["rig", "rig-canvas", "rig-who", "rig-parts", "rig-poses", "rig-props",
                    "rig-close", "rig-add", "rig-copy", "rig-reset", "rig-ghost",
                    "rig-play", "rig-pick", "rig-out", "rig-undo", "rig-newpose", "rig-status",
                    "rig-posebox", "rig-posename", "rig-posewhen", "rig-poseadd",
                    "rig-posecancel", "rig-now", "rig-start"]) {
    el[id] = document.getElementById(id);
  }
  const cv = el["rig-canvas"], ctx = cv.getContext("2d");

  let card = null;            // which creature is on the bench
  let rig = null;             // its rig, as data
  let sel = null;             // selected part id
  let pose = "rest";          // the pose being edited
  let playing = false;
  let ghost = true;
  const undo = [];

  /* ---- drafts ---- */
  const readDrafts = () => {
    try { return JSON.parse(localStorage.getItem(DRAFTS) || "{}"); }
    catch { return {}; }
  };
  const writeDraft = (id, r) => {
    const all = readDrafts();
    if (r) all[id] = r; else delete all[id];
    try { localStorage.setItem(DRAFTS, JSON.stringify(all)); } catch {}
  };
  /* A draft is live the moment it exists: putting it in RIGS is what makes the
     bestiary card and the bench draw the same thing, through the same dispatch
     the window uses. */
  const publish = () => {
    if (rig && rig.parts.length) RIGS[card.id] = rig; else delete RIGS[card.id];
    writeDraft(card.id, rig && rig.parts.length ? rig : null);
    el["rig-out"].value = rig && rig.parts.length
      ? `RIGS.${card.id} = ${JSON.stringify(rig, null, 1)};` : "Nothing drawn yet.";
    if (onChange) onChange();
  };
  const snapshot = () => {
    undo.push(JSON.stringify(rig));
    if (undo.length > 60) undo.shift();
  };

  for (const [id, r] of Object.entries(readDrafts())) RIGS[id] = r;   // restore on load

  const part = () => rig && rig.parts.find(p => p.id === sel);
  const poseOf = (p) => (rig.poses[pose] && rig.poses[pose][p.id]) || null;

  /* ---- geometry: the bench is creature units, y climbing negative ----
     The scale follows the canvas rather than being fixed, so the animal fills
     the bench on a laptop and on a large screen alike — a creature drawn at a
     tenth of the height is one you cannot judge and cannot grab. Recomputed
     only when the canvas is resized, and left on the element so the harness
     that drives this by pointer can find the same mapping the pointer does. */
  const DPR = Math.min(window.devicePixelRatio || 1, 2);
  let view = { ox: 0, oy: 0, unit: UNIT };
  function measure(w, h) {
    const unit = Math.max(70, Math.min(420, Math.min(h / 2.9, w / 3.4)));
    view = { ox: w / 2, oy: h * 0.78, unit };
    cv.__bench = view;
  }
  const toScreen = (x, y) => [view.ox + x * view.unit, view.oy + y * view.unit];
  const toUnit = (sx, sy) => [(sx - view.ox) / view.unit, (sy - view.oy) / view.unit];

  /* ---- playback ----
     A rig's poses are named states the window crossfades between, so the only
     honest preview is the crossfade itself: hold each pose a moment, take a
     moment to arrive at the next, and go round. Every flag a pose is bound to
     is driven as it goes, so an oscillator gated on `walking` beats exactly
     when the walking pose is up — and the ghost painter, reading the same
     parameters, keeps step with the rig it is being traced by. */
  const HOLD = 1.4, BLEND = 0.6;
  function playbackWeights(t) {
    const names = Object.keys(rig.poses);
    if (names.length < 2) return { [names[0] || "rest"]: 1 };
    const span = HOLD + BLEND, total = names.length * span;
    const u = ((t % total) + total) % total;
    const i = Math.floor(u / span), into = u - i * span;
    const a = names[i], b = names[(i + 1) % names.length];
    if (into <= HOLD) return { [a]: 1 };
    const k = (into - HOLD) / BLEND;
    const e = k * k * (3 - 2 * k);           // smoothstep, as the window eases
    return { [a]: 1 - e, [b]: e };
  }
  /* What it is doing right now, in words — a blend is a thing you want to read
     as well as watch, and it is how you tell a pose that is arriving from one
     that never comes up at all. */
  let nowText = "";
  function showWeights(w) {
    const s = Object.entries(w).filter(([, v]) => v > 0.01)
      .sort((a, b) => b[1] - a[1])
      .map(([k, v]) => `${k} ${v.toFixed(2)}`).join(" · ");
    if (s !== nowText) { nowText = s; el["rig-now"].textContent = s; }
  }

  /* ---- drawing the bench ---- */
  let t0 = performance.now();
  function draw() {
    const w = cv.clientWidth, h = cv.clientHeight;
    if (cv.width !== w * DPR) { cv.width = w * DPR; cv.height = h * DPR; measure(w, h); }
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    const styles = getComputedStyle(document.documentElement);
    const tok = (n, fb) => styles.getPropertyValue(n).trim() || fb;
    const ink = tok("--scene-ink", "#241d15");
    const deep = tok("--scene-ink-deep", "#0f0c09");

    /* The bench is lit like the window is: a pale day sky with the ground under
       it, because that is what these animals are — a dark silhouette against
       light. Drawing them on the panel's own near-black, which is what this
       did first, hides the creature and hides the ghost you are tracing, which
       is most of the point. */
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, tok("--scene-sky-day-top", "#efe7d3"));
    g.addColorStop(1, tok("--scene-sky-day-bot", "#ddd0b2"));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    const v = view;
    ctx.fillStyle = "rgba(60,50,34,0.10)";
    ctx.fillRect(0, v.oy, w, h - v.oy);

    /* A quarter-unit grid over the ground the creature stands on, bounded so it
       reads as a frame around the work rather than as lines running off the
       edges — and a half-unit rule, so proportion can be counted not guessed. */
    const gx0 = Math.ceil(-v.ox / v.unit * 4) / 4, gx1 = Math.floor((w - v.ox) / v.unit * 4) / 4;
    const gyTop = Math.ceil(-v.oy / v.unit * 4) / 4;
    ctx.lineWidth = 1;
    for (const [step, alpha] of [[0.25, 0.07], [1, 0.16]]) {
      ctx.strokeStyle = `rgba(60,50,34,${alpha})`;
      ctx.beginPath();
      for (let gx = Math.ceil(gx0 / step) * step; gx <= gx1 + 1e-6; gx += step) {
        const [x, ya] = toScreen(gx, gyTop), [, yb] = toScreen(gx, 0.5);
        ctx.moveTo(Math.round(x) + 0.5, ya); ctx.lineTo(Math.round(x) + 0.5, yb);
      }
      for (let gy = Math.ceil(gyTop / step) * step; gy <= 0.5 + 1e-6; gy += step) {
        const [xa, y] = toScreen(gx0, gy), [xb] = toScreen(gx1, gy);
        ctx.moveTo(xa, Math.round(y) + 0.5); ctx.lineTo(xb, Math.round(y) + 0.5);
      }
      ctx.stroke();
    }
    ctx.strokeStyle = "rgba(60,50,34,0.45)"; ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.moveTo(0, v.oy); ctx.lineTo(w, v.oy); ctx.stroke();

    const t = (performance.now() - t0) / 1000;
    const o = {
      x: v.ox, y: v.oy, s: v.unit, dir: 1, t,
      color: ink, deep, rim: tok("--scene-sun", "#f2c98c"),
      alpha: 1, lp: t * 6, walking: playing, grazing: false, alert: false
    };

    /* Which poses are showing, and the flags that go with them. Set before the
       ghost is drawn so the painter and the rig are asked for the same moment. */
    const weights = rig ? (playing ? playbackWeights(t) : { [pose]: 1 }) : null;
    if (weights && playing && rig.when) {
      for (const [name, field] of Object.entries(rig.when)) o[field] = weights[name] || 0;
    }
    if (weights && playing) showWeights(weights); else if (nowText) showWeights({});

    // the painter, in ghost, as the thing being redrawn
    if (ghost && card && card.paint) {
      ctx.save();
      ctx.globalAlpha = 0.22;
      try { card.paint(ctx, o); } catch (e) { /* a painter that needs more than this */ }
      ctx.restore();
    }

    if (rig && rig.parts.length) {
      paintRig(scene, ctx, rig, { ...o, poses: rig.poses, weights });
    }

    // handles for the selected part, on top of everything
    const p = part();
    if (p && !playing) {
      const d = poseOf(p) || { dx: 0, dy: 0 };
      ctx.save();
      ctx.translate((d.dx || 0) * v.unit, (d.dy || 0) * v.unit);
      for (const hnd of handles(p)) {
        const [hx, hy] = hnd.get();
        const [sx, sy] = toScreen(hx, hy);
        ctx.beginPath(); ctx.arc(sx, sy, 4.5, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(212,165,116,0.95)"; ctx.fill();
        ctx.strokeStyle = "rgba(20,16,12,0.9)"; ctx.lineWidth = 1.2; ctx.stroke();
      }
      ctx.restore();
    }
    requestAnimationFrame(draw);
  }
  requestAnimationFrame(draw);

  /* ---- pointer: select, drag a part, drag a point ---- */
  let drag = null;
  cv.addEventListener("pointerdown", (ev) => {
    if (!rig || playing) return;
    const r = cv.getBoundingClientRect();
    const sx = ev.clientX - r.left, sy = ev.clientY - r.top;
    const [ux, uy] = toUnit(sx, sy);
    const p = part();
    // a handle of the selected part wins over selecting something else
    if (p) {
      const d = poseOf(p) || { dx: 0, dy: 0 };
      const hs = handles(p);
      for (let i = 0; i < hs.length; i++) {
        const [hx, hy] = hs[i].get();
        const [px, py] = toScreen(hx + (d.dx || 0), hy + (d.dy || 0));
        if (Math.hypot(px - sx, py - sy) > GRAB) continue;
        /* Alt takes a point away, since the palette can only put them in. Three
           is the floor: fewer than that is a line, not an outline. */
        if (ev.altKey && p.kind === "poly" && p.pts.length > 3) {
          snapshot();
          p.pts.splice(i, 1);
          publish(); buildProps();
          return;
        }
        snapshot();
        drag = { kind: "handle", hnd: hs[i], part: p };
        cv.setPointerCapture(ev.pointerId);
        return;
      }
    }
    // otherwise pick whatever is under the cursor, topmost first
    const order = rig.parts.slice().sort((a, b) => (b.z || 0) - (a.z || 0));
    const hit = order.find(q => {
      const d = (rig.poses[pose] && rig.poses[pose][q.id]) || { dx: 0, dy: 0 };
      return hitTest(scene, q, sx - (d.dx || 0) * view.unit - view.ox,
        sy - (d.dy || 0) * view.unit - view.oy, view.unit);
    });
    if (hit) {
      sel = hit.id;
      buildParts(); buildProps();
      snapshot();
      drag = { kind: "part", part: hit, from: [ux, uy] };
      cv.setPointerCapture(ev.pointerId);
    }
  });
  cv.addEventListener("pointermove", (ev) => {
    if (!drag) return;
    const r = cv.getBoundingClientRect();
    const [ux, uy] = toUnit(ev.clientX - r.left, ev.clientY - r.top);
    if (drag.kind === "handle") {
      const d = poseOf(drag.part) || { dx: 0, dy: 0 };
      drag.hnd.set(ux - (d.dx || 0), uy - (d.dy || 0));
    } else {
      // moving a part in a pose moves it *in that pose*, which is what posing is
      const q = rig.poses[pose] || (rig.poses[pose] = {});
      const d = q[drag.part.id] || (q[drag.part.id] = { dx: 0, dy: 0, rot: 0, sx: 1, sy: 1 });
      d.dx = (d.dx || 0) + (ux - drag.from[0]);
      d.dy = (d.dy || 0) + (uy - drag.from[1]);
      drag.from = [ux, uy];
      buildProps();
    }
  });
  const endDrag = () => { if (drag) { drag = null; publish(); } };
  cv.addEventListener("pointerup", endDrag);
  cv.addEventListener("pointercancel", endDrag);

  /* ---- panels ---- */
  function row(label, node, cls) {
    const d = document.createElement("div");
    d.className = "rig-f" + (cls ? " " + cls : "");
    const l = document.createElement("label"); l.textContent = label;
    d.append(l, node);
    return d;
  }
  function num(label, get, set, lo, hi, step) {
    const i = document.createElement("input");
    i.type = "range"; i.min = lo; i.max = hi; i.step = step || 0.01; i.value = get();
    const v = document.createElement("span"); v.className = "val";
    const show = () => { v.textContent = (+get()).toFixed(2); };
    i.addEventListener("input", () => { set(+i.value); show(); publish(); });
    show();
    const d = row(label, i);
    d.appendChild(v);
    return d;
  }

  function buildParts() {
    const box = el["rig-parts"];
    box.innerHTML = "";
    if (!rig) return;
    for (const p of rig.parts.slice().sort((a, b) => (b.z || 0) - (a.z || 0))) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "rig-part" + (p.id === sel ? " on" : "");
      b.innerHTML = `<span>${p.id}</span><span class="k">${p.kind}</span>`;
      b.addEventListener("click", () => { sel = p.id; buildParts(); buildProps(); });
      box.appendChild(b);
    }
  }

  function buildProps() {
    const box = el["rig-props"];
    box.innerHTML = "";
    const p = part();
    if (!p) { box.innerHTML = `<p class="rig-hint">No part selected.</p>`; return; }

    const fill = document.createElement("select");
    for (const sl of SLOTS) {
      const o = document.createElement("option"); o.value = sl; o.textContent = sl;
      fill.appendChild(o);
    }
    fill.value = p.fill;
    fill.addEventListener("change", () => { p.fill = fill.value; publish(); });
    box.appendChild(row("colour", fill));

    box.appendChild(num("depth", () => p.z || 0, (v) => { p.z = v; buildParts(); }, -10, 10, 1));

    const d = rig.poses[pose] && rig.poses[pose][p.id];
    if (d) {
      box.appendChild(num("turn", () => d.rot || 0, (v) => { d.rot = v; }, -3.14, 3.14));
      box.appendChild(num("wide", () => d.sx === undefined ? 1 : d.sx, (v) => { d.sx = v; }, 0.1, 3));
      box.appendChild(num("tall", () => d.sy === undefined ? 1 : d.sy, (v) => { d.sy = v; }, 0.1, 3));
    }

    if (p.kind === "poly") {
      const add = document.createElement("button");
      add.type = "button"; add.className = "rig-mini"; add.textContent = "+ point";
      add.addEventListener("click", () => {
        snapshot();
        const a = p.pts[p.pts.length - 1], b2 = p.pts[0];
        p.pts.push([(a[0] + b2[0]) / 2, (a[1] + b2[1]) / 2]);
        publish(); buildProps();
      });
      const smooth = document.createElement("input");
      smooth.type = "checkbox"; smooth.checked = p.smooth !== false;
      smooth.addEventListener("change", () => { p.smooth = smooth.checked; publish(); });
      const hint = document.createElement("p");
      hint.className = "rig-hint";
      hint.textContent = "Drag a point to move it. Alt-click one to take it away.";
      box.append(row("smooth", smooth, "bool"), add, hint);
    }
    if (p.kind === "limb" || p.kind === "leg" || p.kind === "wing") {
      box.appendChild(num("thick", () => p.w0 !== undefined ? p.w0 : p.w,
        (v) => { if (p.w0 !== undefined) p.w0 = v; else p.w = v; }, 0.01, 0.5));
      if (p.kind === "leg") box.appendChild(num("bend", () => p.bend || 0, (v) => { p.bend = v; }, -0.5, 0.5));
    }

    /* an oscillator, for what no pose can hold */
    const osc = document.createElement("button");
    osc.type = "button"; osc.className = "rig-mini";
    osc.textContent = p.osc ? "remove cycle" : "+ cycle";
    osc.addEventListener("click", () => {
      snapshot();
      if (p.osc) delete p.osc;
      else p.osc = { on: "walking", from: "lp", prop: "rot", amp: 0.3, rate: 1, phase: 0 };
      publish(); buildProps();
    });
    box.appendChild(osc);
    if (p.osc) {
      box.appendChild(num("swing", () => p.osc.amp, (v) => { p.osc.amp = v; }, 0, 1.5));
      box.appendChild(num("offset", () => p.osc.phase, (v) => { p.osc.phase = v; }, 0, 6.28));
      const pr = document.createElement("select");
      for (const k of ["rot", "dx", "dy"]) {
        const o = document.createElement("option"); o.value = k;
        o.textContent = k === "rot" ? "turn" : k === "dx" ? "side" : "up";
        pr.appendChild(o);
      }
      pr.value = p.osc.prop;
      pr.addEventListener("change", () => { p.osc.prop = pr.value; publish(); });
      box.appendChild(row("moves", pr));
    }

    const del = document.createElement("button");
    del.type = "button"; del.className = "rig-mini danger"; del.textContent = "delete part";
    del.addEventListener("click", () => {
      snapshot();
      rig.parts = rig.parts.filter(q => q.id !== p.id);
      for (const q of Object.values(rig.poses)) delete q[p.id];
      sel = null; publish(); buildParts(); buildProps();
    });
    box.appendChild(del);
  }

  function buildPoses() {
    const box = el["rig-poses"];
    box.innerHTML = "";
    if (!rig) return;
    for (const name of Object.keys(rig.poses)) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "rig-pose" + (name === pose ? " on" : "");
      b.textContent = name;
      b.title = rig.when && rig.when[name]
        ? `shows when ${rig.when[name]}` : "driven by hand";
      b.addEventListener("click", () => { pose = name; buildPoses(); buildProps(); });
      box.appendChild(b);
      /* rest is the pose everything else is measured from, so it has no × —
         a rig without it has nothing to fall back to. */
      if (name === "rest") continue;
      const x = document.createElement("span");
      x.className = "rig-posex"; x.textContent = "×";
      x.title = `Delete the pose "${name}"`;
      x.setAttribute("role", "button"); x.tabIndex = 0;
      const drop = () => {
        snapshot();
        delete rig.poses[name];
        if (rig.when) delete rig.when[name];
        if (pose === name) pose = "rest";
        publish(); buildPoses(); buildProps();
      };
      x.addEventListener("click", drop);
      x.addEventListener("keydown", (ev) => { if (ev.key === "Enter" || ev.key === " ") drop(); });
      box.appendChild(x);
    }
  }

  /* ---- buttons ---- */
  el["rig-add"].addEventListener("change", () => {
    const kind = el["rig-add"].value;
    if (!kind || !rig) return;
    snapshot();
    const p = newPart(kind);
    p.z = rig.parts.length;
    rig.parts.push(p);
    sel = p.id;
    el["rig-add"].value = "";
    publish(); buildParts(); buildProps();
  });
  /* Adding a pose asks for two things — what it is called and what brings it
     on — so it is two fields on the panel rather than two modal prompts one
     after the other. The second is optional: a pose with no flag is one you
     drive by hand here, which is how you build it before deciding when it
     should show. */
  const closePoseBox = () => {
    el["rig-posebox"].classList.add("hidden");
    el["rig-posename"].value = ""; el["rig-posewhen"].value = "";
  };
  /* Starting from a skeleton rather than from nothing. It replaces whatever is
     on the bench, so it asks first if there is anything to lose — but an empty
     rig is nothing to lose, and that is the case this is for. */
  el["rig-start"].innerHTML = `<option value="">start from…</option>`
    + Object.entries(TEMPLATES).map(([k, t]) => `<option value="${k}">${t.label}</option>`).join("");
  el["rig-start"].addEventListener("change", () => {
    const key = el["rig-start"].value;
    el["rig-start"].value = "";
    const tpl = TEMPLATES[key];
    if (!tpl || !rig) return;
    if (rig.parts.length && !confirm(
      `Start ${card.name} again from a ${tpl.label}? What is drawn now is replaced.`)) return;
    snapshot();
    rig = JSON.parse(JSON.stringify(tpl.rig));
    sel = null; pose = "rest";
    publish(); buildParts(); buildPoses(); buildProps();
  });

  el["rig-newpose"].addEventListener("click", () => {
    if (!rig) return;
    el["rig-posebox"].classList.remove("hidden");
    el["rig-posename"].focus();
  });
  el["rig-posecancel"].addEventListener("click", closePoseBox);
  el["rig-poseadd"].addEventListener("click", () => {
    if (!rig) return;
    const name = el["rig-posename"].value.trim();
    if (!name) { el["rig-posename"].focus(); return; }
    if (rig.poses[name]) { pose = name; closePoseBox(); buildPoses(); buildProps(); return; }
    snapshot();
    // a new pose starts where the current one stands, so it is an edit not a blank
    rig.poses[name] = JSON.parse(JSON.stringify(rig.poses[pose] || {}));
    const field = el["rig-posewhen"].value.trim();
    if (field) (rig.when || (rig.when = {}))[name] = field;
    pose = name;
    closePoseBox();
    publish(); buildPoses(); buildProps();
  });
  for (const id of ["rig-posename", "rig-posewhen"]) {
    el[id].addEventListener("keydown", (ev) => {
      if (ev.key === "Enter") { ev.preventDefault(); el["rig-poseadd"].click(); }
      if (ev.key === "Escape") { ev.preventDefault(); closePoseBox(); }
    });
  }
  el["rig-undo"].addEventListener("click", () => {
    if (!undo.length) return;
    rig = JSON.parse(undo.pop());
    sel = null; publish(); buildParts(); buildPoses(); buildProps();
  });
  el["rig-ghost"].addEventListener("click", () => {
    ghost = !ghost;
    el["rig-ghost"].setAttribute("aria-pressed", String(ghost));
  });
  el["rig-play"].addEventListener("click", () => {
    playing = !playing;
    el["rig-play"].setAttribute("aria-pressed", String(playing));
    el["rig-play"].textContent = playing ? "■ stop" : "▶ play";
  });
  el["rig-copy"].addEventListener("click", async () => {
    const b = el["rig-copy"], was = b.textContent;
    try { await navigator.clipboard.writeText(el["rig-out"].value); b.textContent = "copied"; }
    catch { el["rig-out"].select(); b.textContent = "select + copy"; }
    setTimeout(() => { b.textContent = was; }, 1400);
  });
  el["rig-reset"].addEventListener("click", () => {
    if (!card || !confirm(`Throw away the rig for ${card.name}? It goes back to its painter.`)) return;
    snapshot();
    rig = { parts: [], poses: { rest: {} } };
    sel = null; publish(); buildParts(); buildPoses(); buildProps();
  });
  el["rig-close"].addEventListener("click", () => close());

  function close() {
    el.rig.classList.add("hidden");
    document.body.style.overflow = "";
  }

  /* ---- opening the bench on a creature ---- */
  function open(c) {
    card = c;
    rig = RIGS[c.id]
      ? JSON.parse(JSON.stringify(RIGS[c.id]))
      : { parts: [], poses: { rest: {} }, when: {} };
    if (!rig.poses) rig.poses = { rest: {} };
    if (!rig.poses.rest) rig.poses.rest = {};
    sel = null; pose = "rest"; playing = false; undo.length = 0;
    closePoseBox();
    el["rig-now"].textContent = ""; nowText = "";
    t0 = performance.now();
    el["rig-who"].innerHTML = `${c.name} <span class="latin">${c.latin || ""}</span>`;
    el["rig-status"].textContent = c.paint
      ? "Its painter is showing through in ghost — draw over it."
      : "No painter to trace; this one starts from nothing.";
    el["rig-play"].setAttribute("aria-pressed", "false");
    el["rig-play"].textContent = "▶ play";
    el["rig-ghost"].setAttribute("aria-pressed", String(ghost));
    el.rig.classList.remove("hidden");
    document.body.style.overflow = "hidden";
    publish(); buildParts(); buildPoses(); buildProps();
  }

  // fill the creature picker, mammals and bespoke birds first — the ones asked for
  const pick = el["rig-pick"];
  pick.innerHTML = `<option value="">choose a creature…</option>`
    + cards.map(c => `<option value="${c.id}">${c.name}</option>`).join("");
  pick.addEventListener("change", () => {
    const c = cards.find(x => x.id === pick.value);
    if (c) open(c);
  });

  return { open, close };
}
