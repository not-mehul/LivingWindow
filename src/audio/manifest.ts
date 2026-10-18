import type { SoundId } from './sounds/SoundBank';

/**
 * `public/audio/manifest.json` lists optional recordings. Anything listed
 * replaces its synthesized stand-in; anything missing keeps the synth.
 */
export interface AudioManifest {
  /** One-shot variants per sound id, e.g. "sparrow-chirp": ["audio/birds/sparrow-1.ogg"]. */
  sounds?: Partial<Record<SoundId, string[]>>;
  /** Looping ambience beds: weather layers and one per landscape. */
  beds?: { rain?: string; wind?: string; city?: string; meadows?: string; beach?: string; forest?: string };
  thunder?: string[];
  radio?: {
    /** Local tracks for the radio, played in shuffled order. */
    playlist?: string[];
    /** Default internet radio stream (the user can override it in the UI). */
    stream?: string;
  };
}

export async function loadManifest(url = 'audio/manifest.json'): Promise<AudioManifest> {
  try {
    const response = await fetch(url, { cache: 'no-cache' });
    if (!response.ok) return {};
    return (await response.json()) as AudioManifest;
  } catch {
    return {};
  }
}

/** Fetch and decode audio files, skipping any that fail. */
export async function decodeAll(context: BaseAudioContext, urls: readonly string[] = []): Promise<AudioBuffer[]> {
  const results = await Promise.all(
    urls.map(async (url) => {
      try {
        const response = await fetch(url);
        if (!response.ok) return null;
        return await context.decodeAudioData(await response.arrayBuffer());
      } catch {
        console.warn(`[audio] could not load ${url}`);
        return null;
      }
    }),
  );
  return results.filter((b): b is AudioBuffer => b !== null);
}

export function shuffle<T>(items: readonly T[], rng: () => number = Math.random): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}
