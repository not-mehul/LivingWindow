/** The five user-facing volume buses. */
export type BusId = 'master' | 'wildlife' | 'weather' | 'ambience' | 'radio';

export const BUS_IDS: readonly BusId[] = ['master', 'wildlife', 'weather', 'ambience', 'radio'];

export const BUS_LABELS: Record<BusId, string> = {
  master: 'Master',
  wildlife: 'Wildlife & Birds',
  weather: 'Weather',
  ambience: 'Landscape',
  radio: 'Lofi Radio',
};

export const DEFAULT_VOLUMES: Readonly<Record<BusId, number>> = {
  master: 0.8,
  wildlife: 0.7,
  weather: 0.7,
  ambience: 0.6,
  radio: 0.55,
};

export interface AudioSettings {
  volumes: Record<BusId, number>;
  muted: boolean;
  radioOn: boolean;
  /** Optional Icecast / internet radio stream URL chosen by the user. */
  streamUrl: string;
}

export const DEFAULT_AUDIO_SETTINGS: Readonly<AudioSettings> = {
  volumes: { ...DEFAULT_VOLUMES },
  muted: false,
  radioOn: false,
  streamUrl: '',
};

const STORAGE_KEY = 'livingWindow.audio';

/** Slider position (0..1) to linear gain. Squared so the slider feels even to the ear. */
export function volumeToGain(volume: number): number {
  const v = Math.min(1, Math.max(0, volume));
  return v * v;
}

export function dbToGain(db: number): number {
  return 10 ** (db / 20);
}

function safeStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/** Load saved settings, falling back to defaults for anything missing or invalid. */
export function loadAudioSettings(storage: Storage | null = safeStorage()): AudioSettings {
  const settings: AudioSettings = {
    ...DEFAULT_AUDIO_SETTINGS,
    volumes: { ...DEFAULT_AUDIO_SETTINGS.volumes },
  };
  try {
    const raw = storage?.getItem(STORAGE_KEY);
    if (!raw) return settings;
    const parsed = JSON.parse(raw) as Partial<AudioSettings>;
    for (const id of BUS_IDS) {
      const v = parsed.volumes?.[id];
      if (typeof v === 'number' && Number.isFinite(v)) settings.volumes[id] = Math.min(1, Math.max(0, v));
    }
    if (typeof parsed.muted === 'boolean') settings.muted = parsed.muted;
    if (typeof parsed.radioOn === 'boolean') settings.radioOn = parsed.radioOn;
    if (typeof parsed.streamUrl === 'string') settings.streamUrl = parsed.streamUrl.trim();
  } catch {
    // Corrupt or inaccessible storage: defaults are fine.
  }
  return settings;
}

export function saveAudioSettings(settings: AudioSettings, storage: Storage | null = safeStorage()): void {
  try {
    storage?.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Private mode or quota: settings simply won't persist.
  }
}
