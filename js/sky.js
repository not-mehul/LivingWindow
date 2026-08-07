/* ============================================================
   The sky, and what hangs in it.

   Everything above the land — the graded sky, the stars, the sun
   and moon with their glows, the shooting stars, the clouds — is
   the same handful of shapes over and over: a vertical gradient,
   a disc, a soft radial blob, a small bright rectangle. It is
   also, measured, between two fifths and three fifths of the
   whole frame, because those blobs are enormous and translucent
   and the canvas blends every pixel of them by hand.

   None of it interleaves with the land: it is all strictly
   behind. So it can move to its own canvas underneath, drawn by
   the GPU, and the land can go on being drawn above it exactly
   as it always was.

   What lives here is a *painter*, not a renderer: two backends
   that take the same small vocabulary of calls. `GLSky` puts them
   on the GPU. `Canvas2DSky` puts them back where they were, and
   is what runs if WebGL is missing or the context is lost. The
   composition itself — which glow, in what order, at what alpha —
   stays in one place in scene.js and is written once, so the
   fallback cannot quietly drift away from the real thing.
   ============================================================ */

/* An eight-bit buffer cannot hold a smooth ramp: somewhere it has to step, and
   where the ramp is shallow those steps are wide enough to see. The canvas never
   showed them because Skia dithers its gradients — and dithers the radial sprite
   the old glow was blitted from — so the 2D path got it free, twice over. The
   GPU has to be told, and this is the telling.

   Interleaved gradient noise: one dot product and two fracts, no texture and no
   sin, so nothing here depends on a driver's idea of trigonometric precision.
   It is keyed on gl_FragCoord and on nothing else. A time term would break the
   bands more thoroughly and set the whole sky crawling, and on a piece this slow
   the crawl would be far worse than the banding it cured. */
const DITHER = `
float ign(vec2 p) {
  return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715))));
}`;

const VERT_SKY = `#version 300 es
in vec2 a_corner;
out float v_y;
void main() {
  v_y = a_corner.y * 0.5 + 0.5;
  gl_Position = vec4(a_corner, 0.0, 1.0);
}`;

const FRAG_SKY = `#version 300 es
precision highp float;
in float v_y;
uniform vec3 u_top;
uniform vec3 u_mid;
uniform vec3 u_bot;
uniform vec2 u_stops;
out vec4 o;
${DITHER}
void main() {
  /* v_y is 1 at the top of the screen, and the canvas gradient runs from its
     top colour at y=0 down to its bottom colour at y=H. Interpolating
     componentwise in sRGB is what a canvas linear gradient does, so this is
     the same ramp and not merely a similar one.

     Three stops rather than two. A real sky at either end of the day is not a
     ramp between two colours: it is cool overhead, warm at the horizon, and
     something else again in between — the pink between a dawn's violet and its
     gold is a band, not a crossing point. u_stops says where the middle
     colour sits and where the bottom one has fully arrived, both as fractions
     of the frame's height, so a scene can put its warm band exactly on its own
     skyline. A caller with nothing to say in the middle passes the halfway
     colour at 0.5, and the two segments below are then bit-for-bit the single
     ramp this used to be. */
  float y = 1.0 - v_y;
  vec3 c = y < u_stops.x
    ? mix(u_top, u_mid, y / max(1e-4, u_stops.x))
    : mix(u_mid, u_bot, clamp((y - u_stops.x) / max(1e-4, u_stops.y - u_stops.x), 0.0, 1.0));
  /* Half a level, and the same offset for all three channels — the way Skia
     does it. Per-channel offsets would dither each one independently and speckle
     the sky with colour. */
  o = vec4(c + (ign(gl_FragCoord.xy) - 0.5) / 255.0, 1.0);
}`;

const VERT_SPRITE = `#version 300 es
in vec2 a_corner;      // -1..1, the unit quad
in vec4 a_rect;        // centre xy, half-extent xy, in device pixels
in vec2 a_misc;        // rotation (radians), kind
in vec4 a_color;       // rgb 0..1, alpha
uniform vec2 u_res;
out vec2 v_local;
out vec4 v_color;
out float v_kind;
void main() {
  float s = sin(a_misc.x), c = cos(a_misc.x);
  vec2 off = a_corner * a_rect.zw;
  vec2 rot = vec2(off.x * c - off.y * s, off.x * s + off.y * c);
  vec2 p = a_rect.xy + rot;
  gl_Position = vec4(p.x / u_res.x * 2.0 - 1.0, 1.0 - p.y / u_res.y * 2.0, 0.0, 1.0);
  v_local = a_corner;
  v_color = a_color;
  v_kind  = a_misc.y;
}`;

const FRAG_SPRITE = `#version 300 es
precision highp float;
in vec2 v_local;
in vec4 v_color;
in float v_kind;
out vec4 o;
${DITHER}
void main() {
  vec3 rgb = v_color.rgb;
  float a = v_color.a;
  if (v_kind < 0.5) {
    /* A soft blob. The canvas version is a radial gradient from the colour at
       full alpha in the centre to the same colour at zero on the rim, and a
       canvas gradient ramps linearly between its stops — so the falloff is
       1 - r, not a smoothstep and not a gaussian. */
    float f = max(0.0, 1.0 - length(v_local));
    a *= f;
    /* This is the shape that bands: a sun's halo is a ramp half a frame wide,
       and the shallowest thing drawn here.

       Dither the colour, not the alpha. Alpha is a blend factor, so nudging it
       by d moves the result by d * (src - dst) — and the contrast it lands
       against is the sky behind, which the shader cannot read and which runs
       from nine levels under a dawn sun to two hundred under a winter moon. No
       single amplitude serves both: enough to break the dawn halo puts visible
       grain around the moon. Nudging the *colour* moves the result by d * a
       instead, so dividing by a lands half a level every time, whatever it is
       drawn over — and the awkward constant disappears with it.

       Only where the blob actually is: the quad's corners lie outside the circle
       and must stay at nothing, or every glow would wear a faint square of
       noise. The offset differs from the sky's so the two do not reinforce. */
    if (f > 0.0) {
      rgb += (ign(gl_FragCoord.xy + 17.0) - 0.5) / (255.0 * max(a, 0.03));
    }
  } else if (v_kind < 1.5) {
    /* A disc, feathered across one pixel, standing in for the antialiasing
       the canvas gives an arc for free. */
    float d = length(v_local);
    float w = max(fwidth(d), 1e-4);
    a *= 1.0 - smoothstep(1.0 - w, 1.0, d);
  }
  /* kind 2 is a plain rectangle — stars and their spikes — and takes the alpha
     unaltered. Nothing to dither: its alpha is flat across the quad, so there is
     no ramp to step, and a star is two pixels wide besides. */
  o = vec4(rgb, a);
}`;

const GLOW = 0, DISC = 1, RECT = 2;
const FLOATS = 10;              // rect(4) + misc(2) + colour(4)

function compile(gl, type, src) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh);
    gl.deleteShader(sh);
    throw new Error("shader: " + log);
  }
  return sh;
}

function link(gl, vsrc, fsrc) {
  const p = gl.createProgram();
  const vs = compile(gl, gl.VERTEX_SHADER, vsrc);
  const fs = compile(gl, gl.FRAGMENT_SHADER, fsrc);
  gl.attachShader(p, vs); gl.attachShader(p, fs);
  gl.linkProgram(p);
  gl.deleteShader(vs); gl.deleteShader(fs);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(p);
    gl.deleteProgram(p);
    throw new Error("link: " + log);
  }
  return p;
}

class GLSky {
  constructor(canvas) {
    const gl = canvas.getContext("webgl2", {
      alpha: false,           // the bottom layer: nothing shows through from under it
      antialias: false,       // the shapes feather themselves
      depth: false,
      stencil: false,
      powerPreference: "low-power"
    });
    if (!gl) throw new Error("no webgl2");
    this.canvas = canvas;
    this.gl = gl;
    this.lost = false;
    this.dpr = 1;

    canvas.addEventListener("webglcontextlost", (e) => {
      // A lost context is not an error to throw at the viewer: mark it dead and
      // let the scene fall back to painting the sky itself on the next frame.
      e.preventDefault();
      this.lost = true;
    });

    this.skyProg = link(gl, VERT_SKY, FRAG_SKY);
    this.sprProg = link(gl, VERT_SPRITE, FRAG_SPRITE);
    this.uTop = gl.getUniformLocation(this.skyProg, "u_top");
    this.uMid = gl.getUniformLocation(this.skyProg, "u_mid");
    this.uBot = gl.getUniformLocation(this.skyProg, "u_bot");
    this.uStops = gl.getUniformLocation(this.skyProg, "u_stops");
    this.uRes = gl.getUniformLocation(this.sprProg, "u_res");

    this.quad = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, 1,1]), gl.STATIC_DRAW);

    this.cap = 512;
    this.data = new Float32Array(this.cap * FLOATS);
    this.n = 0;
    this.inst = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.inst);
    gl.bufferData(gl.ARRAY_BUFFER, this.data.byteLength, gl.DYNAMIC_DRAW);

    this.vaoSky = gl.createVertexArray();
    gl.bindVertexArray(this.vaoSky);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    const cs = gl.getAttribLocation(this.skyProg, "a_corner");
    gl.enableVertexAttribArray(cs);
    gl.vertexAttribPointer(cs, 2, gl.FLOAT, false, 0, 0);

    this.vaoSpr = gl.createVertexArray();
    gl.bindVertexArray(this.vaoSpr);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    const cp = gl.getAttribLocation(this.sprProg, "a_corner");
    gl.enableVertexAttribArray(cp);
    gl.vertexAttribPointer(cp, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.inst);
    const stride = FLOATS * 4;
    const attr = (name, size, off) => {
      const l = gl.getAttribLocation(this.sprProg, name);
      gl.enableVertexAttribArray(l);
      gl.vertexAttribPointer(l, size, gl.FLOAT, false, stride, off);
      gl.vertexAttribDivisor(l, 1);
    };
    attr("a_rect", 4, 0);
    attr("a_misc", 2, 16);
    attr("a_color", 4, 24);
    gl.bindVertexArray(null);

    gl.disable(gl.DEPTH_TEST);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    /* Colours arrive as the "r,g,b" strings the theme tokens are written in.
       Splitting one is cheap but not free, and it would happen for every glow
       of every frame, so each string is parsed once and remembered. */
    this._rgb = new Map();
  }

  get ok() { return !this.lost; }

  parse(str) {
    let v = this._rgb.get(str);
    if (!v) {
      const p = str.split(",");
      v = [(+p[0] || 0)/255, (+p[1] || 0)/255, (+p[2] || 0)/255];
      this._rgb.set(str, v);
    }
    return v;
  }

  resize(w, h, dpr) {
    this.dpr = dpr;
    const dw = Math.max(1, Math.round(w * dpr)), dh = Math.max(1, Math.round(h * dpr));
    if (this.canvas.width !== dw || this.canvas.height !== dh) {
      this.canvas.width = dw; this.canvas.height = dh;
    }
  }

  begin(w, h, dpr) {
    this.resize(w, h, dpr);
    this.n = 0;
  }

  push(kind, r, g, b, a, cx, cy, hx, hy, rot) {
    if (a <= 0.002 || hx <= 0 || hy <= 0) return;
    if (this.n >= this.cap) {
      // Grow rather than drop: a frame that silently loses its stars would be
      // a very confusing thing to debug.
      this.cap *= 2;
      const bigger = new Float32Array(this.cap * FLOATS);
      bigger.set(this.data);
      this.data = bigger;
      this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.inst);
      this.gl.bufferData(this.gl.ARRAY_BUFFER, this.data.byteLength, this.gl.DYNAMIC_DRAW);
    }
    const d = this.data, i = this.n * FLOATS, s = this.dpr;
    d[i]   = cx * s; d[i+1] = cy * s; d[i+2] = hx * s; d[i+3] = hy * s;
    d[i+4] = rot;    d[i+5] = kind;
    d[i+6] = r;      d[i+7] = g;      d[i+8] = b;      d[i+9] = a;
    this.n++;
  }

  sky(top, mid, bot, stops) {
    this._top = top; this._mid = mid; this._bot = bot; this._stops = stops;
  }

  glow(rgbStr, x, y, rx, ry, a) {
    const c = this.parse(rgbStr);
    this.push(GLOW, c[0], c[1], c[2], a, x, y, rx, ry, 0);
  }

  disc(col, x, y, r, a) {
    this.push(DISC, col[0]/255, col[1]/255, col[2]/255, a, x, y, r, r, 0);
  }

  rect(rgbStr, x, y, w, h, a) {
    const c = this.parse(rgbStr);
    // Canvas fillRect is anchored at its top-left corner; a quad is centred.
    this.push(RECT, c[0], c[1], c[2], a, x + w/2, y + h/2, w/2, h/2, 0);
  }

  seg(rgbStr, x0, y0, x1, y1, lw, a) {
    const dx = x1 - x0, dy = y1 - y0;
    const len = Math.hypot(dx, dy);
    if (len < 0.01) return;
    const c = this.parse(rgbStr);
    this.push(RECT, c[0], c[1], c[2], a,
      (x0 + x1)/2, (y0 + y1)/2, len/2, lw/2, Math.atan2(dy, dx));
  }

  end() {
    const gl = this.gl;
    if (this.lost) return;
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);

    gl.disable(gl.BLEND);
    gl.useProgram(this.skyProg);
    const t = this._top, m = this._mid, b = this._bot, s = this._stops;
    gl.uniform3f(this.uTop, t[0]/255, t[1]/255, t[2]/255);
    gl.uniform3f(this.uMid, m[0]/255, m[1]/255, m[2]/255);
    gl.uniform3f(this.uBot, b[0]/255, b[1]/255, b[2]/255);
    gl.uniform2f(this.uStops, s[0], s[1]);
    gl.bindVertexArray(this.vaoSky);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    if (this.n) {
      gl.enable(gl.BLEND);
      gl.useProgram(this.sprProg);
      gl.uniform2f(this.uRes, this.canvas.width, this.canvas.height);
      gl.bindVertexArray(this.vaoSpr);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.inst);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.data, 0, this.n * FLOATS);
      /* One instanced call for stars, glows, discs and meteors together. The
         order they were pushed in is the order they blend in — primitives
         within a draw are processed in submission order — which is what lets
         the moon's dark bite land on top of the moon. */
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, this.n);
    }
    gl.bindVertexArray(null);
  }
}

/* The same vocabulary, painted straight onto the 2D context in the place it
   always occupied. This is what runs when there is no WebGL2, and what the
   scene falls back to if the context is lost mid-session. */
class Canvas2DSky {
  constructor(scene) { this.scene = scene; }
  get ok() { return true; }
  begin() { this.c = this.scene.ctx; this.W = this.scene.W; this.H = this.scene.H; }

  sky(top, mid, bot, stops) {
    const c = this.c, s = this.scene;
    const key = (top[0]|0)+","+(top[1]|0)+","+(top[2]|0)+"|"
              + (mid[0]|0)+","+(mid[1]|0)+","+(mid[2]|0)+"|"
              + (bot[0]|0)+","+(bot[1]|0)+","+(bot[2]|0)+"|"
              + stops[0].toFixed(3)+","+stops[1].toFixed(3)+"|"+(this.H|0);
    if (key !== s._skyKey) {
      const g = c.createLinearGradient(0, 0, 0, this.H);
      g.addColorStop(0, `rgb(${top[0]|0},${top[1]|0},${top[2]|0})`);
      g.addColorStop(Math.min(0.999, stops[0]), `rgb(${mid[0]|0},${mid[1]|0},${mid[2]|0})`);
      g.addColorStop(Math.min(1, stops[1]), `rgb(${bot[0]|0},${bot[1]|0},${bot[2]|0})`);
      if (stops[1] < 1) g.addColorStop(1, `rgb(${bot[0]|0},${bot[1]|0},${bot[2]|0})`);
      s._skyGrad = g; s._skyKey = key;
    }
    c.fillStyle = s._skyGrad;
    c.fillRect(0, 0, this.W, this.H);
  }

  glow(rgbStr, x, y, rx, ry, a) {
    this.scene.drawGlow(this.c, rgbStr, x, y, rx, ry, a);
  }

  disc(col, x, y, r, a) {
    const c = this.c;
    c.fillStyle = `rgba(${col[0]|0},${col[1]|0},${col[2]|0},${a})`;
    c.beginPath(); c.arc(x, y, r, 0, Math.PI*2); c.fill();
  }

  rect(rgbStr, x, y, w, h, a) {
    const c = this.c;
    c.globalAlpha = a;
    c.fillStyle = `rgb(${rgbStr})`;
    c.fillRect(x, y, w, h);
    c.globalAlpha = 1;
  }

  seg(rgbStr, x0, y0, x1, y1, lw, a) {
    const c = this.c;
    c.strokeStyle = `rgba(${rgbStr}, ${a})`;
    c.lineWidth = lw;
    c.beginPath(); c.moveTo(x0, y0); c.lineTo(x1, y1); c.stroke();
  }

  end() {}
}

/* Prefer the GPU, but never at the cost of the piece running at all. */
function makeSkyPainter(glCanvas, scene) {
  if (glCanvas) {
    try { return new GLSky(glCanvas); }
    catch (e) { console.warn("sky: falling back to canvas —", e.message); }
  }
  return new Canvas2DSky(scene);
}

export { Canvas2DSky, makeSkyPainter };
