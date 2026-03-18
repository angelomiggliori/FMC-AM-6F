// engine/tap-engine.js
import { sendRaw, writePatchDump, ZOOM_MFR, ZOOM_DEV, ZOOM_MODEL, CMD_PARAM } from './midi-core.js';
import { patchAtual, tapRawDump, unpack7bitStream, pack7bit } from './patch-manager.js';
import { LocalDB } from '../data/data-manager.js';

export let fxParamsDb = {}; // Preenchido remotamente na inicialização
const tapHistory = [];
export let currentBpm = 120;

const TAP_TIMEOUT = 2000;

export function loadFxParamsDb(db) {
    fxParamsDb = db || {};
}

const TAP_CAL_DELAY = [
  {ms:    1, id: 0x0800},
  {ms:  100, id: 0x2818},
  {ms:  500, id: 0x287C},
  {ms: 1000, id: 0x2879},
  {ms: 2000, id: 0x2873},
  {ms: 4000, id: 0x2867},
];

function tapCalInterp(ms) {
    const t = TAP_CAL_DELAY;
    if (ms <= t[0].ms) return t[0].id;
    if (ms >= t[t.length-1].ms) return t[t.length-1].id;
    for (let i = 0; i < t.length - 1; i++) {
        if (ms >= t[i].ms && ms <= t[i+1].ms) {
            const frac = (ms - t[i].ms) / (t[i+1].ms - t[i].ms);
            return Math.round(t[i].id + frac * (t[i+1].id - t[i].id));
        }
    }
    return t[0].id;
}

function tapRebuildDump(slotIdx, newId) {
    if (!tapRawDump || tapRawDump.length !== 134) return null;
    const up = unpack7bitStream(tapRawDump, 5);
    const newUp = Array.from(up);
    const off = slotIdx * 18;
    if (off + 5 >= newUp.length) return null;

    const new_hi = (newId >> 7) & 0x7F;
    const new_lo = newId & 0x7F;
    const en = (newUp[off+3] >> 7) & 1;  // preserva enabled

    newUp[off+3] = (en << 7) | new_hi;
    newUp[off+4] = new_lo;
    // rawSlot[5] (r2) preservado
    
    // Zera os parametros (Time/Delay params) pra nao conflitar com a logica do G1On
    // Porem a eng. reversa diz que o tempo É o ID, manter o resto igual
    
    const repacked = pack7bit(newUp);
    const newRaw = Array.from(tapRawDump);
    for (let i = 0; i < repacked.length && (5+i) < 110; i++) {
        newRaw[5+i] = repacked[i];
    }
    return new Uint8Array(newRaw);
}

function tapRebuildParamDump(slotIdx, paramIdx, valLo, valHi) {
    if (!tapRawDump || tapRawDump.length !== 134) return null;
    const up = unpack7bitStream(tapRawDump, 5);
    const newUp = Array.from(up);
    const off = slotIdx * 18;
    if (off + 5 >= newUp.length) return null;

    // Parameters start at offset 6 in the unpacked slot. paramIdx is 1-indexed.
    const pOff = off + 6 + (paramIdx - 1) * 2;
    if (pOff + 1 < newUp.length) {
        newUp[pOff] = valLo;
        newUp[pOff + 1] = valHi;
    }
    
    const repacked = pack7bit(newUp);
    const newRaw = Array.from(tapRawDump);
    const maxI = Math.min(repacked.length, 105);
    for (let i = 0; i < maxI; i++) {
        if (5+i < 110) newRaw[5+i] = repacked[i];
    }
    return new Uint8Array(newRaw);
}

async function sendTapSync(bpm) {
    const scales = (await LocalDB.read('tap-scales')) || {};
    
    // Busca na chain efeitos habilitados para Tap
    patchAtual.efeitos.forEach(fx => {
        if (!fx.enabled) return;

        const hexId = '0x' + fx.id.toString(16).toUpperCase().padStart(4, '0');
        // Identifica pela marca da familia caso n tenha db map
        if (fx.tap === 'Time' || hexId.startsWith('0x08') || hexId.startsWith('0x28')) {
            // Usa Tabela de Calibração com Write 0x28 puro
            const msAlvo = Math.max(1, Math.min(4000, Math.round(60000 / bpm)));
            const newId  = tapCalInterp(msAlvo);
            const newDump = tapRebuildDump(fx.slotIdx, newId);
            
            if (newDump) {
                writePatchDump(newDump);
                // Atualiza em memoria pq writePatchDump substitui por cima sem PC reload
                for (let i=0; i<134; i++) tapRawDump[i] = newDump[i];
                fx.id = newId; // atualiza o ref de ID do slot em RAM tbm
            }
        } 
        else if (fx.tap === 'Rate') {
            // Modulações agora usam o Write 0x28 puro (Igualzinho ao Delay)
            const dbEntry = fxParamsDb[hexId];
            if (!dbEntry || dbEntry.tapParamIdx == null) return;
            
            const hz = bpm / 60;
            const fallbackScale = 30; // 1Hz ~= 30 scala
            const fxScale = scales[hexId] || fallbackScale;
            let finalValue = Math.round(hz * fxScale);
            // Não temos o MAX exato via DUMP, entao limitamos ao limite tradicional se nao houver scale
            finalValue = Math.min(127, Math.max(0, finalValue));

            const valLo = finalValue & 0x7F;
            const valHi = (finalValue >> 7) & 0x7F;

            const newDump = tapRebuildParamDump(fx.slotIdx, dbEntry.tapParamIdx, valLo, valHi);
            if (newDump) {
                writePatchDump(newDump);
                for (let i=0; i<134; i++) tapRawDump[i] = newDump[i];
            }
        }
    });
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

// Hook de FS
window.addEventListener('fmc-tap-press', () => {
    processTap();
});
