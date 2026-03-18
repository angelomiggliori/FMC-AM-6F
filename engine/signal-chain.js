/**
 * engine/signal-chain.js
 * Signal Chain Editor (ex-ToneWebLib)
 * Render visual da chain e interação touch.
 */

import { sendRaw, ZOOM_MFR, ZOOM_DEV, ZOOM_MODEL, CMD_PARAM } from './midi-core.js';
import { fxParamsDb } from './tap-engine.js'; // Reaproveitando os refs de dicionário

let pendingTap = null;

// Sincronizar ON/OFF imediato no botão
function toggleEffect(slotIdx, rawSlot, enabled) {
    const bitVal = enabled ? (rawSlot[3] | 0x80) : (rawSlot[3] & 0x7F);
    rawSlot[3] = bitVal;
    const lsb = bitVal & 0x7F;
    const msb = (bitVal >> 7) & 0x7F;

    sendRaw([
        0xF0, ZOOM_MFR, ZOOM_DEV, ZOOM_MODEL, CMD_PARAM,
        slotIdx, 0, lsb, msb, 0xF7
    ]);
}

// Abre o overlay de edição dos parâmetros do efeito selecionado
function openEditor(fx) {
    // Todo: Integrar com a view.
    // Dispara via CustomEvent para que um modulo main.js cuide da renderização final no HTML
    window.dispatchEvent(new CustomEvent('fmc-fx-edit-open', { detail: fx }));
}

// Listener pro container click
window.onFxSlotInteraction = function(action, fxData) {
    if (action === 'single') {
        if (pendingTap) {
            clearTimeout(pendingTap);
            pendingTap = null;
            openEditor(fxData); // Double tap interpretado
        } else {
            pendingTap = setTimeout(() => {
                pendingTap = null;
                // Single tap executa toggle de habilitado
                fxData.enabled = !fxData.enabled;
                toggleEffect(fxData.slotIdx, fxData.rawSlot, fxData.enabled);
                window.dispatchEvent(new CustomEvent('fmc-ui-render')); // Recria o visual do bloco
            }, 300); // 300ms discriminador single/double
        }
    }
};

window.addEventListener('fmc-dump-received', (e) => {
    const patch = e.detail;
    // O patch foi recebido, disparamos a recriação do visual
    window.dispatchEvent(new CustomEvent('fmc-ui-render', { detail: patch }));
});

// Listener for Real-time Parameter Editing from GUI Overlay
window.addEventListener('fmc-param-changed', (e) => {
    const { slotIdx, paramIdx, value } = e.detail;
    
    // Zoom G1On accepts up to 14-bit split across LSB/MSB
    const valLo = value & 0x7F;
    const valHi = (value >> 7) & 0x7F;
    
    sendRaw([
        0xF0, ZOOM_MFR, ZOOM_DEV, ZOOM_MODEL, CMD_PARAM,
        slotIdx, 
        paramIdx, 
        valLo, 
        valHi, 
        0xF7
    ]);
});
