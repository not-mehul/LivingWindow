import { createReviewPage, type PageRow, type RowElements } from './reviewPage';
import { frameImage, frameSeconds, SPRITES, STILL_SECONDS, type SpriteEntry } from './spriteCatalog';

/**
 * A page for watching every sprite in the app animate, one animation per
 * row, and noting which are good and which need work. Each row plays its
 * frames at the rate the app does (walks also travel, so any foot slide
 * shows) with every frame laid out below; click the player to pause, a
 * frame to hold it. Open it with the dev server at /sprites.html.
 */

interface Row extends PageRow {
  entry: SpriteEntry;
}

interface Drawn {
  frames: HTMLCanvasElement[];
  width: number;
  height: number;
}

interface Player {
  variant: string;
  size: number;
  drawn: Drawn | null;
  frame: number;
  t: number;
  x: number;
  paused: boolean;
  visible: boolean;
  canvas: HTMLCanvasElement;
  strip: HTMLElement;
}

const BACKGROUNDS = { day: 'Day sky', night: 'Night sky', sill: 'Sill wood', checker: 'Checker' } as const;
type Background = keyof typeof BACKGROUNDS;
/** How far a walking sprite's stage reaches, in frame widths. */
const WALK_SPAN = 3.5;
/** The widest a player gets on a wide screen (CSS px). */
const MAX_STAGE_PX = 540;

function kindOf(entry: SpriteEntry): string {
  if (entry.seconds === STILL_SECONDS) return 'stills';
  if (typeof entry.seconds !== 'number') return 'timed frames';
  const fps = 1 / entry.seconds;
  return `${fps >= 10 ? Math.round(fps) : Math.round(fps * 10) / 10} fps`;
}

function sizeLabel(entry: SpriteEntry, size: number): string {
  return entry.sizeUnit === 'scale' ? `scale ${size}` : `${size} px`;
}

/** Draw an entry's frames into small canvases, each at the art's own size. */
function draw(entry: SpriteEntry, variant: string, size: number): Drawn {
  const frames = entry.frames(variant, size).map((frame) => {
    const image = frameImage(frame);
    const canvas = document.createElement('canvas');
    canvas.width = image.width;
    canvas.height = image.height;
    canvas.getContext('2d')?.putImageData(new ImageData(new Uint8ClampedArray(image.data), image.width, image.height), 0, 0);
    return canvas;
  });
  return { frames, width: Math.max(...frames.map((c) => c.width)), height: Math.max(...frames.map((c) => c.height)) };
}

function start(root: HTMLElement): void {
  const view = { zoom: 3, speed: 1, playing: true, background: 'day' as Background, night: false };
  const players = new Map<string, Player>();

  const rows: Row[] = SPRITES.map((entry) => ({
    entry,
    wide: true,
    item: { id: entry.id, label: entry.label, group: entry.group, kind: kindOf(entry) },
    detail: entry.detail,
  }));

  const byRow = new Map(rows.map((r) => [r.item.id, r.entry]));
  const observer = new IntersectionObserver(
    (seen) => {
      for (const s of seen) {
        const id = (s.target as HTMLElement).dataset.id ?? '';
        const player = players.get(id);
        const entry = byRow.get(id);
        if (!player || !entry) continue;
        player.visible = s.isIntersecting;
        if (player.visible && !player.drawn) load(player, entry);
      }
    },
    { rootMargin: '200px 0px' },
  );

  /** Paint the player's current frame: bottom-centred, or walked along its stage. */
  const paint = (player: Player, entry: SpriteEntry) => {
    const drawn = player.drawn;
    if (!drawn) return;
    const z = view.zoom;
    // A walk gets room to travel, as much as the row has.
    const room = Math.floor(Math.min(MAX_STAGE_PX, window.innerWidth - 56) / z);
    const stageWidth = entry.step ? Math.max(drawn.width, Math.min(Math.round(drawn.width * WALK_SPAN), room)) : drawn.width;
    const { canvas } = player;
    if (canvas.width !== stageWidth * z || canvas.height !== drawn.height * z) {
      canvas.width = stageWidth * z;
      canvas.height = drawn.height * z;
    }
    const ctx = canvas.getContext('2d')!;
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const frame = drawn.frames[player.frame % drawn.frames.length];
    const x = entry.step ? Math.round(player.x) % stageWidth : Math.round((drawn.width - frame.width) / 2);
    const y = drawn.height - frame.height;
    // A walker wraps round the stage: draw it again where it re-enters.
    for (const dx of entry.step ? [x - stageWidth, x] : [x]) ctx.drawImage(frame, dx * z, y * z, frame.width * z, frame.height * z);
    if (view.night) {
      // Moonlight, as the scenes tint their creatures: only the sprite's own pixels.
      ctx.globalCompositeOperation = 'source-atop';
      ctx.fillStyle = 'rgba(28, 40, 100, 0.55)';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.globalCompositeOperation = 'source-over';
    }
    player.strip.querySelectorAll('canvas').forEach((thumb, i) => thumb.classList.toggle('is-current', i === player.frame % drawn.frames.length));
  };

  /** (Re)draw a player's frames for its variant and size, and lay out its filmstrip. */
  const load = (player: Player, entry: SpriteEntry) => {
    player.drawn = draw(entry, player.variant, player.size);
    player.frame = 0;
    player.t = 0;
    player.x = 0;
    player.strip.textContent = '';
    const thumbScale = Math.max(1, Math.min(4, Math.floor(36 / player.drawn.height)));
    player.drawn.frames.forEach((frame, i) => {
      const thumb = document.createElement('canvas');
      thumb.width = frame.width;
      thumb.height = frame.height;
      thumb.getContext('2d')?.drawImage(frame, 0, 0);
      thumb.style.width = `${frame.width * thumbScale}px`;
      thumb.style.height = `${frame.height * thumbScale}px`;
      thumb.title = `Frame ${i + 1}`;
      thumb.addEventListener('click', () => {
        player.paused = true;
        player.frame = i;
        paint(player, entry);
        page.refresh();
      });
      player.strip.appendChild(thumb);
    });
    paint(player, entry);
  };

  const page = createReviewPage(root, {
    heading: 'Living Window · sprites',
    reportTitle: 'Sprite review',
    storageKey: 'livingWindow.spriteReview',
    noun: 'animations',
    rows,
    actions: '<button type="button" data-play-all>Pause all</button>',
    controlsLabel: 'Viewing',
    controls: `
      <label>Zoom <select data-zoom>${[2, 3, 4, 6, 8].map((z) => `<option value="${z}"${z === 3 ? ' selected' : ''}>${z}×</option>`).join('')}</select></label>
      <label>Speed <select data-speed>${[0.25, 0.5, 1, 2].map((s) => `<option value="${s}"${s === 1 ? ' selected' : ''}>${s}×</option>`).join('')}</select></label>
      <label>Behind <select data-background>${Object.entries(BACKGROUNDS).map(([k, label]) => `<option value="${k}">${label}</option>`).join('')}</select></label>
      <label><input type="checkbox" data-night /> Moonlit tint</label>`,
    footnote: 'Not here: what the scenes draw live each frame rather than as sprites (fireflies, fireworks, bees and dragonflies, eyes in the dark, the city’s window occupants, shadows), and the bending sway of plants and trees.',
    build: (row, el) => buildRow(row, el),
    update: (row, el) => {
      const player = players.get(row.entry.id);
      if (!player) return;
      el.row.classList.toggle('is-paused', player.paused || !view.playing);
      const toggle = el.extra.querySelector<HTMLButtonElement>('[data-toggle]');
      if (toggle) toggle.textContent = player.paused ? '▶' : '❚❚';
    },
  });

  function buildRow(row: Row, el: RowElements): void {
    const { entry } = row;
    el.lead.innerHTML = `<div class="sp-stage" data-bg="${view.background}"><canvas class="sp-player" title="Click to pause"></canvas></div><div class="sp-strip"></div>`;
    const player: Player = {
      variant: entry.variants[0],
      size: entry.sizes[0],
      drawn: null,
      frame: 0,
      t: 0,
      x: 0,
      paused: false,
      visible: false,
      canvas: el.lead.querySelector<HTMLCanvasElement>('.sp-player')!,
      strip: el.lead.querySelector<HTMLElement>('.sp-strip')!,
    };
    players.set(entry.id, player);
    player.canvas.setAttribute('aria-label', `${entry.label}, animated`);
    player.canvas.addEventListener('click', () => {
      player.paused = !player.paused;
      page.refresh();
    });

    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.dataset.toggle = '';
    toggle.setAttribute('aria-label', `Play or pause ${entry.label}`);
    toggle.addEventListener('click', () => {
      player.paused = !player.paused;
      page.refresh();
    });
    const step = document.createElement('button');
    step.type = 'button';
    step.textContent = '⏭';
    step.title = 'Next frame';
    step.setAttribute('aria-label', `Next frame of ${entry.label}`);
    step.addEventListener('click', () => {
      if (!player.drawn) return;
      player.paused = true;
      advance(player, entry);
      paint(player, entry);
      page.refresh();
    });
    el.extra.append(toggle, step);
    const select = (options: readonly (string | number)[], label: (o: string | number) => string, onChange: (value: string) => void) => {
      if (options.length < 2) return;
      const s = document.createElement('select');
      s.innerHTML = options.map((o) => `<option value="${o}">${label(o)}</option>`).join('');
      s.addEventListener('change', () => onChange(s.value));
      el.extra.appendChild(s);
    };
    select(entry.variants, (v) => String(v), (v) => {
      player.variant = v;
      load(player, entry);
    });
    select(entry.sizes, (s) => sizeLabel(entry, Number(s)), (s) => {
      player.size = Number(s);
      load(player, entry);
    });
    // Frames are drawn when the row first comes into view, so the page opens quickly.
    observer.observe(el.row);
  }

  /** Move on one frame (and, for a walk, one stride's worth of ground). */
  const advance = (player: Player, entry: SpriteEntry) => {
    const count = player.drawn?.frames.length ?? 1;
    player.frame = (player.frame + 1) % count;
    if (entry.step) player.x += entry.step * (entry.sizes[0] > 0 ? player.size / entry.sizes[0] : 1);
  };

  // One clock for every row on screen.
  let last = performance.now();
  const tick = (now: number) => {
    const dt = Math.min(0.25, (now - last) / 1000) * view.speed;
    last = now;
    if (view.playing) {
      for (const [id, player] of players) {
        if (!player.visible || player.paused || !player.drawn) continue;
        const entry = byRow.get(id)!;
        player.t += dt;
        let changed = false;
        for (let guard = 0; guard < 32 && player.t >= frameSeconds(entry, player.frame); guard++) {
          player.t -= frameSeconds(entry, player.frame);
          advance(player, entry);
          changed = true;
        }
        if (changed) paint(player, entry);
      }
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);

  const { $ } = page;
  const repaintAll = () => {
    for (const [id, player] of players) if (player.drawn) paint(player, byRow.get(id)!);
  };
  $<HTMLSelectElement>('[data-zoom]').addEventListener('change', (e) => {
    view.zoom = Number((e.target as HTMLSelectElement).value);
    repaintAll();
  });
  $<HTMLSelectElement>('[data-speed]').addEventListener('change', (e) => (view.speed = Number((e.target as HTMLSelectElement).value)));
  $<HTMLSelectElement>('[data-background]').addEventListener('change', (e) => {
    view.background = (e.target as HTMLSelectElement).value as Background;
    for (const stage of root.querySelectorAll<HTMLElement>('.sp-stage')) stage.dataset.bg = view.background;
  });
  $<HTMLInputElement>('[data-night]').addEventListener('change', (e) => {
    view.night = (e.target as HTMLInputElement).checked;
    repaintAll();
  });
  $('[data-play-all]').addEventListener('click', () => {
    view.playing = !view.playing;
    $('[data-play-all]').textContent = view.playing ? 'Pause all' : 'Play all';
    page.refresh();
  });
  page.refresh();
}

start(document.getElementById('sprites')!);
