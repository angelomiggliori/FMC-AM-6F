// engine/patch-manager.js
import { sendRaw, on, ZOOM_MFR, ZOOM_DEV, ZOOM_MODEL, CMD_DUMP_REQ } from './midi-core.js';
import { LocalDB } from '../data/data-manager.js';

export let patchAtual = { nome: null, volume: null, efeitos: [] };
export let fxDb = {}; // Preenchido remotamente na inicialização
export let tapRawDump = new Uint8Array(134); // Armazena o dump original para reescrita via SysEx 0x28

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
    return (v >= 0 && v <= 120) ? v : 100;
}

export function parseDumpResponse(data) {
    if (data.length === 134) {
        // Armazena copia do dump bruto para reescrita tap/signal-chain
        tapRawDump = new Uint8Array(data);
    }

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
        
        // CORREÇÃO: enabled fica no bit 7 do rawSlot[3] (byte b3 antes de aplicar mascara)
        const en = ((b3 >> 7) & 1) === 1;

        if (id2 === 0) continue; // Skip incondicional para slot vazio

        let dbFx = fxDb[hexId];
        // O G1On codifica o tempo do delay no proprio ID (variando de 0x0800 a 0x08FF e 0x2800 a 0x28FF)
        if (!dbFx && (hexId.startsWith('0x08') || hexId.startsWith('0x28'))) {
            dbFx = { n: 'DELAY', c: 'delay', t: 'Time' };
        }
        if (!dbFx) dbFx = { n: `UNK_${hexId}`, c: 'special', t: null };

        const rawSlot = up.slice(off, off + SLOT_SIZE);
        info.efeitos.push({
            slot: i + 1,
            id: id2,
            nome: dbFx.n || dbFx.nome,
            cat: dbFx.c || dbFx.cat,
            tap: dbFx.t || dbFx.tap,
            enabled: en,
            rawSlot: Array.from(rawSlot), // guarda no formato Array mutavel
            slotIdx: i
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
