/**
 * engine/state_manager.js
 * Gerenciador de estado central da aplicação (padrão Observer)
 */

import { clonePatch, createEffect } from './patch_codec.js';
import { buildInitialPatchBank }    from '../data/default_patches.js';
import { getFxDSP }                 from '../data/effects_catalog.js';

class StateManager extends EventTarget {
  constructor() {
    super();
    this._patches       = buildInitialPatchBank();
    this._currentPatch  = 0;
    this._selectedSlot  = null;
    this._isInteracting = false; // Flag para segurar auto-sync
    this._midi = { connected: false, portName: '', input: null, output: null };
    this._undoStack = {};
  }

  get patches()       { return this._patches; }
  get currentIndex()  { return this._currentPatch; }
  get currentPatch()  { return this._patches[this._currentPatch]; }
  get selectedSlot()  { return this._selectedSlot; }
  get midi()          { return this._midi; }
  get isInteracting() { return this._isInteracting; }

  // Retorna a % atual de uso da CPU (DSP) dos pedais deste patch
  get currentDSP() {
    return this.currentPatch.effects.reduce((acc, fx) => acc + (fx ? getFxDSP(fx.name) : 0), 0);
  }

  setInteracting(val) {
    this._isInteracting = val;
  }

  loadPatchBank(patches) {
    this._patches = patches;
    this._currentPatch = 0;
    this._selectedSlot = null;
    this._emit('state:patch-bank-loaded', { patches });
    this._emit('state:patch-changed', { patchIndex: 0, patch: this.currentPatch });
  }

  setPatch(idx, patch) {
    this._saveUndo(idx);
    this._patches[idx] = patch;
    this._emit('state:patch-changed', { patchIndex: idx, patch });
  }

  selectPatch(idx) {
    if (idx < 0 || idx >= this._patches.length) return;
    this._currentPatch = idx;
    this._selectedSlot = null;
    this._emit('state:patch-changed', { patchIndex: idx, patch: this.currentPatch });
  }

  renamePatch(name) {
    const patch = this.currentPatch;
    this._saveUndo(this._currentPatch);
    patch.name  = name.toUpperCase().substring(0, 10);
    patch.dirty = true;
    this._emit('state:patch-changed', { patchIndex: this._currentPatch, patch });
  }

  selectSlot(slotIndex) {
    this._selectedSlot = (this._selectedSlot === slotIndex) ? null : slotIndex;
    this._emit('state:slot-selected', { slotIndex: this._selectedSlot });
  }

  addEffect(slotIndex, fxName) {
    const patch = this.currentPatch;
    this._saveUndo(this._currentPatch);
    patch.effects[slotIndex] = createEffect(fxName, true);
    patch.dirty = true;
    this._emit('state:fx-added', { patchIndex: this._currentPatch, slotIndex, fxName });
    this._emit('state:patch-changed', { patchIndex: this._currentPatch, patch });
  }

  removeEffect(slotIndex) {
    const patch = this.currentPatch;
    this._saveUndo(this._currentPatch);
    patch.effects[slotIndex] = null;
    patch.dirty = true;
    if (this._selectedSlot === slotIndex) this._selectedSlot = null;
    this._emit('state:fx-removed', { patchIndex: this._currentPatch, slotIndex });
    this._emit('state:patch-changed', { patchIndex: this._currentPatch, patch });
  }

  toggleEffect(slotIndex) {
    const fx = this.currentPatch.effects[slotIndex];
    if (!fx) return;
    this._saveUndo(this._currentPatch);
    fx.on = !fx.on;
    this.currentPatch.dirty = true;
    this._emit('state:fx-toggled', { patchIndex: this._currentPatch, slotIndex, on: fx.on });
  }

  /**
   * Reordena slots na cadeia (comportamento de Shift/Insert)
   * Agora arranca o pedal de um slot e empurra os outros para abrir espaço
   */
  reorderEffects(fromSlot, toSlot) {
    if (fromSlot === toSlot) return;
    const patch = this.currentPatch;
    this._saveUndo(this._currentPatch);
    
    const movedItem = patch.effects.splice(fromSlot, 1)[0];
    patch.effects.splice(toSlot, 0, movedItem);
    
    patch.dirty = true;
    this._emit('state:fx-reordered', { patchIndex: this._currentPatch, fromSlot, toSlot });
    this._emit('state:patch-changed', { patchIndex: this._currentPatch, patch });
  }

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

  setMidiStatus(connected, portName = '', input = null, output = null) {
    this._midi = { connected, portName, input, output };
    this._emit('state:midi-status', { connected, portName });
  }

  undo() {
    const stack = this._undoStack[this._currentPatch];
    if (!stack || stack.length === 0) return;
    this._patches[this._currentPatch] = stack.pop();
    this._emit('state:patch-changed', {
      patchIndex: this._currentPatch,
      patch: this.currentPatch,
    });
  }

  _saveUndo(idx) {
    if (!this._undoStack[idx]) this._undoStack[idx] = [];
    const stack = this._undoStack[idx];
    stack.push(clonePatch(this._patches[idx]));
    if (stack.length > 20) stack.shift();
  }

  _emit(eventName, detail) {
    this.dispatchEvent(new CustomEvent(eventName, { detail }));
  }
}

export const state = new StateManager();