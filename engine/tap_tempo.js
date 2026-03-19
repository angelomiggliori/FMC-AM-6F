/**
 * engine/tap_tempo.js
 * Calculadora de Tap Tempo com média móvel e detecção de reset
 *
 * Uso:
 *   import { TapTempo } from './tap_tempo.js';
 *   const tap = new TapTempo();
 *   tap.onTap(); // chame a cada toque do usuário
 *   console.log(tap.bpm);     // BPM calculado
 *   console.log(tap.toMidi()); // valor 0–127 mapeado para o parâmetro
 */

/** BPM mínimo reconhecido como Tap Tempo */
const BPM_MIN = 40;

/** BPM máximo reconhecido como Tap Tempo */
const BPM_MAX = 300;

/** Janela máxima de taps para calcular média (últimos N intervalos) */
const TAP_WINDOW = 8;

/** Tempo máximo entre taps antes de resetar a sequência (ms) */
const TAP_RESET_MS = 3000;

export class TapTempo {
  constructor() {
    this._times  = [];   // timestamps dos taps
    this._bpm    = 120;
  }

  /** BPM calculado atual */
  get bpm() { return this._bpm; }

  /**
   * Registra um tap e recalcula o BPM.
   * @returns {number} BPM calculado após este tap
   */
  onTap() {
    const now = Date.now();

    // Reset se ficou muito tempo sem tap
    if (this._times.length > 0 && now - this._times[this._times.length - 1] > TAP_RESET_MS) {
      this._times = [];
    }

    this._times.push(now);

    // Manter janela de N taps
    if (this._times.length > TAP_WINDOW + 1) {
      this._times.shift();
    }

    // Precisamos de ao menos 2 taps para calcular intervalo
    if (this._times.length >= 2) {
      const intervals = [];
      for (let i = 1; i < this._times.length; i++) {
        intervals.push(this._times[i] - this._times[i - 1]);
      }
      const avgInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length;
      this._bpm = Math.round(60000 / avgInterval);
      this._bpm = Math.min(BPM_MAX, Math.max(BPM_MIN, this._bpm));
    }

    return this._bpm;
  }

  /**
   * Converte BPM atual para valor MIDI 0–127 linear.
   * Mapeamento: BPM_MIN → 0, BPM_MAX → 127
   * @returns {number} 0–127
   */
  toMidi() {
    return Math.round((this._bpm - BPM_MIN) / (BPM_MAX - BPM_MIN) * 127);
  }

  /**
   * Converte um valor MIDI 0–127 de volta para BPM.
   * @param {number} midiVal
   * @returns {number} BPM
   */
  static fromMidi(midiVal) {
    return Math.round(BPM_MIN + (midiVal / 127) * (BPM_MAX - BPM_MIN));
  }

  /** Reseta o histórico de taps */
  reset() {
    this._times = [];
    this._bpm   = 120;
  }
}
