/**
 * engine/midi-core.js
 * Conexão, Handshake, Watchdog e fila de envio.
 */

// Constantes confirmadas da G1On
export const ZOOM_MFR = 0x52;
export const ZOOM_DEV = 0x00;
export const ZOOM_MODEL = 0x63;
export const CMD_EDIT_ON = 0x50;
export const CMD_EDIT_OFF = 0x51;
export const CMD_DUMP_REQ = 0x29;
export const CMD_DUMP_RES = 0x28;
export const CMD_PARAM = 0x31;

const SYSEX_IDLE_MS = 50;
const SYSEX_DELAY_MS = 80;
const WATCHDOG_MS = 240000;

export let midiIn = null;
export let midiOut = null;
export let editorOpen = false;

let sendQueue = [];
let isSending = false;
let watchdogTimer = null;
let lastSysExTime = 0;

export const state = {
    connected: false,
    pingOk: false
};

const listeners = {
    message: [],
    connection: []
};

// Event emitter simples
export function on(event, callback) {
    if (listeners[event]) listeners[event].push(callback);
}
function emit(event, data) {
    if (listeners[event]) listeners[event].forEach(cb => cb(data));
}

// Watchdog: reabre editor a cada 4 min
function resetWatchdog() {
    if (watchdogTimer) clearTimeout(watchdogTimer);
    watchdogTimer = setTimeout(async () => {
        if (state.connected && editorOpen) {
             console.log('[WATCHDOG] Renovando Editor ON...');
             await forceEditOn();
        }
    }, WATCHDOG_MS);
}

// Sleep
export const sleep = ms => new Promise(r => setTimeout(r, ms));

async function processQueue() {
    if (isSending || sendQueue.length === 0) return;
    isSending = true;

    while (sendQueue.length > 0) {
        const msg = sendQueue.shift();
        const now = performance.now();
        const timeSinceLast = now - lastSysExTime;
        
        let wait = 0;
        if (msg.isSysEx) {
            // Se ocioso por mais que SYSEX_IDLE, precisa desse idle antes de qualquer SysEx novo;
            // E respeitar SYSEX_DELAY entre mensagens consecutivas.
            const neededWait = Math.max(SYSEX_IDLE_MS, SYSEX_DELAY_MS);
            if (timeSinceLast < neededWait) {
                wait = neededWait - timeSinceLast;
            }
        }
        
        if (wait > 0) await sleep(wait);
        
        try {
            if (midiOut) {
                midiOut.send(msg.data);
                lastSysExTime = performance.now();
                resetWatchdog();
            }
        } catch (e) {
            console.error('Erro envio MIDI', e);
        }
    }
    
    isSending = false;
}

export function sendRaw(data, isSysEx = false) {
    sendQueue.push({ data, isSysEx });
    processQueue();
}

/**
 * Escreve um dump de patch completo de volta na memória (0x28 bidirecional)
 */
export function writePatchDump(rawDump134) {
    if (rawDump134.length !== 134) {
        console.error('Tamanho do dump inválido para escrita:', rawDump134.length);
        return;
    }
    // SysEx puro, sobrescreve o buffer de edição G1On
    sendRaw(rawDump134, true);
}

/**
 * Passo 1: Solicita Identidade
 */
export function requestIdentity() {
    // F0 7E 00 06 01 F7
    sendRaw([0xF0, 0x7E, 0x00, 0x06, 0x01, 0xF7], true);
}

/**
 * Passos 2 e 3: Editor ON + Ping
 */
export async function forceEditOn() {
    sendRaw([0xF0, ZOOM_MFR, ZOOM_DEV, ZOOM_MODEL, CMD_EDIT_ON, 0xF7], true);
    await sleep(SYSEX_DELAY_MS);
    sendRaw([0xF0, ZOOM_MFR, ZOOM_DEV, ZOOM_MODEL, 0x33, 0xF7], true); // Ping obrigatório
    editorOpen = true;
}

export async function connectMIDI() {
    try {
        const access = await navigator.requestMIDIAccess({ sysex: true });
        
        const inputs = Array.from(access.inputs.values());
        const outputs = Array.from(access.outputs.values());
        
        // Simples auto-connect com a porta G1On
        midiIn = inputs.find(i => i.name.toLowerCase().includes('zoom') || i.name.toLowerCase().includes('g1on')) || inputs[0];
        midiOut = outputs.find(o => o.name.toLowerCase().includes('zoom') || o.name.toLowerCase().includes('g1on')) || outputs[0];

        if (!midiIn || !midiOut) {
            throw new Error("Nenhum dispositivo MIDI encontrado.");
        }

        midiIn.onmidimessage = handleIncoming;
        
        state.connected = true;
        emit('connection', { status: 'connected', portName: midiIn.name });
        
        // Iniciar handshake
        requestIdentity();

    } catch (e) {
        emit('connection', { status: 'error', message: e.message });
    }
}

function handleIncoming(e) {
    const data = e.data;
    
    // Tratamento básico Identity Response
    if (data[0] === 0xF0 && data[1] === 0x7E && data[3] === 0x06 && data[4] === 0x02) {
        if (data[5] === ZOOM_MFR && data[6] === ZOOM_MODEL) {
            state.pingOk = true;
            forceEditOn(); // Automaticamente ativa editor
            emit('connection', { status: 'g1on_ready' });
        }
        return;
    }

    emit('message', data);
}

// Global hook for HTML UI
window.conectarMIDI = connectMIDI;
