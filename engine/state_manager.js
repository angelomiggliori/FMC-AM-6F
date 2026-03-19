/**
 * engine/state_manager.js
 * Gerenciador de estado central da aplicação (padrão Observer)
 *
 * Único ponto de mutação do estado. Todos os módulos de UI
 * leem daqui e escutam os eventos emitidos aqui.
 *
 * Eventos emitidos via CustomEvent no document:
 *   'state:patch-changed'     { patchIndex, patch }
 *   'state:slot-selected'     { slotIndex }
 *   'state:param-changed'     { patchIndex, slotIndex, paramIndex, value }
 *   'state:fx-toggled'        { patchIndex, slotIndex, on }
 *   'state:fx-added'          { patchIndex, slotIndex, fxName }
 *   'state:fx-removed'        { patchIndex, slotIndex }
 *   'state:fx-reordered'      { patchIndex, fromSlot, toSlot }
 *   'state:patch-bank-loaded' { patches }
 *   'state:midi-status'       { connected, portName }
 */

import { clonePatch, createEffect } from './patch_codec.js';
import { buildInitialPatchBank }    from '../data/default_patches.js';

class StateManager extends EventTarget {
  constructor() {
    super();

    this._patches       = buildInitialPatchBank();
    this._currentPatch  = 0;
    this._selectedSlot  = null;

    this._midi = {
      connected:  false,
      portName:   '',
      input:      null,
      output:     null,
    };

    // Histórico de undo por patch (máx 20 snapshots por patch)
    this._undoStack = {};
  }

  // ── Getters ────────────────────────────────────────────────────────────────

  get patches()       { return this._patches; }
  get currentIndex()  { return this._currentPatch; }
  get currentPatch()  { return this._patches[this._currentPatch]; }
  get selectedSlot()  { return this._selectedSlot; }
  get midi()          { return this._midi; }

  // ── Patch Bank ─────────────────────────────────────────────────────────────

  /**
   * Substitui o banco completo de patches (ex: após load do LittleFS).
   * @param {Object[]} patches
   */
  loadPatchBank(patches) {
    this._patches = patches;
    this._currentPatch = 0;
    this._selectedSlot = null;
    this._emit('state:patch-bank-loaded', { patches });
    this._emit('state:patch-changed', { patchIndex: 0, patch: this.currentPatch });
  }

  /**
   * Atualiza um único patch no banco (ex: após receber dump da pedaleira).
   * @param {number} idx
   * @param {Object} patch
   */
  setPatch(idx, patch) {
    this._saveUndo(idx);
    this._patches[idx] = patch;
    this._emit('state:patch-changed', { patchIndex: idx, patch });
  }

  /**
   * Torna o patch `idx` o atual e notifica a UI.
   * @param {number} idx
   */
  selectPatch(idx) {
    if (idx < 0 || idx >= this._patches.length) return;
    this._currentPatch = idx;
    this._selectedSlot = null;
    this._emit('state:patch-changed', { patchIndex: idx, patch: this.currentPatch });
  }

  /**
   * Renomeia o patch atual.
   * @param {string} name
   */
  renamePatch(name) {
    const patch = this.currentPatch;
    this._saveUndo(this._currentPatch);
    patch.name  = name.toUpperCase().substring(0, 10);
    patch.dirty = true;
    this._emit('state:patch-changed', { patchIndex: this._currentPatch, patch });
  }

  // ── Slot Selection ─────────────────────────────────────────────────────────

  /**
   * Seleciona (ou deseleciona) um slot de efeito na cadeia.
   * @param {number|null} slotIndex
   */
  selectSlot(slotIndex) {
    this._selectedSlot = (this._selectedSlot === slotIndex) ? null : slotIndex;
    this._emit('state:slot-selected', { slotIndex: this._selectedSlot });
  }

  // ── Effect Operations ──────────────────────────────────────────────────────

  /**
   * Adiciona (ou substitui) efeito em um slot.
   * @param {number} slotIndex
   * @param {string} fxName
   */
  addEffect(slotIndex, fxName) {
    const patch = this.currentPatch;
    this._saveUndo(this._currentPatch);
    patch.effects[slotIndex] = createEffect(fxName, true);
    patch.dirty = true;
    this._emit('state:fx-added', { patchIndex: this._currentPatch, slotIndex, fxName });
    this._emit('state:patch-changed', { patchIndex: this._currentPatch, patch });
  }

  /**
   * Remove efeito de um slot (torna null).
   * @param {number} slotIndex
   */
  removeEffect(slotIndex) {
    const patch = this.currentPatch;
    this._saveUndo(this._currentPatch);
    patch.effects[slotIndex] = null;
    patch.dirty = true;
    if (this._selectedSlot === slotIndex) this._selectedSlot = null;
    this._emit('state:fx-removed', { patchIndex: this._currentPatch, slotIndex });
    this._emit('state:patch-changed', { patchIndex: this._currentPatch, patch });
  }

  /**
   * Liga/desliga efeito em um slot.
   * @param {number} slotIndex
   */
  toggleEffect(slotIndex) {
    const fx = this.currentPatch.effects[slotIndex];
    if (!fx) return;
    this._saveUndo(this._currentPatch);
    fx.on = !fx.on;
    this.currentPatch.dirty = true;
    this._emit('state:fx-toggled', { patchIndex: this._currentPatch, slotIndex, on: fx.on });
  }

  /**
   * Reordena dois slots na cadeia (swap).
   * @param {number} fromSlot
   * @param {number} toSlot
   */
  reorderEffects(fromSlot, toSlot) {
    const patch = this.currentPatch;
    this._saveUndo(this._currentPatch);
    const tmp               = patch.effects[fromSlot];
    patch.effects[fromSlot] = patch.effects[toSlot];
    patch.effects[toSlot]   = tmp;
    patch.dirty = true;
    this._emit('state:fx-reordered', { patchIndex: this._currentPatch, fromSlot, toSlot });
    this._emit('state:patch-changed', { patchIndex: this._currentPatch, patch });
  }

  // ── Parameter Operations ───────────────────────────────────────────────────

  /**
   * Atualiza valor de parâmetro de um efeito.
   * @param {number} slotIndex
   * @param {number} paramIndex
   * @param {number} value  0–127
   */
  setParam(slotIndex, paramIndex, value) {
    const fx = this.currentPatch.effects[slotIndex];
    if (!fx) return;
    fx.params[paramIndex] = Math.min(127, Math.max(0, value));
    this.currentPatch.dirty = true;
    this._emit('state:param-changed', {
      patchIndex:  this._currentPatch,
      slotIndex,
      paramIndex,
      value:       fx.params[paramIndex],
    });
  }

  // ── MIDI Status ────────────────────────────────────────────────────────────

  /**
   * Atualiza status da conexão MIDI.
   * @param {boolean} connected
   * @param {string}  portName
   * @param {MIDIInput}  input
   * @param {MIDIOutput} output
   */
  setMidiStatus(connected, portName = '', input = null, output = null) {
    this._midi = { connected, portName, input, output };
    this._emit('state:midi-status', { connected, portName });
  }

  // ── Undo ───────────────────────────────────────────────────────────────────

  /**
   * Desfaz a última operação do patch atual.
   */
  undo() {
    const stack = this._undoStack[this._currentPatch];
    if (!stack || stack.length === 0) return;
    this._patches[this._currentPatch] = stack.pop();
    this._emit('state:patch-changed', {
      patchIndex: this._currentPatch,
      patch: this.currentPatch,
    });
  }

  /** @private */
  _saveUndo(idx) {
    if (!this._undoStack[idx]) this._undoStack[idx] = [];
    const stack = this._undoStack[idx];
    stack.push(clonePatch(this._patches[idx]));
    if (stack.length > 20) stack.shift();
  }

  /** @private */
  _emit(eventName, detail) {
    this.dispatchEvent(new CustomEvent(eventName, { detail }));
  }
}

// Singleton exportado — toda a aplicação usa esta instância
export const state = new StateManager();
