/**
 * storage/data_guardian.js
 * Sistema de proteção e redundância de dados — G1on Editor
 */

import { savePatch, loadPatch, savePatchBank, loadPatchBank } from './patch_storage.js';
import { getSetting, setSetting }           from './settings_storage.js';
import { state }                            from '../engine/state_manager.js';
import { clonePatch }                       from '../engine/patch_codec.js';
import { notify }                           from '../ui/notifications.js';

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
  autoSaveDebounceMs:    3000,
  consistencyIntervalMs: 30000,
  syncCheckIntervalMs:   60000,
  backupOnEveryNSaves:   5,
  enabled:               true,
};

const _g = {
  config:           { ...DEFAULT_CONFIG },
  saveDebounceTimer: null,
  consistencyTimer:  null,
  syncTimer:         null,
  saveCount:         0,
  lastSaveAt:        null,
  lastBackupAt:      null,
  pendingSlots:      new Set(),
  divergences:       [],
  initialized:       false,
  onSendDumpRequest: null,
};

function _fsWrite(key, data) {
  try { localStorage.setItem(key, JSON.stringify(data)); return true; } catch { return false; }
}
function _fsRead(key) {
  try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : null; } catch { return null; }
}
function _fsDelete(key) { localStorage.removeItem(key); }
function _fsKeys(prefix) {
  const keys = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && k.startsWith(prefix)) keys.push(k);
  }
  return keys;
}

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

function _walBegin(op, slot) {
  _fsWrite(WAL_KEY, { op, slot, startedAt: Date.now(), pid: Math.random().toString(36).slice(2) });
}
function _walCommit() { _fsDelete(WAL_KEY); }

function _walRecover() {
  const wal = _fsRead(WAL_KEY);
  if (!wal) return;
  const age = Date.now() - (wal.startedAt || 0);
  if (age > 10000) {
    const memPatch = state.patches[wal.slot];
    if (memPatch) {
      savePatch(memPatch);
      _walCommit();
      notify(`Recuperado: slot ${wal.slot} após interrupção`, 'info');
    } else {
      _walCommit();
    }
  }
}

function _rotateBackup(patches) {
  const now = new Date().toISOString();
  const snapshot = {
    schema:    1,
    savedAt:   now,
    checksum:  patches.map((p, i) => ({ slot: i, cs: _checksum(p) })),
    patches,
  };

  const tmpKey = `${FS_PREFIX}backup_tmp.json`;
  if (!_fsWrite(tmpKey, snapshot)) return false;

  const c = _fsRead(BACKUP_KEYS[1]); if (c) _fsWrite(BACKUP_KEYS[2], c);
  const b = _fsRead(BACKUP_KEYS[0]); if (b) _fsWrite(BACKUP_KEYS[1], b);
  const tmp = _fsRead(tmpKey); if (tmp) _fsWrite(BACKUP_KEYS[0], tmp);
  _fsDelete(tmpKey);

  _g.lastBackupAt = now;
  return true;
}

export function restoreFromBackup(slot = 0) {
  for (let i = 0; i < BACKUP_KEYS.length; i++) {
    const backup = _fsRead(BACKUP_KEYS[i]);
    if (backup && backup.patches) {
      notify(`Restaurado do backup ${['A','B','C'][i]} — ${backup.savedAt?.slice(0,10)}`, 'ok');
      return backup.patches;
    }
  }
  notify('Nenhum backup disponível', 'err');
  return null;
}

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

export function saveSessionSnapshot() {
  const ts  = new Date().toISOString().replace(/[:.]/g, '').slice(0, 15);
  const key = `${SESSION_PREFIX}${ts}.json`;
  _fsWrite(key, { savedAt: new Date().toISOString(), patches: state.patches.map(clonePatch) });

  const sessions = _fsKeys(SESSION_PREFIX).sort();
  while (sessions.length > MAX_SESSIONS) _fsDelete(sessions.shift());
}

export function listSessionSnapshots() {
  return _fsKeys(SESSION_PREFIX).sort().reverse().map(key => {
    const d = _fsRead(key);
    return { key, savedAt: d?.savedAt || null, count: d?.patches?.length || 0 };
  });
}

export function restoreSessionSnapshot(key) {
  const d = _fsRead(key);
  if (!d?.patches) { notify('Snapshot inválido', 'err'); return null; }
  notify(`Restaurado para ${d.savedAt?.slice(0,19).replace('T',' ')}`, 'ok');
  return d.patches;
}

function _scheduleAutoSave() {
  if (!_g.config.enabled) return;
  clearTimeout(_g.saveDebounceTimer);
  _g.saveDebounceTimer = setTimeout(_flushPendingSaves, _g.config.autoSaveDebounceMs);
}

async function _flushPendingSaves() {
  if (_g.pendingSlots.size === 0) return;
  const slots  = [..._g.pendingSlots];
  _g.pendingSlots.clear();

  for (const slotIdx of slots) {
    const patch = state.patches[slotIdx];
    if (!patch) continue;
    _walBegin('auto-save', slotIdx);
    if (savePatch(patch)) _walCommit();
    else _g.pendingSlots.add(slotIdx);
  }

  _g.saveCount++;
  _g.lastSaveAt = new Date().toISOString();
  if (_g.saveCount % _g.config.backupOnEveryNSaves === 0) _rotateBackup(state.patches);
}

function _runConsistencyCheck() {
  let divergences = 0, repaired = 0;
  for (let i = 0; i < state.patches.length; i++) {
    const memPatch  = state.patches[i];
    const fsPatch   = loadPatch(i);

    if (!fsPatch) {
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
      _g.divergences.push({ slot: i, detectedAt: new Date().toISOString(), memCS, fsCS, memName: memPatch.name, fsName: fsPatch.name });
      if (memPatch.dirty !== false) {
        _walBegin('consistency-repair-divergence', i);
        savePatch(memPatch);
        _walCommit();
        repaired++;
      }
    }
  }
  if (_g.divergences.length > 50) _g.divergences = _g.divergences.slice(-50);
}

function _requestSyncCheck() {
  if (!_g.onSendDumpRequest || !state.midi?.connected) return;
  
  // Cancela o auto-sync se o usuário estiver arrastando um knob
  if (state.isInteracting) {
    console.info('[guardian] Usuário interagindo. Sync adiado.');
    return;
  }

  console.info('[guardian] Solicitando sync check com pedaleira...');
  _g.onSendDumpRequest();
}

export function onPatchReceivedForSync(receivedPatch) {
  const idx   = state.currentIndex;
  const local = state.patches[idx];
  if (!local || !receivedPatch) return;

  const localCS    = _checksum(local);
  const deviceCS   = _checksum(receivedPatch);

  if (localCS === deviceCS) return;

  const divergence = {
    slot: idx, detectedAt: new Date().toISOString(), type: 'device-vs-cache',
    localCS, deviceCS, localName: local.name, deviceName: receivedPatch.name,
  };
  _g.divergences.push(divergence);
  _emitSyncConflict(divergence, local, receivedPatch);
}

function _emitSyncConflict(divergence, localPatch, devicePatch) {
  document.dispatchEvent(new CustomEvent('guardian:sync-conflict', { detail: { divergence, localPatch, devicePatch } }));
  notify(`Conflito no slot ${divergence.slot}: local ≠ pedaleira`, 'err', 6000);
}

export function getDivergences() { return [..._g.divergences]; }
export function getGuardianStats() {
  return {
    enabled: _g.config.enabled, saveCount: _g.saveCount, lastSaveAt: _g.lastSaveAt, lastBackupAt: _g.lastBackupAt,
    pendingSlots: [..._g.pendingSlots], divergenceCount: _g.divergences.length, autoSaveDebounceMs: _g.config.autoSaveDebounceMs,
    backups: listBackups(), sessions: listSessionSnapshots(),
  };
}

export function configureGuardian(cfg) {
  Object.assign(_g.config, cfg);
  _stopTimers();
  if (_g.config.enabled && _g.initialized) _startTimers();
}

function _startTimers() {
  _g.consistencyTimer = setInterval(_runConsistencyCheck, _g.config.consistencyIntervalMs);
  _g.syncTimer = setInterval(_requestSyncCheck, _g.config.syncCheckIntervalMs);
}

function _stopTimers() { clearInterval(_g.consistencyTimer); clearInterval(_g.syncTimer); clearTimeout(_g.saveDebounceTimer); }

export function initDataGuardian({ onSendDumpRequest = null, config = {} } = {}) {
  if (_g.initialized) return;
  _g.onSendDumpRequest = onSendDumpRequest;
  Object.assign(_g.config, config);
  _walRecover();
  saveSessionSnapshot();

  const handleStateChange = ({ detail }) => {
    _g.pendingSlots.add(detail.patchIndex);
    _scheduleAutoSave();
  };

  state.addEventListener('state:param-changed',  handleStateChange);
  state.addEventListener('state:fx-added',       handleStateChange);
  state.addEventListener('state:fx-removed',     handleStateChange);
  state.addEventListener('state:fx-toggled',     handleStateChange);
  state.addEventListener('state:fx-reordered',   handleStateChange);
  state.addEventListener('state:patch-changed',  ({ detail }) => { if (detail.patch?.dirty) handleStateChange({detail}); });

  window.addEventListener('beforeunload', () => {
    if (_g.pendingSlots.size > 0) {
      for (const slotIdx of _g.pendingSlots) {
        const patch = state.patches[slotIdx];
        if (patch) { _walBegin('beforeunload', slotIdx); savePatch(patch); _walCommit(); }
      }
      _rotateBackup(state.patches);
    }
  });

  if (_g.config.enabled) _startTimers();
  _g.initialized = true;
}

export function destroyDataGuardian() { _stopTimers(); _g.initialized = false; }