/**
 * storage/settings_storage.js
 * Persistência das preferências e configurações do editor
 *
 * Arquivo LittleFS: g1on/settings.json
 *
 * Preferências disponíveis:
 *   realtimeSend   : bool   - envia parâmetros em tempo real (default: true)
 *   confirmDelete  : bool   - confirma antes de remover efeito (default: true)
 *   autoSave       : bool   - salva automaticamente ao trocar de patch
 *   tapWindowSize  : int    - tamanho da janela de taps para média (4–16)
 *   lastPatchIndex : int    - último patch selecionado (restaurado no boot)
 *   theme          : string - tema visual ('dark' | 'oled')
 *   sysexLogMaxLines: int   - máximo de linhas no log SysEx
 */

const SETTINGS_KEY = 'g1on/settings.json';

const DEFAULTS = {
  realtimeSend:     true,
  confirmDelete:    false,
  autoSave:         false,
  tapWindowSize:    8,
  lastPatchIndex:   0,
  theme:            'dark',
  sysexLogMaxLines: 200,
};

let _cache = null;

// ── Internal ──────────────────────────────────────────────────────────────────

function _load() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    return raw ? { ...DEFAULTS, ...JSON.parse(raw) } : { ...DEFAULTS };
  } catch {
    return { ...DEFAULTS };
  }
}

function _save(settings) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch (e) {
    console.error('[settings] Erro ao salvar:', e);
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Retorna todas as configurações atuais.
 * @returns {Object}
 */
export function getSettings() {
  if (!_cache) _cache = _load();
  return _cache;
}

/**
 * Retorna valor de uma configuração específica.
 * @param {string} key
 * @returns {*}
 */
export function getSetting(key) {
  return getSettings()[key] ?? DEFAULTS[key];
}

/**
 * Atualiza uma ou mais configurações.
 * @param {Object} updates - chaves/valores a atualizar
 */
export function setSettings(updates) {
  _cache = { ...(getSettings()), ...updates };
  _save(_cache);
}

/**
 * Atualiza uma única configuração.
 * @param {string} key
 * @param {*}      value
 */
export function setSetting(key, value) {
  setSettings({ [key]: value });
}

/**
 * Reseta todas as configurações para o padrão.
 */
export function resetSettings() {
  _cache = { ...DEFAULTS };
  _save(_cache);
}

export { DEFAULTS };
