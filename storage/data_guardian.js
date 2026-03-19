/**
 * storage/data_guardian.js
 * Sistema de proteção e redundância de dados — G1on Editor
 *
 * ═══════════════════════════════════════════════════════════════
 * CAMADAS DE PROTEÇÃO
 * ═══════════════════════════════════════════════════════════════
 *
 *  1. WAL (Write-Ahead Log)
 *     Antes de qualquer escrita, registra a intenção em
 *     g1on/wal.json. Após confirmação, remove o log.
 *     Na inicialização, detecta gravações interrompidas e recupera.
 *
 *  2. Auto-save com debounce
 *     Toda mutação de parâmetro agenda um save em N ms.
 *     Evita flood de escritas em edições contínuas.
 *
 *  3. Backup rotativo (3 slots)
 *     A cada save confirmado, rotaciona backups:
 *       g1on/backup_a.json  ← mais recente
 *       g1on/backup_b.json  ← anterior
 *       g1on/backup_c.json  ← mais antigo
 *     Nunca apaga o último backup sem ter o próximo pronto.
 *
 *  4. Varredura de consistência periódica
 *     Timer configurável compara checksums do estado em memória
 *     com o que está no LittleFS. Detecta divergências e corrige.
 *
 *  5. Comparação com pedaleira (sync check)
 *     Se conectado via MIDI, solicita dumps periódicos e compara
 *     parâmetro a parâmetro com o cache local. Registra divergências.
 *
 *  6. Snapshot de sessão
 *     Ao iniciar, salva snapshot do estado inicial em
 *     g1on/session_YYYYMMDD_HHMMSS.json (máx 5, rotativa).
 *     Permite "voltar ao início da sessão".
 *
 * ═══════════════════════════════════════════════════════════════
 */

import { savePatch, loadPatch, savePatchBank,
         loadPatchBank }                    from './patch_storage.js';
import { getSetting, setSetting }           from './settings_storage.js';
import { state }                            from '../engine/state_manager.js';
import { clonePatch }                       from '../engine/patch_codec.js';
import { notify }                           from '../ui/notifications.js';

// ── Constantes ────────────────────────────────────────────────────────────────

const FS_PREFIX          = 'g1on/';
const WAL_KEY            = `${FS_PREFIX}wal.json`;
const BACKUP_KEYS        = [
  `${FS_PREFIX}backup_a.json`,
  `${FS_PREFIX}backup_b.json`,
  `${FS_PREFIX}backup_c.json`,
];
const SESSION_PREFIX     = `${FS_PREFIX}session_`;
const MAX_SESSIONS       = 5;

const DEFAULT_CONFIG = {
  autoSaveDebounceMs:    3000,   // ms de inatividade antes de salvar
  consistencyIntervalMs: 30000,  // varredura de consistência a cada 30s
  syncCheckIntervalMs:   60000,  // comparação com pedaleira a cada 60s
  backupOnEveryNSaves:   5,      // backup rotativo a cada N saves
  enabled:               true,
};

// ── Estado interno ────────────────────────────────────────────────────────────

const _g = {
  config:           { ...DEFAULT_CONFIG },
  saveDebounceTimer: null,
  consistencyTimer:  null,
  syncTimer:         null,
  saveCount:         0,
  lastSaveAt:        null,
  lastBackupAt:      null,
  pendingSlots:      new Set(),   // slots com mudanças não salvas
  divergences:       [],          // log de divergências detectadas
  initialized:       false,
  onSendDumpRequest: null,        // injetado por midi_manager
};

// ── LittleFS shim ─────────────────────────────────────────────────────────────

function _fsWrite(key, data) {
  try {
    localStorage.setItem(key, JSON.stringify(data));
    return true;
  } catch (e) {
    console.error('[guardian] fsWrite falhou:', key, e);
    return false;
  }
}

function _fsRead(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function _fsDelete(key) {
  localStorage.removeItem(key);
}

function _fsKeys(prefix) {
  const keys = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && k.startsWith(prefix)) keys.push(k);
  }
  return keys;
}

// ── Checksum simples ──────────────────────────────────────────────────────────

/**
 * Gera checksum rápido de um patch (não criptográfico — apenas para comparação).
 * @param {Object} patch
 * @returns {string}
 */
function _checksum(patch) {
  if (!patch) return '00000000';
  const str = patch.name +
    (patch.effects || []).map(fx =>
      fx ? `${fx.name}:${fx.on?1:0}:${(fx.params||[]).join(',')}` : 'null'
    ).join('|');
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = (h * 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

// ── WAL (Write-Ahead Log) ─────────────────────────────────────────────────────

/**
 * Registra intenção de escrita antes de executar.
 * @param {string} op   - descrição da operação
 * @param {number} slot - slot afetado
 */
function _walBegin(op, slot) {
  _fsWrite(WAL_KEY, {
    op,
    slot,
    startedAt: Date.now(),
    pid: Math.random().toString(36).slice(2),
  });
}

/** Confirma que a escrita foi concluída com sucesso. */
function _walCommit() {
  _fsDelete(WAL_KEY);
}

/**
 * Verifica e recupera gravação interrompida (crash recovery).
 * Chamado no boot antes de qualquer operação.
 */
function _walRecover() {
  const wal = _fsRead(WAL_KEY);
  if (!wal) return;

  const age = Date.now() - (wal.startedAt || 0);
  console.warn(`[guardian] WAL detectado: op="${wal.op}" slot=${wal.slot} age=${age}ms`);

  // Operação tem mais de 10s → provavelmente interrompida
  if (age > 10000) {
    console.warn('[guardian] WAL antigo — tentando recuperar slot', wal.slot);
    const memPatch = state.patches[wal.slot];
    if (memPatch) {
      // Re-salva do estado em memória
      savePatch(memPatch);
      _walCommit();
      console.info('[guardian] Recuperação WAL concluída para slot', wal.slot);
      notify(`Recuperado: slot ${wal.slot} após interrupção`, 'info');
    } else {
      _walCommit(); // Descarta WAL sem dados em memória
    }
  }
  // WAL recente (< 10s) → pode estar em progresso, não interfere
}

// ── Backup Rotativo ───────────────────────────────────────────────────────────

/**
 * Rotaciona os 3 slots de backup: C←B, B←A, A←novo.
 * Nunca destrói o backup anterior sem ter o próximo pronto.
 * @param {Object[]} patches - banco completo
 */
function _rotateBackup(patches) {
  const now = new Date().toISOString();
  const snapshot = {
    schema:    1,
    savedAt:   now,
    checksum:  patches.map((p, i) => ({ slot: i, cs: _checksum(p) })),
    patches,
  };

  // Escreve novo backup em slot temporário primeiro
  const tmpKey = `${FS_PREFIX}backup_tmp.json`;
  if (!_fsWrite(tmpKey, snapshot)) {
    console.error('[guardian] Falha ao escrever backup temporário');
    return false;
  }

  // Rotação: C = B, B = A, A = tmp
  const c = _fsRead(BACKUP_KEYS[1]);
  if (c)  _fsWrite(BACKUP_KEYS[2], c);

  const b = _fsRead(BACKUP_KEYS[0]);
  if (b)  _fsWrite(BACKUP_KEYS[1], b);

  const tmp = _fsRead(tmpKey);
  if (tmp) _fsWrite(BACKUP_KEYS[0], tmp);

  _fsDelete(tmpKey);

  _g.lastBackupAt = now;
  console.info('[guardian] Backup rotacionado em', now);
  return true;
}

/**
 * Restaura banco de patches do backup mais recente disponível.
 * Tenta A → B → C em ordem.
 * @returns {Object[]|null} patches restaurados ou null
 */
export function restoreFromBackup(slot = 0) {
  for (let i = 0; i < BACKUP_KEYS.length; i++) {
    const backup = _fsRead(BACKUP_KEYS[i]);
    if (backup && backup.patches) {
      console.info(`[guardian] Restaurando do backup ${['A','B','C'][i]} (${backup.savedAt})`);
      notify(`Restaurado do backup ${['A','B','C'][i]} — ${backup.savedAt?.slice(0,10)}`, 'ok');
      return backup.patches;
    }
  }
  notify('Nenhum backup disponível', 'err');
  return null;
}

/**
 * Lista os backups disponíveis com metadados.
 * @returns {Array}
 */
export function listBackups() {
  return BACKUP_KEYS.map((key, i) => {
    const b = _fsRead(key);
    return {
      slot:    ['A','B','C'][i],
      key,
      savedAt: b?.savedAt || null,
      count:   b?.patches?.length || 0,
      valid:   !!b?.patches,
    };
  });
}

// ── Snapshot de Sessão ────────────────────────────────────────────────────────

/**
 * Salva snapshot do estado atual com timestamp único.
 * Mantém apenas os últimos MAX_SESSIONS snapshots.
 */
export function saveSessionSnapshot() {
  const ts  = new Date().toISOString().replace(/[:.]/g, '').slice(0, 15);
  const key = `${SESSION_PREFIX}${ts}.json`;

  _fsWrite(key, {
    savedAt:  new Date().toISOString(),
    patches:  state.patches.map(clonePatch),
  });

  // Limpar sessões antigas além do limite
  const sessions = _fsKeys(SESSION_PREFIX).sort();
  while (sessions.length > MAX_SESSIONS) {
    _fsDelete(sessions.shift());
  }

  console.info('[guardian] Snapshot de sessão salvo:', key);
}

/**
 * Lista snapshots de sessão disponíveis.
 * @returns {Array}
 */
export function listSessionSnapshots() {
  return _fsKeys(SESSION_PREFIX)
    .sort()
    .reverse()
    .map(key => {
      const d = _fsRead(key);
      return { key, savedAt: d?.savedAt || null, count: d?.patches?.length || 0 };
    });
}

/**
 * Restaura estado a partir de um snapshot de sessão.
 * @param {string} key - chave do snapshot
 * @returns {Object[]|null}
 */
export function restoreSessionSnapshot(key) {
  const d = _fsRead(key);
  if (!d?.patches) { notify('Snapshot inválido', 'err'); return null; }
  notify(`Restaurado para ${d.savedAt?.slice(0,19).replace('T',' ')}`, 'ok');
  return d.patches;
}

// ── Auto-save com Debounce ────────────────────────────────────────────────────

/**
 * Agenda save de slots pendentes após período de inatividade.
 * Chamado a cada mutação de parâmetro/efeito.
 */
function _scheduleAutoSave() {
  if (!_g.config.enabled) return;
  clearTimeout(_g.saveDebounceTimer);
  _g.saveDebounceTimer = setTimeout(_flushPendingSaves, _g.config.autoSaveDebounceMs);
}

/**
 * Executa o save de todos os slots marcados como pendentes.
 */
async function _flushPendingSaves() {
  if (_g.pendingSlots.size === 0) return;

  const slots  = [..._g.pendingSlots];
  _g.pendingSlots.clear();

  console.info('[guardian] Auto-save:', slots.length, 'slots pendentes:', slots);

  for (const slotIdx of slots) {
    const patch = state.patches[slotIdx];
    if (!patch) continue;

    _walBegin('auto-save', slotIdx);
    const ok = savePatch(patch);
    if (ok) {
      _walCommit();
    } else {
      // Re-agenda se falhou
      _g.pendingSlots.add(slotIdx);
      console.error('[guardian] Auto-save falhou no slot', slotIdx);
    }
  }

  _g.saveCount++;
  _g.lastSaveAt = new Date().toISOString();

  // Backup rotativo a cada N saves
  if (_g.saveCount % _g.config.backupOnEveryNSaves === 0) {
    _rotateBackup(state.patches);
  }
}

// ── Varredura de Consistência ─────────────────────────────────────────────────

/**
 * Compara checksums do estado em memória com o LittleFS.
 * Detecta divergências e corrige automaticamente.
 */
function _runConsistencyCheck() {
  let divergences = 0;
  let repaired    = 0;

  for (let i = 0; i < state.patches.length; i++) {
    const memPatch  = state.patches[i];
    const fsPatch   = loadPatch(i);

    if (!fsPatch) {
      // Slot em memória mas não no FS → salvar
      _walBegin('consistency-repair-missing', i);
      savePatch(memPatch);
      _walCommit();
      repaired++;
      continue;
    }

    const memCS = _checksum(memPatch);
    const fsCS  = _checksum(fsPatch);

    if (memCS !== fsCS) {
      divergences++;
      _g.divergences.push({
        slot:      i,
        detectedAt: new Date().toISOString(),
        memCS,
        fsCS,
        memName:   memPatch.name,
        fsName:    fsPatch.name,
      });

      // Memória é a fonte de verdade → atualiza FS
      if (memPatch.dirty !== false) {
        _walBegin('consistency-repair-divergence', i);
        savePatch(memPatch);
        _walCommit();
        repaired++;
        console.warn(`[guardian] Divergência reparada: slot ${i} "${memPatch.name}" mem≠fs`);
      }
    }
  }

  if (divergences > 0) {
    console.warn(`[guardian] Varredura: ${divergences} divergências, ${repaired} reparadas`);
    notify(`Varredura: ${repaired} slots resincronizados`, 'info');
  }

  // Manter apenas últimas 50 divergências no log
  if (_g.divergences.length > 50) {
    _g.divergences = _g.divergences.slice(-50);
  }
}

// ── Comparação com Pedaleira ──────────────────────────────────────────────────

/**
 * Inicia comparação com o estado da pedaleira via MIDI.
 * Solicita dump do patch atual e compara com o cache.
 *
 * A comparação real acontece quando _onPatchReceivedForSync()
 * é chamado pelo midi_manager após receber o dump.
 */
function _requestSyncCheck() {
  if (!_g.onSendDumpRequest) return;
  if (!state.midi?.connected) return;

  console.info('[guardian] Solicitando sync check com pedaleira...');
  _g.onSendDumpRequest();
}

/**
 * Callback chamado pelo midi_manager ao receber um patch para comparação.
 * Compara patch recebido com o cache local.
 * @param {Object} receivedPatch - patch decodificado da pedaleira
 */
export function onPatchReceivedForSync(receivedPatch) {
  const idx   = state.currentIndex;
  const local = state.patches[idx];

  if (!local || !receivedPatch) return;

  const localCS    = _checksum(local);
  const deviceCS   = _checksum(receivedPatch);

  if (localCS === deviceCS) {
    console.info(`[guardian] Sync OK: slot ${idx} "${local.name}" está sincronizado`);
    return;
  }

  // Divergência detectada entre cache local e pedaleira
  const divergence = {
    slot:       idx,
    detectedAt: new Date().toISOString(),
    type:       'device-vs-cache',
    localCS,
    deviceCS,
    localName:  local.name,
    deviceName: receivedPatch.name,
  };

  _g.divergences.push(divergence);
  console.warn('[guardian] DIVERGÊNCIA device vs cache:', divergence);

  // Notifica usuário — deixa ele decidir qual versão manter
  _emitSyncConflict(divergence, local, receivedPatch);
}

/**
 * Emite evento de conflito de sync para a UI tratar.
 * @param {Object} divergence
 * @param {Object} localPatch
 * @param {Object} devicePatch
 */
function _emitSyncConflict(divergence, localPatch, devicePatch) {
  document.dispatchEvent(new CustomEvent('guardian:sync-conflict', {
    detail: { divergence, localPatch, devicePatch },
  }));
  notify(
    `Conflito no slot ${divergence.slot}: local ≠ pedaleira`,
    'err',
    6000
  );
}

// ── Getters de diagnóstico ────────────────────────────────────────────────────

/** Retorna log de divergências detectadas. */
export function getDivergences() { return [..._g.divergences]; }

/** Retorna estatísticas do guardian. */
export function getGuardianStats() {
  return {
    enabled:           _g.config.enabled,
    saveCount:         _g.saveCount,
    lastSaveAt:        _g.lastSaveAt,
    lastBackupAt:      _g.lastBackupAt,
    pendingSlots:      [..._g.pendingSlots],
    divergenceCount:   _g.divergences.length,
    autoSaveDebounceMs: _g.config.autoSaveDebounceMs,
    backups:           listBackups(),
    sessions:          listSessionSnapshots(),
  };
}

// ── Configuração ──────────────────────────────────────────────────────────────

/**
 * Atualiza configurações do guardian em runtime.
 * @param {Object} cfg
 */
export function configureGuardian(cfg) {
  Object.assign(_g.config, cfg);
  // Reinicia timers com novos intervalos
  _stopTimers();
  if (_g.config.enabled && _g.initialized) _startTimers();
}

// ── Timers ────────────────────────────────────────────────────────────────────

function _startTimers() {
  // Varredura de consistência
  _g.consistencyTimer = setInterval(
    _runConsistencyCheck,
    _g.config.consistencyIntervalMs
  );

  // Sync com pedaleira
  _g.syncTimer = setInterval(
    _requestSyncCheck,
    _g.config.syncCheckIntervalMs
  );

  console.info('[guardian] Timers iniciados — consistência:', _g.config.consistencyIntervalMs, 'ms | sync:', _g.config.syncCheckIntervalMs, 'ms');
}

function _stopTimers() {
  clearInterval(_g.consistencyTimer);
  clearInterval(_g.syncTimer);
  clearTimeout(_g.saveDebounceTimer);
}

// ── Inicialização ─────────────────────────────────────────────────────────────

/**
 * Inicializa o DataGuardian.
 * Deve ser chamado no boot, após o state estar carregado.
 *
 * @param {Object} opts
 * @param {Function} opts.onSendDumpRequest - função que solicita dump MIDI
 * @param {Object}   opts.config            - overrides de configuração
 */
export function initDataGuardian({ onSendDumpRequest = null, config = {} } = {}) {
  if (_g.initialized) return;

  // Injeção de dependência do MIDI (evita import circular)
  _g.onSendDumpRequest = onSendDumpRequest;

  // Config
  Object.assign(_g.config, config);

  // 1. Recuperação WAL (crash recovery)
  _walRecover();

  // 2. Snapshot de sessão inicial
  saveSessionSnapshot();

  // 3. Registra listeners de estado para auto-save
  state.addEventListener('state:param-changed',  ({ detail }) => {
    _g.pendingSlots.add(detail.patchIndex);
    _scheduleAutoSave();
  });
  state.addEventListener('state:fx-added',       ({ detail }) => {
    _g.pendingSlots.add(detail.patchIndex);
    _scheduleAutoSave();
  });
  state.addEventListener('state:fx-removed',     ({ detail }) => {
    _g.pendingSlots.add(detail.patchIndex);
    _scheduleAutoSave();
  });
  state.addEventListener('state:fx-toggled',     ({ detail }) => {
    _g.pendingSlots.add(detail.patchIndex);
    _scheduleAutoSave();
  });
  state.addEventListener('state:fx-reordered',   ({ detail }) => {
    _g.pendingSlots.add(detail.patchIndex);
    _scheduleAutoSave();
  });
  state.addEventListener('state:patch-changed',  ({ detail }) => {
    if (detail.patch?.dirty) {
      _g.pendingSlots.add(detail.patchIndex);
      _scheduleAutoSave();
    }
  });

  // 4. Salvar ao fechar/recarregar a página
  window.addEventListener('beforeunload', () => {
    // Flush imediato — não pode ser async neste handler
    if (_g.pendingSlots.size > 0) {
      for (const slotIdx of _g.pendingSlots) {
        const patch = state.patches[slotIdx];
        if (patch) {
          _walBegin('beforeunload', slotIdx);
          savePatch(patch);
          _walCommit();
        }
      }
      // Backup de emergência no unload
      _rotateBackup(state.patches);
    }
  });

  // 5. Inicia timers
  if (_g.config.enabled) _startTimers();

  _g.initialized = true;
  console.info('[guardian] DataGuardian inicializado ✓');
}

/**
 * Para todos os timers (ex: ao desmontar em testes).
 */
export function destroyDataGuardian() {
  _stopTimers();
  _g.initialized = false;
}
