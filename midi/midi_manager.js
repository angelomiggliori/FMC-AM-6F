/**
 * midi/midi_manager.js
 * Gerenciamento de conexão Web MIDI API e roteamento de mensagens
 *
 * Responsabilidades:
 *  - Solicitar acesso Web MIDI com SysEx
 *  - Listar e popular seletores de portas
 *  - Conectar input/output selecionados
 *  - Enviar mensagens MIDI / SysEx
 *  - Rotear mensagens recebidas para os handlers corretos
 */

import { state } from '../engine/state_manager.js';
import {
  buildEditorOn,
  buildEditorOff,
  buildPatchDumpRequest,
  buildPatchUpload,
  buildPatchSave,
  buildParamChange,
  buildPatchSelect,
  buildProgramChange,
  buildIdentityRequest,
  isZoomG1onSysex,
  isIdentityResponse,
  extractCommandByte,
  CMD_BYTE,
} from '../data/sysex_constants.js';
import { decodePatch }     from '../engine/patch_codec.js';
import { encodePatch }     from '../engine/patch_codec.js';
import { sysexLog }        from '../ui/sysex_log.js';
import { notify }          from '../ui/notifications.js';

let _midiAccess = null;

// ── Init ──────────────────────────────────────────────────────────────────────

/**
 * Inicializa o acesso Web MIDI.
 * Deve ser chamado uma vez no boot da aplicação.
 */
export async function initMidi() {
  if (!navigator.requestMIDIAccess) {
    state.setMidiStatus(false, 'WEB MIDI INDISPONÍVEL');
    notify('Web MIDI API não suportada neste browser', 'err');
    return;
  }

  try {
    _midiAccess = await navigator.requestMIDIAccess({ sysex: true });
    _midiAccess.onstatechange = () => refreshPorts();
    refreshPorts();
    state.setMidiStatus(false, 'MIDI PRONTO');
  } catch (e) {
    state.setMidiStatus(false, 'ACESSO NEGADO');
    notify('Acesso MIDI negado: ' + e.message, 'err');
  }
}

// ── Port Management ───────────────────────────────────────────────────────────

/**
 * Popula os <select> de input/output com as portas disponíveis.
 * Auto-seleciona portas Zoom se detectadas.
 */
export function refreshPorts() {
  if (!_midiAccess) return;

  const inSel  = document.getElementById('midiInputSel');
  const outSel = document.getElementById('midiOutputSel');
  if (!inSel || !outSel) return;

  const prevIn  = inSel.value;
  const prevOut = outSel.value;

  inSel.innerHTML  = '<option value="">— MIDI IN —</option>';
  outSel.innerHTML = '<option value="">— MIDI OUT —</option>';

  _midiAccess.inputs.forEach((port, id) => {
    const opt = document.createElement('option');
    opt.value = id;
    opt.textContent = port.name;
    if (id === prevIn) opt.selected = true;
    inSel.appendChild(opt);
  });

  _midiAccess.outputs.forEach((port, id) => {
    const opt = document.createElement('option');
    opt.value = id;
    opt.textContent = port.name;
    if (id === prevOut) opt.selected = true;
    outSel.appendChild(opt);
  });

  // Auto-selecionar porta Zoom
  _autoSelectZoomPort(inSel);
  _autoSelectZoomPort(outSel);
}

function _autoSelectZoomPort(selectEl) {
  if (selectEl.value) return; // já tem seleção
  for (const opt of selectEl.options) {
    const n = opt.textContent.toLowerCase();
    if (n.includes('zoom') || n.includes('g1') || n.includes('g-1')) {
      opt.selected = true;
      break;
    }
  }
}

// ── Connect ───────────────────────────────────────────────────────────────────

/**
 * Conecta nas portas selecionadas e ativa o modo editor.
 */
export function connectMidi() {
  if (!_midiAccess) { notify('MIDI não inicializado', 'err'); return; }

  const inId  = document.getElementById('midiInputSel')?.value;
  const outId = document.getElementById('midiOutputSel')?.value;

  if (!inId || !outId) { notify('Selecione as portas MIDI', 'err'); return; }

  const input  = _midiAccess.inputs.get(inId);
  const output = _midiAccess.outputs.get(outId);

  if (!input || !output) { notify('Porta não encontrada', 'err'); return; }

  // Desconectar anterior se houver
  if (state.midi.input) state.midi.input.onmidimessage = null;

  input.onmidimessage = _onMidiMessage;

  state.setMidiStatus(true, output.name.substring(0, 20), input, output);

  // Enviar Editor Mode ON + Identity Request
  sendRaw(buildEditorOn());
  sendRaw(buildIdentityRequest());

  notify('Conectado: ' + output.name.substring(0, 20), 'ok');
}

/**
 * Desconecta e envia Editor Mode OFF.
 */
export function disconnectMidi() {
  if (state.midi.output) sendRaw(buildEditorOff());
  if (state.midi.input)  state.midi.input.onmidimessage = null;
  state.setMidiStatus(false, 'DESCONECTADO');
  notify('MIDI desconectado', 'info');
}

// ── Send Operations ───────────────────────────────────────────────────────────

/**
 * Envia bytes MIDI brutos pela porta de saída.
 * @param {number[]} bytes
 * @returns {boolean} sucesso
 */
export function sendRaw(bytes) {
  const output = state.midi.output;
  if (!output) return false;
  try {
    output.send(bytes);
    sysexLog.addEntry('TX', bytes);
    return true;
  } catch (e) {
    notify('Erro MIDI TX: ' + e.message, 'err');
    return false;
  }
}

/** Solicita dump do patch atual da pedaleira */
export function requestCurrentPatch() {
  if (!sendRaw(buildPatchDumpRequest())) {
    notify('Sem conexão MIDI', 'err');
  }
}

/**
 * Envia o patch atual para o buffer de edição da pedaleira.
 * @param {Object} patch
 */
export function sendPatch(patch) {
  const packed = encodePatch(patch);
  sendRaw(buildPatchUpload(packed));
}

/**
 * Salva o patch atual no slot permanente.
 * @param {number} slotIndex
 */
export function savePatchToSlot(slotIndex) {
  sendRaw(buildPatchSave(slotIndex));
}

/**
 * Envia alteração de parâmetro em tempo real.
 * @param {number} fxSlot
 * @param {number} paramIdx
 * @param {number} value
 */
export function sendParamChange(fxSlot, paramIdx, value) {
  sendRaw(buildParamChange(fxSlot, paramIdx, value));
}

/**
 * Envia Program Change para selecionar patch na pedaleira.
 * @param {number} slotIndex
 */
export function selectPatchOnDevice(slotIndex) {
  sendRaw(buildProgramChange(slotIndex));
}

// ── Receive ───────────────────────────────────────────────────────────────────

function _onMidiMessage(e) {
  const data = Array.from(e.data);
  sysexLog.addEntry('RX', data);

  if (data[0] === 0xF0) {
    if (isIdentityResponse(data)) {
      _handleIdentityResponse(data);
    } else if (isZoomG1onSysex(data)) {
      _handleZoomSysex(data);
    }
  }
}

function _handleIdentityResponse(data) {
  notify('G1on identificado ✓', 'ok');
}

function _handleZoomSysex(data) {
  const cmd  = extractCommandByte(data);
  const body = data.slice(5, -1); // remove header (5 bytes) e F7

  switch (cmd) {
    case CMD_BYTE.PATCH_UPLOAD: {
      // Resposta de dump de patch
      const patch = decodePatch(body, state.currentIndex);
      if (patch) {
        state.setPatch(state.currentIndex, patch);
        notify('Patch recebido: ' + patch.name, 'ok');
      }
      break;
    }

    case CMD_BYTE.PARAM_CHANGE: {
      // Notificação de mudança de parâmetro (knob girado na pedaleira)
      if (body.length >= 4) {
        const slot  = body[0];
        const param = body[1];
        const val   = body[2] | (body[3] << 7);
        if (param === 0) {
          state.toggleEffect(slot); // on/off
        } else {
          state.setParam(slot, param - 1, val & 0x7F);
        }
      }
      break;
    }

    default:
      // Outros comandos — logar apenas
      break;
  }
}
