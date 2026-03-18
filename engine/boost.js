/**
 * engine/boost.js
 * Aumento de volume temporário no patch
 */

import { sendRaw, ZOOM_MFR, ZOOM_DEV, ZOOM_MODEL, CMD_PARAM } from './midi-core.js';
import { patchAtual } from './patch-manager.js';

const VOL_MAX = 150;
const BOOST_DELTA = 10;
export let boostAtivo = false;
let boostVolBase = null;

// Exposto para window (botoes do HTML)
window.toggleBoost = function() {
    const volBase = patchAtual.volume ?? 100;
  
    if (boostAtivo) {
        // Desativa: restaura
        const volRestaurar = boostVolBase ?? volBase;
        enviarVolumePatch(volRestaurar);
        boostAtivo = false;
        boostVolBase = null;
    } else {
        // Ativa
        const volBoost = Math.min(VOL_MAX, volBase + BOOST_DELTA);
        if (volBoost <= volBase) {
            console.warn('Volume já no maximo.');
            return;
        }
        boostVolBase = volBase;
        enviarVolumePatch(volBoost);
        boostAtivo = true;
    }
  
    // Avisa a view
    window.dispatchEvent(new CustomEvent('fmc-boost-changed', { detail: boostAtivo }));
}

function enviarVolumePatch(vol) {
    const lsb = vol & 0x7F;
    const msb = (vol >> 7) & 0x7F;
    sendRaw([
        0xF0, ZOOM_MFR, ZOOM_DEV, ZOOM_MODEL, CMD_PARAM,
        0x0A, 0x02, lsb, msb, 0xF7
    ], true);
}
