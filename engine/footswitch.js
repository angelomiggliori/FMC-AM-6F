/**
 * engine/footswitch.js
 * Mapeamento dos 12 Footswitches
 * [FS1] [FS2] [FS3] [FS4] [FS5] [BANK]
 * [FS6] [FS7] [FS8] [FS9] [FS10][TAP]
 */

import { changePatch } from './patch-manager.js';

export const state = {
    bankIndex: 0,
    patchIndex: 0, 
    bankSelectMode: false
};

const BANKS = ['A','B','C','D','E','F','G','H','I','J'];

let fsTimers = {};
const HOLD_MS = 900;

function handlePatchPress(index) {
    if (state.bankSelectMode) {
        // Index de 0-9 vira o novo banco A-J
        if (index >= 0 && index <= 9) {
            state.bankIndex = index;
            state.bankSelectMode = false;
            // Opcional: dispara PC do primeiro patch do banco novo
            state.patchIndex = 0;
            changePatch(state.bankIndex, state.patchIndex);
        }
        return;
    }

    state.patchIndex = index;
    changePatch(state.bankIndex, state.patchIndex);
    window.dispatchEvent(new CustomEvent('fmc-ui-render'));
}

export function fswDown(fsId) {
    fsTimers[fsId] = setTimeout(() => {
        fsTimers[fsId] = null; // Hold fired
        handleHold(fsId);
    }, HOLD_MS);
}

export function fswUp(fsId) {
    if (fsTimers[fsId]) {
        // Short press
        clearTimeout(fsTimers[fsId]);
        fsTimers[fsId] = null;
        handlePress(fsId);
    }
}

function handlePress(fsId) {
    // Índices físicos:
    // 0-4 = Patches 0-4
    // 5 = BANK
    // 6-10 = Patches 5-9
    // 11 = TAP
    
    if (fsId >= 0 && fsId <= 4) handlePatchPress(fsId);
    else if (fsId >= 6 && fsId <= 10) handlePatchPress(fsId - 1); // Subtrai 1 para pular o 5 (BANK) no array lógico 0-9
    else if (fsId === 5) {
        // BANK Press
        state.bankSelectMode = !state.bankSelectMode;
        window.dispatchEvent(new CustomEvent('fmc-ui-render'));
    }
    else if (fsId === 11) {
        // TAP Press
        window.dispatchEvent(new CustomEvent('fmc-tap-press'));
    }
}

function handleHold(fsId) {
    if (fsId === 5) {
         // BANK Hold -> Tuner Toggle
         window.dispatchEvent(new CustomEvent('fmc-tuner-toggle'));
    }
}

// Bind to window for HTML UI triggers (onclick/onpointerdown etc)
window.fswDown = fswDown;
window.fswUp = fswUp;
