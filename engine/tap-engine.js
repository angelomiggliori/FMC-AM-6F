// engine/tap-engine.js
// Tap Tempo via CMD_PARAM (0x31) — método confirmado pela comunidade e pela V4.2
import { sendRaw, forceEditOn, ZOOM_MFR, ZOOM_DEV, ZOOM_MODEL, CMD_PARAM, sleep } from './midi-core.js';
import { patchAtual } from './patch-manager.js';

export let fxParamsDb = {};
export let currentBpm = 120;

const tapHistory = [];
const TAP_TIMEOUT = 2000;
const SYSEX_DELAY = 60;

export function loadFxParamsDb(db) {
    fxParamsDb = db || {};
}

/**
 * Envia CMD_PARAM para um slot específico.
 * Formato: F0 52 00 63 31 [slot] [paramIdx] [valLo] [valHi] F7
 * O firmware da G1On cuida de toda a manipulação bit-a-bit internamente.
 */
function enviarCmdParam(slotIdx, paramIdx, valor) {
    const valLo = valor & 0x7F;
    const valHi = (valor >> 7) & 0x7F;
    sendRaw([
        0xF0, ZOOM_MFR, ZOOM_DEV, ZOOM_MODEL, CMD_PARAM,
        slotIdx, paramIdx, valLo, valHi, 0xF7
    ], true);
}

/**
 * Sincroniza o BPM com todos os efeitos habilitados que aceitam Tap.
 * Delay Time: param 0, valor direto em ms (max ~2000-4000 depende do efeito)
 * Mod Rate: param 0, valor calculado por escala (hz * escala)
 */
async function sendTapSync(bpm) {
    const ms = Math.round(60000 / bpm);
    const hz = bpm / 60;

    // Filtra efeitos habilitados com tap
    const alvos = patchAtual.efeitos.filter(fx => fx.enabled && fx.tap);
    if (alvos.length === 0) return;

    // Garante que o editor está aberto antes de enviar
    await forceEditOn();
    await sleep(SYSEX_DELAY);

    for (const fx of alvos) {
        let valor;

        if (fx.tap === 'Time') {
            // Delay: valor direto em ms, limitado pelo max do parâmetro
            const maxTime = fx.tapMax || 4095;
            valor = Math.max(1, Math.min(maxTime, ms));
        } else if (fx.tap === 'Rate') {
            // Modulação: hz × escala do efeito
            const escala = fx.tapScale || 30;
            const maxRate = fx.tapMax || 127;
            valor = Math.max(0, Math.min(maxRate, Math.round(hz * escala)));
        } else {
            continue;
        }

        const paramIdx = fx.tapParamIdx || 0;
        enviarCmdParam(fx.slotIdx, paramIdx, valor);
        await sleep(SYSEX_DELAY);
    }
}

function processTap() {
    const now = performance.now();

    if (tapHistory.length > 0) {
        if (now - tapHistory[tapHistory.length - 1] > TAP_TIMEOUT) {
            tapHistory.length = 0;
        }
    }

    tapHistory.push(now);
    if (tapHistory.length > 5) tapHistory.shift();

    if (tapHistory.length >= 2) {
        let sum = 0;
        for (let i = 1; i < tapHistory.length; i++) {
            sum += (tapHistory[i] - tapHistory[i - 1]);
        }
        const avgMs = sum / (tapHistory.length - 1);
        currentBpm = Math.round(60000 / avgMs);
        currentBpm = Math.min(250, Math.max(40, currentBpm));

        window.dispatchEvent(new CustomEvent('fmc-bpm-update', { detail: currentBpm }));
        sendTapSync(currentBpm);
    }
}

// Hook do FS12
window.addEventListener('fmc-tap-press', () => {
    processTap();
});
