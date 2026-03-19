/**
 * engine/patch_codec.js
 * Serialização e desserialização de patches G1on
 */

import { packTo7Bit, unpackFrom7Bit } from './sysex_packer.js';
import { FX_CATALOG, fxNameById }     from '../data/effects_catalog.js';

const SLOT_COUNT    = 5;
const BYTES_PER_SLOT = 11;
const NAME_LENGTH   = 10;
const PATCH_SIZE    = SLOT_COUNT * BYTES_PER_SLOT + NAME_LENGTH;

export function encodePatch(patch) {
  const raw = new Array(PATCH_SIZE).fill(0);

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
    } else {
      // Slot Vazio! Enviamos como ID 0 (Z-Syn) mas desligado e com parâmetros zerados
      // Isso indica seguramente pra Zoom que não há nada tocando ali.
      raw[base + 0] = 0x00;
      raw[base + 1] = 0x00;
      raw[base + 2] = 0x00;
      for (let p = 0; p < 8; p++) raw[base + 3 + p] = 0x00;
    }
  }

  const nameBytes = Array.from(
    (patch.name || 'INIT      ').padEnd(NAME_LENGTH, ' ').substring(0, NAME_LENGTH)
  ).map(c => c.charCodeAt(0) & 0x7F);

  for (let i = 0; i < NAME_LENGTH; i++) {
    raw[SLOT_COUNT * BYTES_PER_SLOT + i] = nameBytes[i];
  }

  return packTo7Bit(raw);
}

export function decodePatch(packedBytes, slotIndex = 0) {
  const raw = unpackFrom7Bit(packedBytes);

  if (raw.length < PATCH_SIZE) {
    console.warn(`[patch_codec] Dados insuficientes: ${raw.length} bytes`);
    return null;
  }

  const effects = [];

  for (let i = 0; i < SLOT_COUNT; i++) {
    const base  = i * BYTES_PER_SLOT;
    const on    = raw[base + 0] === 0x01;
    const fxId  = raw[base + 1] | ((raw[base + 2] & 0x01) << 7);
    const fxName = fxNameById(fxId);
    
    // Captura os parâmetros para podermos checar se o slot está efetivamente "vazio"
    const params = [];
    for (let p = 0; p < 8; p++) {
      params.push(raw[base + 3 + p] & 0x7F);
    }

    // Se é o Z-Syn (ID 0), está desligado e todos os params são 0, consideramos o slot VAZIO
    const isEmpty = !on && fxId === 0 && params.every(p => p === 0);

    if (fxName && !isEmpty) {
      effects.push({ name: fxName, on, params });
    } else {
      effects.push(null);
    }
  }

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

export function createEffect(fxName, on = true) {
  const def = FX_CATALOG[fxName];
  if (!def) return null;
  return {
    name:   fxName,
    on,
    params: def.params.map(() => 64),
  };
}

export function clonePatch(patch) {
  return {
    ...patch,
    effects: patch.effects.map(fx =>
      fx ? { ...fx, params: [...fx.params] } : null
    ),
  };
}

export { SLOT_COUNT, PATCH_SIZE, NAME_LENGTH };