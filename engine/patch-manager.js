// engine/patch-manager.js
import { sendRaw, on, ZOOM_MFR, ZOOM_DEV, ZOOM_MODEL, CMD_DUMP_REQ } from './midi-core.js';

export let patchAtual = { nome: null, volume: null, efeitos: [] };
export let fxDb = {}; // Preenchido remotamente na inicialização

// Tabela de categorias por faixa de id2 (padrões confirmados por dumps reais)
// O byte baixo do id2 contém o tipo do efeito quando &0x1E
const CATEGORY_BY_TYPE = {
    0x02: 'dynamics',
    0x04: 'filter',
    0x06: 'drive',
    0x08: 'amp',
    0x0C: 'mod',
    0x0E: 'special',
    0x10: 'delay',
    0x12: 'reverb',
};

// Tap type por categoria
const TAP_BY_CAT = {
    'delay': 'Time',
    'mod': 'Rate',
};

// Max values padrão do tap por categoria
const TAP_MAX = {
    'delay': 4095,  // 12-bit, ~2000ms na prática
    'mod': 127,     // 7-bit rate
};

// Escalas padrão para Rate (hz → unidade)
const TAP_SCALE = {
    'mod': 30, // fallback genérico
};

export function loadFxDb(db) {
    fxDb = db || {};
}

// Requisitar Dump
export function requestDump() {
    sendRaw([0xF0, ZOOM_MFR, ZOOM_DEV, ZOOM_MODEL, CMD_DUMP_REQ, 0xF7], true);
}

// Trocar de Patch (PC)
export function changePatch(bankIndex, patchIndex) {
    const pc = bankIndex * 10 + patchIndex;
    sendRaw([0xC0, pc]);
    setTimeout(() => {
        requestDump();
    }, 500);
}

// Unpack 7-bit SysEx payload
export function unpack7bitStream(data, start) {
    const out = [];
    let i = start;
    while (i < data.length - 1) {
        const msbs = data[i++];
        for (let bit = 0; bit < 7; bit++, i++) {
            if (i >= data.length) break;
            out.push(data[i] | (((msbs >> bit) & 1) << 7));
        }
    }
    return out;
}

// Pack 7-bit SysEx payload (Inverso)
export function pack7bit(unpacked) {
    const out = [];
    for (let i = 0; i < unpacked.length; i += 7) {
        const chunk = unpacked.slice(i, i + 7);
        let msbs = 0;
        for (let j = 0; j < chunk.length; j++) if (chunk[j] & 0x80) msbs |= (1 << j);
        out.push(msbs);
        for (let j = 0; j < chunk.length; j++) out.push(chunk[j] & 0x7F);
    }
    return out;
}

function decode7bitNome(data, offset, len) {
    const chars = [];
    let i = offset;
    while (i < offset + len && i < data.length - 1) {
        const msbs = data[i++];
        for (let bit = 0; bit < 7 && i < data.length - 1 && chars.length < 12; bit++, i++) {
            const b = data[i] | (((msbs >> bit) & 1) << 7);
            if (b === 0) continue;
            if (b >= 0x20 && b < 0x7F) chars.push(String.fromCharCode(b));
        }
    }
    return chars.join('').trim();
}

function extrairVolumeDump(rawData) {
    if (!rawData || rawData.length <= 110) return 100;
    const v = rawData[110];
    return (v >= 0 && v <= 150) ? v : 100; // max corrigido pra 150
}

/**
 * Detecta a categoria e o nome do efeito a partir do id2.
 * Usa o fx-db carregado, com fallbacks por padrão de ID.
 */
function identificarEfeito(id2, rawSlot) {
    const hexId = '0x' + id2.toString(16).toUpperCase().padStart(4, '0');
    
    // 1. Lookup direto no fxDb (por hexId)
    if (fxDb[hexId]) {
        return fxDb[hexId];
    }

    // 2. Fallback: detectar Delays pela faixa de ID (0x08xx, 0x28xx)
    if (hexId.startsWith('0x08') || hexId.startsWith('0x28')) {
        return { n: 'DELAY', c: 'delay', t: 'Time' };
    }

    // 3. Fallback: tentar detectar categoria pelo byte baixo do id2
    const typeByte = id2 & 0x1E;
    const cat = CATEGORY_BY_TYPE[typeByte];
    if (cat) {
        const tap = TAP_BY_CAT[cat] || null;
        return { n: cat.toUpperCase(), c: cat, t: tap };
    }

    // 4. Desconhecido
    return { n: `UNK_${hexId}`, c: 'special', t: null };
}

export function parseDumpResponse(data) {
    const info = { nome: '', volume: 100, efeitos: [] };
    info.nome = decode7bitNome(data, 112, 21);
    info.volume = extrairVolumeDump(data);

    const up = unpack7bitStream(data, 5);
    const SLOT_SIZE = 18;

    for (let i = 0; i < 5; i++) {
        const off = i * SLOT_SIZE;
        if (off + 5 >= up.length) break;

        const b3 = up[off + 3];
        const b4 = up[off + 4];
        const id2 = ((b3 & 0x7F) << 7) | (b4 & 0x7F);
        const en = ((b3 >> 7) & 1) === 1;

        if (id2 === 0) continue;

        const rawSlot = up.slice(off, off + SLOT_SIZE);
        const dbFx = identificarEfeito(id2, rawSlot);
        const cat = dbFx.c || 'special';
        const tap = dbFx.t || null;

        info.efeitos.push({
            slot: i + 1,
            id: id2,
            nome: dbFx.n || dbFx.nome || `UNK`,
            cat: cat,
            tap: tap,
            enabled: en,
            rawSlot: Array.from(rawSlot),
            slotIdx: i,
            // Dados extras pro tap-engine
            tapParamIdx: tap ? 0 : null,
            tapMax: tap ? (TAP_MAX[cat] || 127) : null,
            tapScale: tap === 'Rate' ? (TAP_SCALE[cat] || 30) : null,
        });
    }

    patchAtual = info;
    return info;
}

on('message', (data) => {
    if (data[0] === 0xF0 && data[1] === ZOOM_MFR && data[4] === 0x28) {
        const parsed = parseDumpResponse(data);
        window.dispatchEvent(new CustomEvent('fmc-dump-received', { detail: parsed }));
    }
});

// Auto-sincronização no boot
on('connection', (e) => {
    if (e.status === 'g1on_ready') {
        setTimeout(requestDump, 500);
    }
});
