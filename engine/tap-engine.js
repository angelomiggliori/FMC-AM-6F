// engine/tap-engine.js
import { sendRaw, ZOOM_MFR, ZOOM_DEV, ZOOM_MODEL, CMD_PARAM } from './midi-core.js';
import { patchAtual } from './patch-manager.js';
import { LocalDB } from '../data/data-manager.js';

export let fxParamsDb = {}; // Preenchido remotamente na inicialização
const tapHistory = [];
export let currentBpm = 120;

const TAP_TIMEOUT = 2000; // Reseta o histórico se passar 2 segundos

export function loadFxParamsDb(db) {
    fxParamsDb = db || {};
}

// Converte BPM em MS ou HZ, aplica escala, e envia via CMD_PARAM 0x31
async function sendTapSync(bpm) {
    const scales = (await LocalDB.read('tap-scales')) || {};
    
    // Busca na chain efeitos habilitados para Tap (Time ou Rate)
    patchAtual.efeitos.forEach(fx => {
        if (!fx.enabled || !fx.tap) return;

        const hexId = '0x' + fx.id.toString(16).toUpperCase().padStart(4, '0');
        const dbEntry = fxParamsDb[hexId];
        if (!dbEntry) return;

        const tapParamIdx = dbEntry.tapParamIdx;
        if (tapParamIdx === undefined || tapParamIdx === null) return;

        let finalValue = 0;
        
        if (fx.tap === 'Time') {
            // Encode de 14-bit direto para delays: ms lido diretamente de 1 a 3999ms. >= 4000 é tempo rítmico.
            const ms = Math.round(60000 / bpm);
            finalValue = Math.min(3999, Math.max(1, ms)); 
        } else if (fx.tap === 'Rate') {
            // Envia Rate dependendo da calibração guardada (ex: Hz * fator)
            const hz = bpm / 60;
            const fallbackScale = 30; // 1Hz = 30 escala (estimado)
            const fxScale = scales[hexId] || fallbackScale;
            finalValue = Math.round(hz * fxScale);
            finalValue = Math.min(127, Math.max(0, finalValue)); // Assumindo limites de range comuns de modulação
        } else {
            return;
        }

        // 14-bit split
        const valLo = finalValue & 0x7F;
        const valHi = (finalValue >> 7) & 0x7F;

        sendRaw([
            0xF0, ZOOM_MFR, ZOOM_DEV, ZOOM_MODEL, CMD_PARAM,
            fx.slotIdx, tapParamIdx, valLo, valHi, 0xF7
        ], true);
    });
}

function processTap() {
    const now = performance.now();
    
    if (tapHistory.length > 0) {
        if (now - tapHistory[tapHistory.length - 1] > TAP_TIMEOUT) {
            tapHistory.length = 0; // Reset
        }
    }
    
    tapHistory.push(now);
    if (tapHistory.length > 5) tapHistory.shift(); // Media das ultimas 4 batidas (5 timestamps)

    if (tapHistory.length >= 2) {
        let sum = 0;
        for (let i = 1; i < tapHistory.length; i++) {
            sum += (tapHistory[i] - tapHistory[i - 1]);
        }
        const avgMs = sum / (tapHistory.length - 1);
        currentBpm = Math.round(60000 / avgMs);
        
        // Limite para evitar valores sem sentido
        currentBpm = Math.min(250, Math.max(40, currentBpm));
        
        window.dispatchEvent(new CustomEvent('fmc-bpm-update', { detail: currentBpm }));
        sendTapSync(currentBpm);
    }
}

// Hook de FS
window.addEventListener('fmc-tap-press', () => {
    processTap();
});
