/**
 * engine/tuner.js
 * Ativa/desativa o afinador via MIDI CC
 * Confirmado pelo SysExTones: CC B0 4A 40 (ON), B0 4A 00 (OFF)
 */

import { sendRaw } from './midi-core.js';

export let tunerActive = false;

function setTuner(active) {
    tunerActive = active;
    // CC#74 (0x4A), valor 0x40=ON, 0x00=OFF — confirmado pelo SysExTones
    sendRaw([0xB0, 0x4A, active ? 0x40 : 0x00]);
    
    window.dispatchEvent(new CustomEvent('fmc-tuner-changed', { detail: active }));
}

window.addEventListener('fmc-tuner-toggle', () => {
    setTuner(!tunerActive);
});
