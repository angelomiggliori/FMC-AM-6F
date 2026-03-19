/**
 * zoom-protocol.js
 * Zoom SysEx protocol implementation based on binary analysis of ToneLib-Zoom.exe
 *
 * Protocol structure:
 *   F0 52 00 [DevID] [Cmd] [Data...] F7
 *
 * Sources:
 *  - Static string/binary analysis of ToneLib-Zoom.exe (PE32+ x86-64)
 *  - Community documentation (zoominfo, zoom-mst projects)
 */

// ── Manufacturer & Device IDs ─────────────────────────────────────────────

export const ZOOM_MANUFACTURER_ID = 0x52;

export const DEVICES = {
  'G1on':     { id: 0x61, name: 'Zoom G1on',     category: 'guitar', fxSlots: 5, presets: 50, fwMin: '1.21' },
  'G1on_AK':  { id: 0x61, name: 'Zoom G1on-AK',  category: 'guitar', fxSlots: 5, presets: 50, fwMin: '1.21' },
  'G1Xon':    { id: 0x62, name: 'Zoom G1Xon',    category: 'guitar', fxSlots: 5, presets: 50, fwMin: '1.21' },
  'G1Xon_K':  { id: 0x63, name: 'Zoom G1Xon-K',  category: 'guitar', fxSlots: 5, presets: 50, fwMin: '1.21' },
  'G1four':   { id: 0x64, name: 'Zoom G1 FOUR',  category: 'guitar', fxSlots: 5, presets: 50, fwMin: null   },
  'G1Xfour':  { id: 0x65, name: 'Zoom G1X FOUR', category: 'guitar', fxSlots: 5, presets: 50, fwMin: null   },
  'G3n':      { id: 0x6E, name: 'Zoom G3n',      category: 'guitar', fxSlots: 7, presets: 60, fwMin: null   },
  'G3Xn':     { id: 0x6E, name: 'Zoom G3Xn',     category: 'guitar', fxSlots: 7, presets: 60, fwMin: null   },
  'G5n':      { id: 0x73, name: 'Zoom G5n',      category: 'guitar', fxSlots: 7, presets: 60, fwMin: null   },
  'B1on':     { id: 0x5F, name: 'Zoom B1on',     category: 'bass',   fxSlots: 5, presets: 50, fwMin: '1.21' },
  'B1Xon':    { id: 0x66, name: 'Zoom B1Xon',    category: 'bass',   fxSlots: 5, presets: 50, fwMin: '1.21' },
  'B1four':   { id: 0x71, name: 'Zoom B1 FOUR',  category: 'bass',   fxSlots: 5, presets: 50, fwMin: null   },
  'MS50G':    { id: 0x58, name: 'Zoom MS-50G',   category: 'guitar', fxSlots: 6, presets: 50, fwMin: '3.00' },
  'MS60B':    { id: null, name: 'Zoom MS-60B',   category: 'bass',   fxSlots: 6, presets: 50, fwMin: '2.00' },
  'MS70CDR':  { id: null, name: 'Zoom MS-70CDR', category: 'cdr',    fxSlots: 6, presets: 50, fwMin: '1.00' },
};

// Map device ID byte → device key
export const DEVICE_ID_MAP = Object.fromEntries(
  Object.entries(DEVICES)
    .filter(([, d]) => d.id !== null)
    .map(([key, d]) => [d.id, key])
);

// MIDI port name prefixes used by Zoom devices
export const ZOOM_PORT_PREFIXES = [
  'Zoom G1on', 'Zoom G1Xon', 'Zoom G1four', 'Zoom G1Xfour',
  'Zoom G3n',  'Zoom G3Xn',  'Zoom G5n',
  'Zoom B1on', 'Zoom B1Xon', 'Zoom B1four', 'Zoom B1Xfour', 'Zoom B3n',
  'Zoom MS-50', 'Zoom MS-60', 'Zoom MS-70',
];

// ── SysEx Command Bytes ───────────────────────────────────────────────────

export const CMD = {
  MEMORY_USAGE_REQUEST:   0x06,
  READ_CURRENT_PATCH:     0x08,
  WRITE_PATCH:            0x09,
  PATCH_DATA_FRAME:       0x28,
  IDENTITY_PING:          0x50,
  FILE_SYSTEM_INFO:       0x64,
};

// ── Message Builders ──────────────────────────────────────────────────────

/**
 * Universal Identity Request (MIDI standard — not Zoom-specific)
 * Pedal responds with: F0 7E 00 06 02 52 00 [DevID] [fw_major] [fw_minor] ... F7
 */
export function buildIdentityRequest() {
  return Uint8Array.from([0xF0, 0x7E, 0x00, 0x06, 0x01, 0xF7]);
}

/**
 * Zoom proprietary identity ping
 */
export function buildIdentityPing(deviceId) {
  return buildSysEx(deviceId, [CMD.IDENTITY_PING, CMD.IDENTITY_PING]);
}

/**
 * Request memory usage info from the pedal
 */
export function buildMemoryUsageRequest(deviceId) {
  return buildSysEx(deviceId, [CMD.MEMORY_USAGE_REQUEST]);
}

/**
 * Request current patch (edit buffer) from the pedal
 */
export function buildReadCurrentPatch(deviceId) {
  return buildSysEx(deviceId, [CMD.READ_CURRENT_PATCH]);
}

/**
 * Request a specific patch slot from the pedal
 * @param {number} deviceId
 * @param {number} slot  0-based patch index (0–49)
 */
export function buildReadPatch(deviceId, slot) {
  const slotLo = slot & 0x7F;
  const slotHi = (slot >> 7) & 0x7F;
  return buildSysEx(deviceId, [CMD.PATCH_DATA_FRAME, slotLo, slotHi]);
}

/**
 * Write a patch to a specific slot
 * @param {number} deviceId
 * @param {number} slot
 * @param {PatchData} patch
 */
export function buildWritePatch(deviceId, slot, patch) {
  const slotLo = slot & 0x7F;
  const slotHi = (slot >> 7) & 0x7F;
  const patchBytes = encodePatch(patch);
  return buildSysEx(deviceId, [CMD.PATCH_DATA_FRAME, slotLo, slotHi, ...patchBytes]);
}

/**
 * MIDI Program Change — switch active preset on pedal
 * @param {number} slot  0-based
 */
export function buildProgramChange(slot) {
  return Uint8Array.from([0xC0, slot & 0x7F]);
}

/**
 * MIDI Bank Select (MSB + LSB) + Program Change
 * For pedals with more than 128 presets
 */
export function buildBankAndProgram(bank, slot) {
  return Uint8Array.from([
    0xB0, 0x00, bank & 0x7F,   // Bank Select MSB
    0xB0, 0x20, 0x00,           // Bank Select LSB
    0xC0, slot & 0x7F,          // Program Change
  ]);
}

// ── Low-level SysEx builder ───────────────────────────────────────────────

/**
 * Wraps payload in Zoom SysEx envelope:
 * F0 52 00 [deviceId] [payload...] F7
 */
export function buildSysEx(deviceId, payload) {
  return Uint8Array.from([
    0xF0,
    ZOOM_MANUFACTURER_ID,
    0x00,
    deviceId,
    ...payload,
    0xF7,
  ]);
}

// ── Response Parsers ──────────────────────────────────────────────────────

/**
 * Parse Universal Identity Response
 * Expected: F0 7E 00 06 02 52 00 [DevID] [fw_major] [fw_minor] ... F7
 *
 * @param {Uint8Array} data
 * @returns {{ deviceId: number, deviceKey: string|null, fwMajor: number, fwMinor: number } | null}
 */
export function parseIdentityResponse(data) {
  if (
    data.length < 10 ||
    data[0]  !== 0xF0 ||
    data[1]  !== 0x7E ||
    data[3]  !== 0x06 ||
    data[4]  !== 0x02 ||
    data[5]  !== ZOOM_MANUFACTURER_ID
  ) return null;

  const deviceId  = data[7];
  const fwMajor   = data[8];
  const fwMinor   = data[9];
  const deviceKey = DEVICE_ID_MAP[deviceId] ?? null;

  return { deviceId, deviceKey, fwMajor, fwMinor };
}

/**
 * Parse a Patch Data Frame response
 * F0 52 00 [DevID] 28 [slotLo] [slotHi] [fx1_id] [fx1_p1..p6] ... [name_10] F7
 *
 * @param {Uint8Array} data
 * @returns {PatchData | null}
 */
export function parsePatchResponse(data) {
  if (
    data.length < 10 ||
    data[0] !== 0xF0 ||
    data[1] !== ZOOM_MANUFACTURER_ID ||
    data[4] !== CMD.PATCH_DATA_FRAME
  ) return null;

  const deviceId = data[3];
  const slot     = data[5] | (data[6] << 7);
  const payload  = data.slice(7, -1); // strip F0..F7 header/footer

  return decodePatch(deviceId, slot, payload);
}

// ── Patch Encode / Decode ─────────────────────────────────────────────────

/**
 * Decode raw patch payload into structured PatchData
 * Each effect slot = 1 byte ID + 6 bytes params (7 bytes total)
 * Name = last 10 bytes (ASCII, space-padded)
 *
 * @param {number} deviceId
 * @param {number} slot
 * @param {Uint8Array} payload
 * @returns {PatchData}
 */
export function decodePatch(deviceId, slot, payload) {
  const device   = DEVICES[DEVICE_ID_MAP[deviceId]] ?? null;
  const fxSlots  = device?.fxSlots ?? 5;
  const effects  = [];

  let offset = 0;
  for (let i = 0; i < fxSlots; i++) {
    if (offset + 7 > payload.length) break;
    const fxId     = payload[offset];
    const params   = Array.from(payload.slice(offset + 1, offset + 7));
    const enabled  = fxId !== 0x00;
    effects.push({ fxId, params, enabled });
    offset += 7;
  }

  // Remaining bytes = patch name (10 ASCII chars)
  const nameBytes = payload.slice(offset, offset + 10);
  const name      = String.fromCharCode(...nameBytes).trimEnd();

  return { deviceId, slot, name, effects };
}

/**
 * Encode PatchData back to raw bytes for SysEx transmission
 * @param {PatchData} patch
 * @returns {number[]}
 */
export function encodePatch(patch) {
  const bytes = [];

  for (const fx of patch.effects) {
    bytes.push(fx.enabled ? fx.fxId : 0x00);
    for (let i = 0; i < 6; i++) {
      bytes.push(fx.params[i] ?? 0x00);
    }
  }

  // Name: 10 ASCII bytes, space-padded
  const nameBytes = Array.from({ length: 10 }, (_, i) =>
    i < patch.name.length ? patch.name.charCodeAt(i) & 0x7F : 0x20
  );
  bytes.push(...nameBytes);

  return bytes;
}

// ── Utilities ─────────────────────────────────────────────────────────────

/** Format bytes as hex string for debugging */
export function bytesToHex(data) {
  return Array.from(data).map(b => b.toString(16).padStart(2, '0').toUpperCase()).join(' ');
}

/** Check if a MIDI port name belongs to a Zoom device */
export function isZoomPort(portName) {
  return ZOOM_PORT_PREFIXES.some(prefix =>
    portName.toLowerCase().includes(prefix.toLowerCase())
  );
}

/**
 * @typedef {Object} PatchData
 * @property {number}   deviceId
 * @property {number}   slot
 * @property {string}   name
 * @property {EffectSlot[]} effects
 *
 * @typedef {Object} EffectSlot
 * @property {number}   fxId
 * @property {number[]} params   6 bytes
 * @property {boolean}  enabled
 */
