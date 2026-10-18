import { Emitter } from './Emitter';

const STORAGE_KEY = 'livingWindow.wakeLock';

interface WakeLockSentinelLike {
  released: boolean;
  release(): Promise<void>;
  addEventListener(type: 'release', listener: () => void): void;
}

/**
 * Optionally keeps the screen from dimming while Living Window is showing,
 * so a tablet or spare monitor can sit as an ambient window. The browser
 * drops the lock when the tab is hidden; it is taken again on return.
 */
export class ScreenWakeLock extends Emitter<{ change: { enabled: boolean; active: boolean } }> {
  readonly supported = typeof navigator !== 'undefined' && 'wakeLock' in navigator;
  private sentinel: WakeLockSentinelLike | null = null;
  private _enabled = false;

  constructor() {
    super();
    try {
      this._enabled = this.supported && localStorage.getItem(STORAGE_KEY) === 'on';
    } catch {
      this._enabled = false;
    }
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && this._enabled) void this.acquire();
    });
    // Requests need a visible page and often a user gesture, so try on the first one too.
    window.addEventListener('pointerdown', () => this._enabled && !this.active && void this.acquire(), { passive: true });
    if (this._enabled) void this.acquire();
  }

  get enabled(): boolean {
    return this._enabled;
  }

  get active(): boolean {
    return !!this.sentinel && !this.sentinel.released;
  }

  setEnabled(enabled: boolean): void {
    if (!this.supported) return;
    this._enabled = enabled;
    try {
      localStorage.setItem(STORAGE_KEY, enabled ? 'on' : 'off');
    } catch {
      // Not persisted.
    }
    if (enabled) void this.acquire();
    else void this.release();
    this.notify();
  }

  private async acquire(): Promise<void> {
    if (!this.supported || this.active || document.visibilityState !== 'visible') return;
    try {
      const wakeLock = (navigator as Navigator & { wakeLock: { request(type: 'screen'): Promise<WakeLockSentinelLike> } }).wakeLock;
      this.sentinel = await wakeLock.request('screen');
      this.sentinel.addEventListener('release', () => this.notify());
    } catch {
      // Refused (battery saver, no gesture yet): try again on the next tap.
      this.sentinel = null;
    }
    this.notify();
  }

  private async release(): Promise<void> {
    const sentinel = this.sentinel;
    this.sentinel = null;
    await sentinel?.release().catch(() => undefined);
    this.notify();
  }

  private notify(): void {
    this.emit('change', { enabled: this._enabled, active: this.active });
  }
}
