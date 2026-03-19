/**
 * ui/sysex_log.js
 * Monitor de tráfego SysEx/MIDI em tempo real
 */

import { getSetting } from '../storage/settings_storage.js';

class SysexLog {
  constructor() {
    this._open    = false;
    this._entries = [];
  }

  /** @returns {HTMLElement} */
  _body() { return document.getElementById('sysexLogBody'); }

  /**
   * Adiciona entrada ao log.
   * @param {'TX'|'RX'} direction
   * @param {number[]}  bytes
   */
  addEntry(direction, bytes) {
    const ts  = new Date().toLocaleTimeString('pt-BR', { hour12: false });
    const hex = Array.from(bytes)
      .map(b => b.toString(16).padStart(2, '0').toUpperCase())
      .join(' ');

    const entry = { ts, direction, hex };
    this._entries.push(entry);

    const max = getSetting('sysexLogMaxLines') || 200;
    if (this._entries.length > max) this._entries.shift();

    this._appendToDOM(entry);
  }

  /** @private */
  _appendToDOM(entry) {
    const body = this._body();
    if (!body) return;

    const el       = document.createElement('div');
    el.className   = 'log-entry';
    const dirClass = entry.direction === 'TX' ? 'dir-tx' : 'dir-rx';
    el.innerHTML   = `
      <span class="ts">${entry.ts}</span>
      <span class="${dirClass}">${entry.direction}</span>
      <span class="bytes">${entry.hex}</span>`;
    body.appendChild(el);
    body.scrollTop = body.scrollHeight;
  }

  toggle() {
    this._open = !this._open;
    document.getElementById('sysexLog')?.classList.toggle('open', this._open);
  }

  clear() {
    this._entries = [];
    const body    = this._body();
    if (body) body.innerHTML = '';
  }
}

export const sysexLog = new SysexLog();
