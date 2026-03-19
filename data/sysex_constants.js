/**
 * data/sysex_constants.js
 * Constantes do protocolo MIDI/SysEx da Zoom G1on (Product ID 0x64)
 *
 * Fontes: análise reversa via USB MIDI sniffing + repo SysExTones/g1on
 *
 * Estrutura do SysEx Zoom:
 *   F0  52  00  <DEV>  <CMD>  [dados]  F7
 *    │   │   │    │      └─ comando específico
 *    │   │   │    └─ device ID  (G1on = 0x64)
 *    │   │   └─ sub-ID (sempre 0x00 na série G1on)
 *    │   └─ Zoom manufacturer ID
 *    └─ SysEx start
 */

// ── Identifiers ──────────────────────────────────────────────────────────────
export const ZOOM_MFR_ID   = 0x52;   // Zoom Corporation manufacturer ID
export const ZOOM_SUB_ID   = 0x00;
export const G1ON_DEVICE_ID = 0x64;  // G1on / G1Xon

export const SYSEX_START   = 0xF0;
export const SYSEX_END     = 0xF7;

/** Cabeçalho SysEx padrão para todos os comandos G1on */
export const ZOOM_HEADER = [SYSEX_START, ZOOM_MFR_ID, ZOOM_SUB_ID, G1ON_DEVICE_ID];

// ── Command Bytes ─────────────────────────────────────────────────────────────
export const CMD_BYTE = {
  EDITOR_MODE_ON:   0x50,  // Ativa modo editor (obrigatório antes de editar)
  EDITOR_MODE_OFF:  0x51,  // Desativa modo editor
  PATCH_DUMP_REQ:   0x29,  // Solicita dump do patch atual
  PATCH_UPLOAD:     0x28,  // Envia patch para buffer temporário
  PATCH_SAVE:       0x32,  // Grava patch em slot permanente
  PARAM_CHANGE:     0x31,  // Altera parâmetro em tempo real
  CURRENT_PATCH_REQ:0x33,  // Solicita banco/programa atual
  PATCH_COUNT_REQ:  0x06,  // Solicita número de patches e tamanho
  PATCH_SELECT:     0x09,  // Seleciona patch específico (bank + prog)
};

// ── SysEx Message Builders ───────────────────────────────────────────────────

/**
 * Ativa o modo editor na pedaleira.
 * Deve ser o PRIMEIRO comando enviado ao conectar.
 * @returns {number[]} bytes SysEx completos
 */
export function buildEditorOn() {
  return [...ZOOM_HEADER, CMD_BYTE.EDITOR_MODE_ON, SYSEX_END];
}

/**
 * Desativa o modo editor.
 * Enviar ao desconectar para restaurar operação normal.
 * @returns {number[]}
 */
export function buildEditorOff() {
  return [...ZOOM_HEADER, CMD_BYTE.EDITOR_MODE_OFF, SYSEX_END];
}

/**
 * Solicita dump do patch atualmente carregado na pedaleira.
 * A resposta chega com CMD_BYTE 0x28 (mesmo byte de upload).
 * @returns {number[]}
 */
export function buildPatchDumpRequest() {
  return [...ZOOM_HEADER, CMD_BYTE.PATCH_DUMP_REQ, SYSEX_END];
}

/**
 * Envia dados de patch para o buffer de edição temporário.
 * Não salva permanentemente — use buildPatchSave() para isso.
 * @param {number[]} packedData - bytes 7-bit packed do patch
 * @returns {number[]}
 */
export function buildPatchUpload(packedData) {
  return [...ZOOM_HEADER, CMD_BYTE.PATCH_UPLOAD, ...packedData, SYSEX_END];
}

/**
 * Grava o patch atual no slot permanente especificado.
 * @param {number} slotIndex - slot de destino (0–99)
 * @returns {number[]}
 */
export function buildPatchSave(slotIndex) {
  return [
    ...ZOOM_HEADER,
    CMD_BYTE.PATCH_SAVE,
    0x01, 0x00, 0x00,
    slotIndex & 0x7F,
    0x00, 0x00, 0x00, 0x00, 0x00,
    SYSEX_END,
  ];
}

/**
 * Altera um parâmetro de efeito em tempo real.
 * Atualização imediata no som sem precisar enviar patch completo.
 *
 * @param {number} fxSlot   - slot do efeito na cadeia (0–4)
 * @param {number} paramIdx - índice do parâmetro (0 = on/off, 1–8 = knobs)
 * @param {number} value    - valor 0–127 (ou 0–16383 para 14-bit)
 * @returns {number[]}
 */
export function buildParamChange(fxSlot, paramIdx, value) {
  return [
    ...ZOOM_HEADER,
    CMD_BYTE.PARAM_CHANGE,
    fxSlot   & 0x7F,
    paramIdx & 0x7F,
    value    & 0x7F,          // LSB 7 bits
    (value >> 7) & 0x7F,      // MSB 7 bits
    SYSEX_END,
  ];
}

/**
 * Seleciona patch por banco e programa.
 * @param {number} bank - banco (0 = primeiro banco)
 * @param {number} prog - programa dentro do banco (0–based)
 * @returns {number[]}
 */
export function buildPatchSelect(bank, prog) {
  return [
    ...ZOOM_HEADER,
    CMD_BYTE.PATCH_SELECT,
    0x00,
    bank & 0x7F,
    prog & 0x7F,
    SYSEX_END,
  ];
}

/**
 * Program Change MIDI padrão (canal 1) para trocar de patch.
 * Alternativa simpler ao buildPatchSelect.
 * @param {number} slotIndex - slot 0–99
 * @returns {number[]}
 */
export function buildProgramChange(slotIndex) {
  return [0xC0, slotIndex & 0x7F];
}

/**
 * Solicita número total de patches e tamanho do patch.
 * @returns {number[]}
 */
export function buildPatchCountRequest() {
  return [...ZOOM_HEADER, CMD_BYTE.PATCH_COUNT_REQ, SYSEX_END];
}

/**
 * Universal Device Identity Request (SysEx padrão MIDI).
 * A resposta confirma que é um Zoom G1on (byte 6 = 0x64).
 * @returns {number[]}
 */
export function buildIdentityRequest() {
  return [SYSEX_START, 0x7E, 0x00, 0x06, 0x01, SYSEX_END];
}

// ── Response Parsers ─────────────────────────────────────────────────────────

/**
 * Verifica se uma mensagem recebida é uma resposta SysEx do G1on.
 * @param {number[]} data
 * @returns {boolean}
 */
export function isZoomG1onSysex(data) {
  return (
    data.length >= 5 &&
    data[0] === SYSEX_START &&
    data[1] === ZOOM_MFR_ID &&
    data[2] === ZOOM_SUB_ID &&
    data[3] === G1ON_DEVICE_ID
  );
}

/**
 * Verifica se é uma resposta de Identity Request válida para G1on.
 * @param {number[]} data
 * @returns {boolean}
 */
export function isIdentityResponse(data) {
  return (
    data.length >= 7 &&
    data[0] === SYSEX_START &&
    data[1] === 0x7E &&
    data[3] === 0x06 &&
    data[4] === 0x02 &&
    data[5] === ZOOM_MFR_ID &&
    data[6] === G1ON_DEVICE_ID
  );
}

/**
 * Extrai o command byte de uma mensagem SysEx G1on.
 * @param {number[]} data
 * @returns {number} command byte
 */
export function extractCommandByte(data) {
  return data[4];
}
