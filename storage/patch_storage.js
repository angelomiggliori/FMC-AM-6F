/**
 * storage/patch_storage.js
 * Camada de persistência de patches — simula LittleFS com JSON
 *
 * Organização dos arquivos (namespace no localStorage):
 *
 *   g1on/meta.json          → metadados do banco (versão, timestamp, total)
 *   g1on/patch_000.json     → patch slot 0
 *   g1on/patch_001.json     → patch slot 1
 *   ...
 *   g1on/patch_099.json     → patch slot 99
 *
 * Em hardware com LittleFS real (ESP32/RP2040):
 *   Substitua as funções _fsRead / _fsWrite pelos equivalentes
 *   da API LittleFS do seu framework (Arduino, ESP-IDF, etc).
 *   A interface pública permanece idêntica.
 */

const FS_PREFIX  = 'g1on/';
const META_KEY   = `${FS_PREFIX}meta.json`;
const SCHEMA_VER = 1;

// ── LittleFS Shim (localStorage) ─────────────────────────────────────────────

/**
 * Lê arquivo do "LittleFS" (localStorage).
 * @param {string} path - caminho relativo (ex: 'patch_000.json')
 * @returns {Object|null} objeto JSON ou null se não encontrado
 */
function _fsRead(path) {
  try {
    const raw = localStorage.getItem(FS_PREFIX + path);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    console.error(`[storage] Erro ao ler ${path}:`, e);
    return null;
  }
}

/**
 * Escreve objeto JSON no "LittleFS" (localStorage).
 * @param {string} path   - caminho relativo
 * @param {Object} data   - objeto a serializar
 * @returns {boolean} sucesso
 */
function _fsWrite(path, data) {
  try {
    localStorage.setItem(FS_PREFIX + path, JSON.stringify(data));
    return true;
  } catch (e) {
    console.error(`[storage] Erro ao escrever ${path}:`, e);
    return false;
  }
}

/**
 * Remove arquivo do "LittleFS".
 * @param {string} path
 */
function _fsDelete(path) {
  localStorage.removeItem(FS_PREFIX + path);
}

/**
 * Lista todos os arquivos com determinado prefixo.
 * @param {string} prefix
 * @returns {string[]} paths relativos
 */
function _fsList(prefix) {
  const results = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && key.startsWith(FS_PREFIX + prefix)) {
      results.push(key.replace(FS_PREFIX, ''));
    }
  }
  return results.sort();
}

// ── Metadata ──────────────────────────────────────────────────────────────────

function _readMeta() {
  return _fsRead('meta.json') || {
    schema:    SCHEMA_VER,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    count:     0,
  };
}

function _writeMeta(count) {
  _fsWrite('meta.json', {
    schema:    SCHEMA_VER,
    createdAt: _readMeta().createdAt,
    updatedAt: new Date().toISOString(),
    count,
  });
}

// ── Patch File Path ───────────────────────────────────────────────────────────

function _patchPath(slot) {
  return `patch_${String(slot).padStart(3, '0')}.json`;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Verifica se há dados salvos no LittleFS.
 * @returns {boolean}
 */
export function hasStoredData() {
  const meta = _fsRead('meta.json');
  return meta !== null && meta.count > 0;
}

/**
 * Salva um único patch no LittleFS.
 * @param {Object} patch - objeto patch
 * @returns {boolean} sucesso
 */
export function savePatch(patch) {
  const path = _patchPath(patch.slot);
  const ok   = _fsWrite(path, {
    slot:      patch.slot,
    name:      patch.name,
    savedAt:   new Date().toISOString(),
    effects:   patch.effects,
  });

  if (ok) {
    const meta  = _readMeta();
    const count = Math.max(meta.count, patch.slot + 1);
    _writeMeta(count);
  }

  return ok;
}

/**
 * Lê um único patch do LittleFS.
 * @param {number} slot
 * @returns {Object|null}
 */
export function loadPatch(slot) {
  const data = _fsRead(_patchPath(slot));
  if (!data) return null;
  return {
    slot:    data.slot ?? slot,
    name:    data.name ?? `PATCH${slot}`,
    effects: data.effects ?? [null, null, null, null, null],
    dirty:   false,
  };
}

/**
 * Salva o banco completo de patches (todos os slots).
 * @param {Object[]} patches - array de 100 patches
 * @returns {number} quantidade de patches salvos com sucesso
 */
export function savePatchBank(patches) {
  let saved = 0;
  for (const patch of patches) {
    if (savePatch(patch)) saved++;
  }
  _writeMeta(patches.length);
  return saved;
}

/**
 * Carrega o banco completo do LittleFS.
 * Slots não encontrados retornam patch vazio.
 * @param {number} total - total de slots a carregar (padrão 100)
 * @returns {Object[]} array de patches
 */
export function loadPatchBank(total = 100) {
  const bank = [];
  for (let i = 0; i < total; i++) {
    const patch = loadPatch(i);
    if (patch) {
      bank.push(patch);
    } else {
      bank.push({
        slot:    i,
        name:    `INIT${String(i).padStart(2, '0')}`,
        effects: [null, null, null, null, null],
        dirty:   false,
      });
    }
  }
  return bank;
}

/**
 * Remove patch do LittleFS.
 * @param {number} slot
 */
export function deletePatch(slot) {
  _fsDelete(_patchPath(slot));
}

/**
 * Remove todos os dados salvos (reset de fábrica).
 */
export function clearAllStorage() {
  const keys = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && key.startsWith(FS_PREFIX)) keys.push(key);
  }
  keys.forEach(k => localStorage.removeItem(k));
}

/**
 * Retorna estatísticas do storage atual.
 * @returns {Object}
 */
export function getStorageStats() {
  const meta  = _readMeta();
  const files = _fsList('patch_');
  let   totalBytes = 0;
  for (const f of files) {
    const raw = localStorage.getItem(FS_PREFIX + f);
    if (raw) totalBytes += raw.length * 2; // UTF-16
  }
  return {
    schema:     meta.schema,
    patchCount: files.length,
    updatedAt:  meta.updatedAt,
    totalBytes,
    totalKB:    (totalBytes / 1024).toFixed(1),
  };
}

/**
 * Exporta banco completo como JSON para download.
 * @param {Object[]} patches
 * @returns {string} JSON string
 */
export function exportBankJSON(patches) {
  return JSON.stringify({
    schema:    SCHEMA_VER,
    device:    'Zoom G1on / G1Xon',
    exportedAt: new Date().toISOString(),
    patches,
  }, null, 2);
}

/**
 * Importa banco a partir de JSON exportado.
 * @param {string} jsonStr
 * @returns {Object[]|null} patches ou null se inválido
 */
export function importBankJSON(jsonStr) {
  try {
    const data = JSON.parse(jsonStr);
    if (!data.patches || !Array.isArray(data.patches)) return null;
    return data.patches.map((p, i) => ({
      slot:    p.slot ?? i,
      name:    (p.name || `PATCH${i}`).substring(0, 10).toUpperCase(),
      effects: p.effects ?? [null, null, null, null, null],
      dirty:   false,
    }));
  } catch (e) {
    console.error('[storage] Erro ao importar JSON:', e);
    return null;
  }
}
