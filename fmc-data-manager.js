// fmc-data-manager.js — FMC-AM 6F · Data Manager v1.0
// Módulo central de I/O: leitura/gravação de todos os JSONs via GitHub API
// com sistema de redundância (3 backups por arquivo).
//
// USO:
//   Incluir ANTES do fmc-engine.js:
//   <script src="fmc-data-manager.js"></script>
//
// DEPENDÊNCIAS: nenhuma (vanilla JS puro)
//
// FLUXO:
//   1. FMCData.init()         → carrega todos os JSONs do repo
//   2. FMCData.get(key)       → retorna dado em memória
//   3. FMCData.set(key, val)  → atualiza em memória + agenda save
//   4. FMCData.save(key)      → grava no GitHub com rotação de backups
//   5. FMCData.saveAll()      → grava todos os arquivos modificados

'use strict';

const FMCData = (() => {

  // ── Configuração do repo ─────────────────────────────────────
  const REPO_OWNER  = 'angelomiggliori';
  const REPO_NAME   = 'FMC-AM-6F';
  const REPO_BRANCH = 'main';
  const DATA_PATH   = 'data';
  const API_BASE    = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents`;
  const TOKEN_KEY   = 'fmc-github-token';
  const AUTO_SAVE_DELAY = 3000; // ms após última mudança antes de auto-salvar

  // ── Arquivos gerenciados ─────────────────────────────────────
  const FILES = {
    'fx-db':       { path: `${DATA_PATH}/fx-db.json`,       backups: 3 },
    'patch-cache': { path: `${DATA_PATH}/patch-cache.json`, backups: 3 },
    'tap-cache':   { path: `${DATA_PATH}/tap-cache.json`,   backups: 3 },
    'bank-colors': { path: `${DATA_PATH}/bank-colors.json`, backups: 3 },
    'cat-colors':  { path: `${DATA_PATH}/cat-colors.json`,  backups: 3 },
    'led-config':  { path: `${DATA_PATH}/led-config.json`,  backups: 3 },
    'fs-config':   { path: `${DATA_PATH}/fs-config.json`,   backups: 3 },
    'timing':      { path: `${DATA_PATH}/timing.json`,       backups: 3 },
    'boost':       { path: `${DATA_PATH}/boost.json`,        backups: 3 },
    'meta':        { path: `${DATA_PATH}/meta.json`,         backups: 3 },
  };

  // ── Estado interno ───────────────────────────────────────────
  const _data    = {};   // dados em memória: { 'patch-cache': {...}, ... }
  const _shas    = {};   // SHAs do GitHub: { 'data/patch-cache.json': 'abc123' }
  const _dirty   = {};   // arquivos modificados: { 'patch-cache': true }
  const _timers  = {};   // timers de auto-save por arquivo
  let   _token   = null;
  let   _ready   = false;
  let   _onReady = null;
  const _log     = [];

  // ── Logging ──────────────────────────────────────────────────
  function log(level, msg, detail) {
    const entry = { ts: new Date().toISOString(), level, msg, detail };
    _log.push(entry);
    if (_log.length > 200) _log.shift();
    const prefix = level === 'err' ? '❌' : level === 'warn' ? '⚠️' : 'ℹ️';
    console[level === 'err' ? 'error' : 'log'](`[FMCData] ${prefix} ${msg}`, detail || '');
  }

  // ── Token management ─────────────────────────────────────────
  function getToken() {
    if (_token) return _token;
    try { _token = localStorage.getItem(TOKEN_KEY); } catch(e) {}
    return _token;
  }

  function setToken(tok) {
    _token = tok;
    try { localStorage.setItem(TOKEN_KEY, tok); } catch(e) {}
    log('info', 'Token salvo no localStorage');
  }

  function clearToken() {
    _token = null;
    try { localStorage.removeItem(TOKEN_KEY); } catch(e) {}
  }

  function hasToken() { return !!getToken(); }

  // ── Fetch wrapper com auth ───────────────────────────────────
  async function apiFetch(url, options = {}) {
    const tok = getToken();
    const headers = {
      'Accept':       'application/vnd.github.v3+json',
      'Content-Type': 'application/json',
    };
    if (tok) headers['Authorization'] = `token ${tok}`;
    try {
      const res = await fetch(url, { ...options, headers: { ...headers, ...(options.headers||{}) } });
      if (!res.ok) {
        const body = await res.text();
        throw new Error(`HTTP ${res.status}: ${body.substring(0, 200)}`);
      }
      return res;
    } catch(e) {
      log('err', `apiFetch falhou: ${url}`, e.message);
      throw e;
    }
  }

  // ── Lê um arquivo do GitHub ──────────────────────────────────
  async function fetchFile(filePath) {
    const url = `${API_BASE}/${filePath}?ref=${REPO_BRANCH}&t=${Date.now()}`;
    const res = await apiFetch(url);
    const json = await res.json();
    // Salva SHA para updates futuros
    _shas[filePath] = json.sha;
    // Decodifica base64
    const content = atob(json.content.replace(/\n/g, ''));
    return JSON.parse(content);
  }

  // ── Lê com fallback para backups ─────────────────────────────
  async function fetchWithFallback(key) {
    const file = FILES[key];
    if (!file) throw new Error(`Arquivo desconhecido: ${key}`);

    // Tenta primário
    try {
      const data = await fetchFile(file.path);
      log('info', `Carregado: ${file.path}`);
      return data;
    } catch(e) {
      log('warn', `Primário falhou (${key}), tentando backups...`, e.message);
    }

    // Tenta backups 1, 2, 3
    for (let n = 1; n <= file.backups; n++) {
      const bakPath = file.path.replace('.json', `.bak${n}.json`);
      try {
        const data = await fetchFile(bakPath);
        log('warn', `Recuperado do backup ${n}: ${bakPath}`);
        return data;
      } catch(e2) {
        log('warn', `Backup ${n} falhou para ${key}`);
      }
    }

    log('err', `Todos os backups falharam para ${key}`);
    return null;
  }

  // ── Grava um arquivo no GitHub ───────────────────────────────
  async function pushFile(filePath, content, commitMsg) {
    if (!getToken()) {
      log('warn', 'Sem token — salvamento local apenas');
      return false;
    }
    const url = `${API_BASE}/${filePath}`;
    const contentB64 = btoa(unescape(encodeURIComponent(JSON.stringify(content, null, 2))));
    const body = {
      message: commitMsg || `FMC auto-save: ${filePath} ${new Date().toISOString()}`,
      content: contentB64,
      branch:  REPO_BRANCH,
    };
    if (_shas[filePath]) body.sha = _shas[filePath];
    try {
      const res = await apiFetch(url, { method: 'PUT', body: JSON.stringify(body) });
      const json = await res.json();
      // Atualiza SHA com o novo
      _shas[filePath] = json.content?.sha || _shas[filePath];
      log('info', `Salvo no GitHub: ${filePath}`);
      return true;
    } catch(e) {
      log('err', `Falha ao salvar ${filePath}`, e.message);
      return false;
    }
  }

  // ── Rotação de backups ───────────────────────────────────────
  // bak3 ← bak2 ← bak1 ← primário ← novo
  async function rotateBaks(key) {
    const file = FILES[key];
    if (!file) return;
    const n = file.backups;

    // Lê conteúdo atual de cada nível para copiar para o próximo
    for (let i = n; i >= 1; i--) {
      const src  = i === 1 ? file.path : file.path.replace('.json', `.bak${i-1}.json`);
      const dest = file.path.replace('.json', `.bak${i}.json`);
      try {
        const srcData = await fetchFile(src);
        await pushFile(dest, srcData, `FMC backup rotate: ${dest}`);
      } catch(e) {
        // Se src não existe ainda, ignora
      }
    }
  }

  // ── save(key) ─────────────────────────────────────────────────
  async function save(key) {
    const file = FILES[key];
    if (!file) { log('err', `save: chave desconhecida ${key}`); return false; }
    if (!_data[key]) { log('warn', `save: sem dados em memória para ${key}`); return false; }

    log('info', `Salvando ${key}...`);
    // 1. Rotaciona backups antes de sobrescrever o primário
    await rotateBaks(key);
    // 2. Grava primário
    const ok = await pushFile(file.path, _data[key],
      `FMC auto-save: ${key} ${new Date().toISOString().substring(0,19)}`);
    if (ok) {
      _dirty[key] = false;
      // Salva também no localStorage como cache offline
      try { localStorage.setItem(`fmc_data_${key}`, JSON.stringify(_data[key])); } catch(e) {}
    }
    return ok;
  }

  // ── saveAll() ────────────────────────────────────────────────
  async function saveAll() {
    const keys = Object.keys(_dirty).filter(k => _dirty[k]);
    if (!keys.length) { log('info', 'saveAll: nada modificado'); return; }
    log('info', `saveAll: salvando ${keys.join(', ')}`);
    for (const key of keys) await save(key);
  }

  // ── get(key) / set(key, val) ─────────────────────────────────
  function get(key) { return _data[key] || null; }

  function set(key, val, autoSave = true) {
    _data[key] = val;
    _dirty[key] = true;
    // Salva no localStorage imediatamente como fallback offline
    try { localStorage.setItem(`fmc_data_${key}`, JSON.stringify(val)); } catch(e) {}
    if (autoSave) scheduleAutoSave(key);
  }

  // Atualiza um campo dentro de um arquivo
  function patch(key, updater, autoSave = true) {
    const current = _data[key] || {};
    _data[key] = updater(current);
    _dirty[key] = true;
    try { localStorage.setItem(`fmc_data_${key}`, JSON.stringify(_data[key])); } catch(e) {}
    if (autoSave) scheduleAutoSave(key);
  }

  // ── Auto-save com debounce ───────────────────────────────────
  function scheduleAutoSave(key) {
    if (_timers[key]) clearTimeout(_timers[key]);
    _timers[key] = setTimeout(() => {
      if (_dirty[key]) save(key);
    }, AUTO_SAVE_DELAY);
  }

  // ── Lê localStorage como fallback offline ───────────────────
  function loadFromLocalStorage(key) {
    try {
      const raw = localStorage.getItem(`fmc_data_${key}`);
      if (raw) return JSON.parse(raw);
    } catch(e) {}
    return null;
  }

  // ── init() — carrega todos os arquivos ───────────────────────
  async function init(onProgress) {
    log('info', 'FMCData.init() iniciado');
    const keys = Object.keys(FILES);
    let loaded = 0;

    for (const key of keys) {
      let data = null;
      // Tenta GitHub primeiro
      try {
        data = await fetchWithFallback(key);
      } catch(e) {}

      // Fallback: localStorage
      if (!data) {
        data = loadFromLocalStorage(key);
        if (data) log('warn', `${key}: usando cache local (offline?)`);
      }

      if (data) {
        _data[key] = data;
        loaded++;
      } else {
        log('warn', `${key}: não encontrado em nenhuma fonte`);
      }

      if (onProgress) onProgress(key, ++loaded === keys.length, loaded, keys.length);
    }

    _ready = true;
    log('info', `init() completo: ${loaded}/${keys.length} arquivos carregados`);
    if (_onReady) _onReady(_data);
    return _data;
  }

  // ── Helpers de conveniência ──────────────────────────────────

  // Retorna um patch do cache
  function getPatch(bankPatch) {
    const cache = _data['patch-cache'];
    return cache?.patches?.[bankPatch] || null;
  }

  // Grava um patch no cache (e agenda save)
  function setPatch(bankPatch, patchData) {
    patch('patch-cache', d => {
      if (!d.patches) d.patches = {};
      d.patches[bankPatch] = { ...patchData, ts: Date.now() };
      return d;
    });
  }

  // Retorna entry do fx-db por ID numérico
  function getFx(idNum) {
    const db = _data['fx-db'];
    const hex = '0x' + idNum.toString(16).toUpperCase().padStart(4,'0');
    return db?.effects?.[hex] || null;
  }

  // Retorna/grava tap cache
  function getTapCache(idNum) {
    const hex = '0x' + idNum.toString(16).toLowerCase();
    return _data['tap-cache']?.cache?.[hex] || null;
  }

  function setTapCache(idNum, familia, paramIdx, escala, tipo) {
    const hex = '0x' + idNum.toString(16).toLowerCase();
    patch('tap-cache', d => {
      if (!d.cache) d.cache = {};
      d.cache[hex] = { paramIdx, escala, tipo, familia, ts: Date.now() };
      const fkey = 'familia-' + familia;
      if (!d.cache[fkey]) d.cache[fkey] = { paramIdx };
      return d;
    });
  }

  function getTapCacheFamilia(familia) {
    return _data['tap-cache']?.cache?.['familia-' + familia] || null;
  }

  // Retorna cor do banco
  function getBankColor(bank) {
    return _data['bank-colors']?.colors?.[bank] || '#888888';
  }

  // Retorna cor da categoria
  function getCatColor(cat) {
    return _data['cat-colors']?.colors?.[cat] || '#888888';
  }

  // Retorna config de timing
  function getTiming(key) {
    return _data['timing']?.[key];
  }

  // Retorna config de boost
  function getBoost(key) {
    return _data['boost']?.[key];
  }

  // ── Status / diagnóstico ─────────────────────────────────────
  function status() {
    return {
      ready:   _ready,
      hasToken: hasToken(),
      loaded:  Object.keys(_data),
      dirty:   Object.keys(_dirty).filter(k => _dirty[k]),
      logCount: _log.length,
    };
  }

  function getLogs() { return [..._log]; }

  // ── API pública ──────────────────────────────────────────────
  return {
    // Ciclo de vida
    init,
    onReady: (cb) => { _onReady = cb; if (_ready) cb(_data); },

    // CRUD
    get, set, patch,

    // Helpers
    getPatch, setPatch,
    getFx,
    getTapCache, setTapCache, getTapCacheFamilia,
    getBankColor, getCatColor,
    getTiming, getBoost,

    // Persistência
    save, saveAll,

    // Token
    setToken, clearToken, hasToken, getToken,

    // Status
    status, getLogs,

    // Acesso direto (para engine)
    raw: () => _data,
  };

})();

// Torna disponível globalmente
window.FMCData = FMCData;
