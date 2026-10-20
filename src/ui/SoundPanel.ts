import type { AudioSystem } from '../audio/AudioSystem';
import { BUS_IDS, BUS_LABELS, type BusId } from '../audio/mixer';
import { paintSlider } from './slider';

/** Mixer sliders and radio controls, added to the overlay once audio is ready. */
export function createSoundPanel(audio: AudioSystem): DocumentFragment {
  const { engine, radio } = audio;
  const template = document.createElement('template');
  template.innerHTML = `
    <details class="group" data-section="sound" open>
      <summary class="group__label">Sound</summary>
      <button type="button" class="btn btn--accent" data-action="enable-sound">Tap to turn sound on</button>
      <div class="list">
        ${BUS_IDS.map(
          (bus) => `
          <label class="list__row mixer__row">
            <span class="mixer__label">${BUS_LABELS[bus]}</span>
            <input type="range" class="slider" min="0" max="100" step="1" data-bus="${bus}" aria-label="${BUS_LABELS[bus]} volume" />
            <span class="mixer__value" data-bus-value="${bus}"></span>
          </label>`,
        ).join('')}
        <button type="button" class="list__row" role="switch" data-action="mute" aria-keyshortcuts="M"><span>Mute</span><span class="switch" aria-hidden="true"></span></button>
      </div>
    </details>
    <details class="group" data-section="radio" open>
      <summary class="group__label">Radio</summary>
      <div class="list">
        <button type="button" class="list__row" role="switch" data-action="radio" aria-keyshortcuts="R"><span>Radio <small data-radio-title aria-live="polite"></small></span><span class="switch" aria-hidden="true"></span></button>
        <div class="list__row">
          <form class="radio__tune" data-radio-form>
            <input type="url" class="field" placeholder="Stream URL (optional)" aria-label="Internet radio stream URL" data-radio-url />
            <button type="submit" class="text-btn">Tune</button>
            <button type="button" class="text-btn" data-action="radio-next">Next</button>
          </form>
        </div>
      </div>
    </details>
  `;
  const fragment = template.content;
  const q = <T extends HTMLElement>(selector: string) => {
    const el = fragment.querySelector<T>(selector);
    if (!el) throw new Error(`Sound panel element missing: ${selector}`);
    return el;
  };

  const enableButton = q<HTMLButtonElement>('[data-action="enable-sound"]');
  const muteButton = q<HTMLButtonElement>('[data-action="mute"]');
  const radioButton = q<HTMLButtonElement>('[data-action="radio"]');
  const nextButton = q<HTMLButtonElement>('[data-action="radio-next"]');
  const radioTitle = q<HTMLElement>('[data-radio-title]');
  const radioForm = q<HTMLFormElement>('[data-radio-form]');
  const radioUrl = q<HTMLInputElement>('[data-radio-url]');
  const sliders = [...fragment.querySelectorAll<HTMLInputElement>('[data-bus]')];
  const values = new Map(
    [...fragment.querySelectorAll<HTMLElement>('[data-bus-value]')].map((el) => [el.dataset.busValue as BusId, el]),
  );

  const refreshState = () => {
    enableButton.hidden = engine.ready;
  };
  const refreshVolumes = () => {
    for (const slider of sliders) {
      const bus = slider.dataset.bus as BusId;
      const percent = Math.round(engine.volume(bus) * 100);
      slider.value = String(percent);
      paintSlider(slider);
      values.get(bus)!.textContent = String(percent);
    }
    muteButton.setAttribute('aria-checked', String(engine.muted));
  };
  const refreshRadio = () => {
    radioButton.setAttribute('aria-checked', String(radio.isOn));
    nextButton.disabled = !radio.isOn;
    radioTitle.textContent = radio.isOn ? radio.title : '';
    if (document.activeElement !== radioUrl) radioUrl.value = radio.streamUrl;
  };

  enableButton.addEventListener('click', () => void engine.unlock());
  muteButton.addEventListener('click', () => engine.setMuted(!engine.muted));
  for (const slider of sliders) {
    slider.addEventListener('input', () => {
      paintSlider(slider);
      engine.setVolume(slider.dataset.bus as BusId, Number(slider.value) / 100);
    });
  }
  radioButton.addEventListener('click', () => {
    void engine.unlock().then(() => radio.toggle());
  });
  nextButton.addEventListener('click', () => radio.next());
  radioForm.addEventListener('submit', (event) => {
    event.preventDefault();
    radio.setStreamUrl(radioUrl.value);
    if (!radio.isOn) void engine.unlock().then(() => radio.setOn(true));
  });

  engine.on('state', refreshState);
  engine.on('volume', refreshVolumes);
  engine.on('mute', refreshVolumes);
  radio.on('change', refreshRadio);
  refreshState();
  refreshVolumes();
  refreshRadio();
  return fragment;
}
