/**
 * engine/patch_codec.js
 * Serialização e desserialização de patches G1on
 *
 * Formato do patch (após unpack 7-bit), ~65 bytes:
 *
 *   Bytes 0–54  : 5 slots de efeito × 11 bytes cada
 *     [slot × 11 + 0]  : on/off (0x00 = off, 0x01 = on)
 *     [slot × 11 + 1]  : effectId LSB (bits 0–6)
 *     [slot × 11 + 2]  : effectId MSB (bit 7)
 *     [slot × 11 + 3–10]: parâmetros p0–p7 (0–127 cada)
 *
 *   Bytes 55–64 : nome do patch, 10 bytes ASCII (padded com 0x20)
 *
 * NOTA: Os bytes acima são os dados REAIS (após unpack).
 *       Na transmissão SysEx, estão em formato 7-bit packed.
 */

import { packTo7Bit, unpackFrom7Bit } from './sysex_packer.js';
import { FX_CATALOG, fxNameById }     from '../data/effects_catalog.js';

const SLOT_COUNT    = 5;
const BYTES_PER_SLOT = 11;   // 1 on/off + 2 id + 8 params
const NAME_LENGTH   = 10;
const PATCH_SIZE    = SLOT_COUNT * BYTES_PER_SLOT + NAME_LENGTH; // 65 bytes

/**
 * Serializa um objeto patch em bytes prontos para SysEx (7-bit packed).
 * @param {Object} patch - objeto patch da aplicação
 * @returns {number[]} bytes packed para inserir no buildPatchUpload()
 */
export function encodePatch(patch) {
  const raw = new Array(PATCH_SIZE).fill(0);

  // Slots de efeito
  for (let i = 0; i < SLOT_COUNT; i++) {
    const fx  = patch.effects[i];
    const base = i * BYTES_PER_SLOT;

    if (fx && fx.name) {
      const def   = FX_CATALOG[fx.name];
      const fxId  = def ? def.id : 0;

      raw[base + 0] = fx.on ? 0x01 : 0x00;
      raw[base + 1] = fxId & 0x7F;
      raw[base + 2] = (fxId >> 7) & 0x01;

      const paramCount = def ? def.params.length : 0;
      for (let p = 0; p < 8; p++) {
        raw[base + 3 + p] = (p < paramCount && fx.params[p] !== undefined)
          ? (fx.params[p] & 0x7F)
          : 0x00;
      }
    }
    // slot vazio → bytes já zerados
  }

  // Nome do patch (10 chars ASCII, padded com espaço)
  const nameBytes = Array.from(
    (patch.name || 'INIT      ').padEnd(NAME_LENGTH, ' ').substring(0, NAME_LENGTH)
  ).map(c => c.charCodeAt(0) & 0x7F);

  for (let i = 0; i < NAME_LENGTH; i++) {
    raw[SLOT_COUNT * BYTES_PER_SLOT + i] = nameBytes[i];
  }

  return packTo7Bit(raw);
}

/**
 * Desserializa bytes recebidos do SysEx de patch dump em objeto patch.
 * @param {number[]} packedBytes  - bytes packed recebidos (sem header/footer SysEx)
 * @param {number}   slotIndex   - índice do slot de destino
 * @returns {Object} objeto patch
 */
export function decodePatch(packedBytes, slotIndex = 0) {
  const raw = unpackFrom7Bit(packedBytes);

  if (raw.length < PATCH_SIZE) {
    console.warn(`[patch_codec] Dados insuficientes: ${raw.length} bytes (esperado ${PATCH_SIZE})`);
    return null;
  }

  const effects = [];

  for (let i = 0; i < SLOT_COUNT; i++) {
    const base  = i * BYTES_PER_SLOT;
    const on    = raw[base + 0] === 0x01;
    const fxId  = raw[base + 1] | ((raw[base + 2] & 0x01) << 7);
    const fxName = fxNameById(fxId);

    if (fxName) {
      const def    = FX_CATALOG[fxName];
      const params = [];
      for (let p = 0; p < 8; p++) {
        params.push(raw[base + 3 + p] & 0x7F);
      }
      effects.push({ name: fxName, on, params });
    } else {
      effects.push(null);
    }
  }

  // Nome do patch
  const nameOffset = SLOT_COUNT * BYTES_PER_SLOT;
  const nameRaw    = raw.slice(nameOffset, nameOffset + NAME_LENGTH);
  const name       = nameRaw
    .map(b => (b >= 0x20 && b <= 0x7E) ? String.fromCharCode(b) : ' ')
    .join('')
    .trimEnd();

  return {
    slot: slotIndex,
    name: name || ('PATCH' + String(slotIndex).padStart(2, '0')),
    effects,
    dirty: false,
  };
}

/**
 * Cria um objeto efeito com parâmetros padrão (todos em 64).
 * @param {string}  fxName  - nome do efeito (chave do FX_CATALOG)
 * @param {boolean} on      - estado inicial
 * @returns {Object|null}
 */
export function createEffect(fxName, on = true) {
  const def = FX_CATALOG[fxName];
  if (!def) return null;
  return {
    name:   fxName,
    on,
    params: def.params.map(() => 64),
  };
}

/**
 * Cria cópia profunda de um patch (para undo / comparação).
 * @param {Object} patch
 * @returns {Object}
 */
export function clonePatch(patch) {
  return {
    ...patch,
    effects: patch.effects.map(fx =>
      fx ? { ...fx, params: [...fx.params] } : null
    ),
  };
}

export { SLOT_COUNT, PATCH_SIZE, NAME_LENGTH };
