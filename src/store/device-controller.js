/**
 * device-controller.js
 * High-level operations: read patches, write patches, backup, restore
 */

import { MidiManager } from '../midi/midi-manager.js';
import {
  buildReadPatch,
  buildWritePatch,
  buildReadCurrentPatch,
  buildProgramChange,
  buildMemoryUsageRequest,
  parsePatchResponse,
  bytesToHex,
} from '../protocol/zoom-protocol.js';

const PATCH_READ_DELAY_MS = 80; // time between consecutive patch reads

export class DeviceController extends EventTarget {
  #midi       = new MidiManager();
  #device     = null;
  #patches    = [];
  #isReading  = false;

  constructor() {
    super();
    // Forward MIDI events
    this.#midi.addEventListener('connected',    e => this.dispatchEvent(new CustomEvent('connected',    { detail: e.detail })));
    this.#midi.addEventListener('disconnected', e => this.dispatchEvent(new CustomEvent('disconnected', { detail: e.detail })));
    this.#midi.addEventListener('patchupdate',  e => this.#onPatchUpdate(e.detail));
    this.#midi.addEventListener('rawmessage',   e => this.dispatchEvent(new CustomEvent('rawmessage',   { detail: e.detail })));
  }

  get device()   { return this.#device; }
  get patches()  { return this.#patches; }
  get isReading(){ return this.#isReading; }

  // ── Connection ────────────────────────────────────────────────────────────

  async connect() {
    const info    = await this.#midi.connect();
    this.#device  = info;
    this.#patches = new Array(info.presets).fill(null);
    return info;
  }

  disconnect() {
    this.#midi.disconnect();
    this.#device  = null;
    this.#patches = [];
  }

  // ── Read Operations ───────────────────────────────────────────────────────

  /**
   * Read a single patch from the pedal
   * @param {number} slot  0-based
   * @returns {Promise<PatchData>}
   */
  async readPatch(slot) {
    this.#assertConnected();
    const msg   = buildReadPatch(this.#device.deviceId, slot);
    const reply = await this.#midi.send(msg, true);
    const patch = parsePatchResponse(reply);
    if (!patch) throw new Error(`Invalid patch response for slot ${slot}: ${bytesToHex(reply)}`);
    this.#patches[slot] = patch;
    this.dispatchEvent(new CustomEvent('patchread', { detail: { slot, patch } }));
    return patch;
  }

  /**
   * Read the current active patch from the edit buffer
   */
  async readCurrentPatch() {
    this.#assertConnected();
    const msg   = buildReadCurrentPatch(this.#device.deviceId);
    const reply = await this.#midi.send(msg, true);
    const patch = parsePatchResponse(reply);
    if (!patch) throw new Error(`Invalid current patch response: ${bytesToHex(reply)}`);
    return patch;
  }

  /**
   * Read ALL patches from the pedal sequentially
   * Emits 'progress' events with { current, total, patch }
   */
  async readAllPatches() {
    this.#assertConnected();
    if (this.#isReading) throw new Error('Already reading patches');

    this.#isReading = true;
    const total = this.#device.presets;

    try {
      for (let slot = 0; slot < total; slot++) {
        const patch = await this.readPatch(slot);
        this.dispatchEvent(new CustomEvent('progress', { detail: { current: slot + 1, total, patch } }));
        if (slot < total - 1) await delay(PATCH_READ_DELAY_MS);
      }
    } finally {
      this.#isReading = false;
    }

    this.dispatchEvent(new CustomEvent('allpatchesread', { detail: this.#patches }));
    return this.#patches;
  }

  // ── Write Operations ──────────────────────────────────────────────────────

  /**
   * Write a patch to a specific slot on the pedal
   * @param {number} slot
   * @param {PatchData} patch
   */
  async writePatch(slot, patch) {
    this.#assertConnected();
    const msg = buildWritePatch(this.#device.deviceId, slot, patch);
    await this.#midi.send(msg, true);
    this.#patches[slot] = { ...patch, slot };
    this.dispatchEvent(new CustomEvent('patchwritten', { detail: { slot, patch } }));
  }

  /**
   * Switch active preset on the pedal
   * @param {number} slot  0-based
   */
  async selectPreset(slot) {
    this.#assertConnected();
    await this.#midi.send(buildProgramChange(slot));
  }

  // ── Backup / Restore ──────────────────────────────────────────────────────

  /**
   * Export all patches as a JSON backup object
   * @returns {BackupFile}
   */
  exportBackup() {
    if (!this.#device) throw new Error('Not connected');
    return {
      version:   '1.0',
      timestamp: new Date().toISOString(),
      device: {
        key:      this.#device.deviceKey,
        name:     this.#device.name,
        deviceId: this.#device.deviceId,
        firmware: this.#device.firmware,
      },
      patches: this.#patches,
    };
  }

  /**
   * Save backup to a JSON file (triggers browser download)
   */
  downloadBackup() {
    const backup   = this.exportBackup();
    const json     = JSON.stringify(backup, null, 2);
    const blob     = new Blob([json], { type: 'application/json' });
    const url      = URL.createObjectURL(blob);
    const a        = document.createElement('a');
    const filename = `${this.#device.name.replace(/\s+/g, '_')}_backup_${datestamp()}.json`;
    a.href         = url;
    a.download     = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  /**
   * Restore patches from a backup file to the pedal
   * @param {BackupFile} backup
   * @param {object} options
   * @param {boolean} options.overwrite  If false, skips slots already filled
   */
  async restoreBackup(backup, { overwrite = true } = {}) {
    this.#assertConnected();

    if (backup.device.deviceId !== this.#device.deviceId) {
      throw new Error(
        `Backup is for ${backup.device.name} (ID=0x${backup.device.deviceId.toString(16).toUpperCase()}) ` +
        `but connected device is ${this.#device.name}. Restore aborted.`
      );
    }

    const total = backup.patches.length;
    for (let slot = 0; slot < total; slot++) {
      const patch = backup.patches[slot];
      if (!patch) continue;
      if (!overwrite && this.#patches[slot] !== null) continue;

      await this.writePatch(slot, patch);
      this.dispatchEvent(new CustomEvent('progress', { detail: { current: slot + 1, total, patch } }));
      await delay(PATCH_READ_DELAY_MS);
    }

    this.dispatchEvent(new CustomEvent('restorecomplete'));
  }

  /**
   * Parse a backup JSON file (from FileReader)
   * @param {string} jsonString
   * @returns {BackupFile}
   */
  static parseBackupFile(jsonString) {
    const backup = JSON.parse(jsonString);
    if (!backup.version || !backup.device || !backup.patches) {
      throw new Error('Invalid backup file format');
    }
    return backup;
  }

  // ── Private ───────────────────────────────────────────────────────────────

  #assertConnected() {
    if (!this.#midi.connected) throw new Error('Not connected to any device');
  }

  #onPatchUpdate(patch) {
    if (patch.slot >= 0 && patch.slot < this.#patches.length) {
      this.#patches[patch.slot] = patch;
    }
    this.dispatchEvent(new CustomEvent('patchupdate', { detail: patch }));
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function datestamp() {
  return new Date().toISOString().slice(0, 10);
}

/**
 * @typedef {Object} BackupFile
 * @property {string} version
 * @property {string} timestamp
 * @property {{ key: string, name: string, deviceId: number, firmware: string }} device
 * @property {(PatchData|null)[]} patches
 */
