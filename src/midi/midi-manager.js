/**
 * midi-manager.js
 * Web MIDI API wrapper with Zoom device detection and SysEx handling
 */

import {
  buildIdentityRequest,
  buildIdentityPing,
  parseIdentityResponse,
  parsePatchResponse,
  isZoomPort,
  DEVICES,
  DEVICE_ID_MAP,
  bytesToHex,
} from '../protocol/zoom-protocol.js';

const IDENTITY_TIMEOUT_MS = 2000;
const RESPONSE_TIMEOUT_MS = 3000;

export class MidiManager extends EventTarget {
  #access       = null;
  #input        = null;
  #output       = null;
  #deviceInfo   = null;
  #pendingReply = null;  // { resolve, reject, timerId }

  // ── Public API ────────────────────────────────────────────────────────────

  get connected()  { return this.#input !== null && this.#output !== null; }
  get deviceInfo() { return this.#deviceInfo; }

  /**
   * Request Web MIDI access and scan for Zoom devices
   * Emits: 'connected', 'disconnected', 'error'
   */
  async connect() {
    if (!navigator.requestMIDIAccess) {
      throw new Error('Web MIDI API not supported in this browser. Try Chrome or Edge.');
    }

    try {
      this.#access = await navigator.requestMIDIAccess({ sysex: true });
    } catch (err) {
      throw new Error(`MIDI access denied: ${err.message}. Make sure to allow MIDI access when prompted.`);
    }

    this.#access.onstatechange = (e) => this.#onStateChange(e);

    const found = this.#scanPorts();
    if (!found) {
      throw new Error('No Zoom device found. Connect the pedal via USB and make sure it is powered on.');
    }

    // Perform handshake
    const info = await this.#handshake();
    this.#deviceInfo = info;
    this.dispatchEvent(new CustomEvent('connected', { detail: info }));
    return info;
  }

  /** Disconnect and clean up */
  disconnect() {
    if (this.#input)  { this.#input.onmidimessage = null; this.#input = null; }
    if (this.#output) this.#output = null;
    this.#deviceInfo = null;
    this.#rejectPending('Disconnected');
    this.dispatchEvent(new CustomEvent('disconnected'));
  }

  /**
   * Send a SysEx or short MIDI message and optionally wait for a response
   * @param {Uint8Array} message
   * @param {boolean} waitForReply
   * @returns {Promise<Uint8Array|null>}
   */
  async send(message, waitForReply = false) {
    if (!this.connected) throw new Error('Not connected to any device');

    const promise = waitForReply ? this.#waitForReply() : null;
    this.#output.send(message);

    if (waitForReply) return promise;
    return null;
  }

  /** List all available MIDI ports (for diagnostics) */
  listPorts() {
    if (!this.#access) return { inputs: [], outputs: [] };
    return {
      inputs:  Array.from(this.#access.inputs.values()).map(p => ({ id: p.id, name: p.name, state: p.state })),
      outputs: Array.from(this.#access.outputs.values()).map(p => ({ id: p.id, name: p.name, state: p.state })),
    };
  }

  // ── Private ───────────────────────────────────────────────────────────────

  #scanPorts() {
    const inputs  = Array.from(this.#access.inputs.values());
    const outputs = Array.from(this.#access.outputs.values());

    const input  = inputs.find(p  => isZoomPort(p.name));
    const output = outputs.find(p => isZoomPort(p.name));

    if (!input || !output) return false;

    this.#input  = input;
    this.#output = output;
    this.#input.onmidimessage = (e) => this.#onMidiMessage(e);

    console.log(`[MidiManager] Found device: ${input.name}`);
    return true;
  }

  async #handshake() {
    // Step 1: Universal Identity Request
    const replyPromise = this.#waitForReply(IDENTITY_TIMEOUT_MS);
    this.#output.send(buildIdentityRequest());

    let reply;
    try {
      reply = await replyPromise;
    } catch {
      throw new Error('Device response timeout — pedal did not respond to Identity Request.');
    }

    const identity = parseIdentityResponse(reply);
    if (!identity) {
      throw new Error(`Invalid Identity Response: ${bytesToHex(reply)}`);
    }

    const deviceKey = identity.deviceKey;
    const device    = deviceKey ? DEVICES[deviceKey] : null;

    // Step 2: Zoom proprietary ping (optional, improves compat)
    if (device) {
      try {
        await this.send(buildIdentityPing(identity.deviceId), true);
      } catch {
        // non-fatal — some firmware versions skip the proprietary ping
      }
    }

    return {
      deviceKey,
      deviceId:  identity.deviceId,
      name:      device?.name ?? `Unknown Zoom (ID=0x${identity.deviceId.toString(16).toUpperCase()})`,
      category:  device?.category ?? 'unknown',
      fxSlots:   device?.fxSlots ?? 5,
      presets:   device?.presets ?? 50,
      firmware:  `${identity.fwMajor}.${String(identity.fwMinor).padStart(2, '0')}`,
      portName:  this.#input.name,
    };
  }

  #onMidiMessage(event) {
    const data = new Uint8Array(event.data);

    // Emit raw event for debugging / sniffing
    this.dispatchEvent(new CustomEvent('rawmessage', { detail: data }));

    // Unsolicited patch update (pedal knob turned, preset changed)
    if (data[0] === 0xF0 && data[4] === 0x28) {
      const patch = parsePatchResponse(data);
      if (patch) {
        this.dispatchEvent(new CustomEvent('patchupdate', { detail: patch }));
      }
    }

    // Resolve pending reply
    if (this.#pendingReply) {
      clearTimeout(this.#pendingReply.timerId);
      this.#pendingReply.resolve(data);
      this.#pendingReply = null;
    }
  }

  #onStateChange(event) {
    const { port } = event;
    if (port === this.#input || port === this.#output) {
      if (port.state === 'disconnected') {
        this.disconnect();
      }
    }
    // New device plugged in
    if (port.state === 'connected' && !this.connected && isZoomPort(port.name)) {
      this.connect().catch(() => {});
    }
  }

  #waitForReply(timeoutMs = RESPONSE_TIMEOUT_MS) {
    return new Promise((resolve, reject) => {
      this.#rejectPending('Superseded by new request');
      const timerId = setTimeout(() => {
        this.#pendingReply = null;
        reject(new Error('Device response timeout'));
      }, timeoutMs);
      this.#pendingReply = { resolve, reject, timerId };
    });
  }

  #rejectPending(reason) {
    if (this.#pendingReply) {
      clearTimeout(this.#pendingReply.timerId);
      this.#pendingReply.reject(new Error(reason));
      this.#pendingReply = null;
    }
  }
}
