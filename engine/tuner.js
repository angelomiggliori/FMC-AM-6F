/**
 * engine/tuner.js
 * Ativa/desativa o afinador via SysEx
 */

 import { sendRaw, ZOOM_MFR, ZOOM_DEV, ZOOM_MODEL } from './midi-core.js';

 export let tunerActive = false;
 
 function setTuner(active) {
     tunerActive = active;
     // 0x42 = ON, 0x43 = OFF
     const actionByte = active ? 0x42 : 0x43;
     sendRaw([0xF0, ZOOM_MFR, ZOOM_DEV, ZOOM_MODEL, 0x03, actionByte, 0xF7], true);
     
     // Feedback visual placeholder
     window.dispatchEvent(new CustomEvent('fmc-tuner-changed', { detail: active }));
 }
 
 window.addEventListener('fmc-tuner-toggle', () => {
     setTuner(!tunerActive);
 });
 
