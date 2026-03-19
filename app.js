/**
 * app.js
 * Bootstrap principal da aplicação G1on Editor
 */

import { state }                    from './engine/state_manager.js';
import { initMidi, connectMidi, disconnectMidi, requestCurrentPatch, sendPatch, savePatchToSlot, sendParamChange, selectPatchOnDevice } from './midi/midi_manager.js';
import { hasStoredData, loadPatchBank, savePatch, savePatchBank, exportBankJSON, importBankJSON, getStorageStats } from './storage/patch_storage.js';
import { getSetting, setSetting }    from './storage/settings_storage.js';
import { buildInitialPatchBank }     from './data/default_patches.js';
import { initDataGuardian, restoreFromBackup, listBackups, listSessionSnapshots, restoreSessionSnapshot, getGuardianStats, getDivergences, onPatchReceivedForSync } from './storage/data_guardian.js';
import { initPatchList }             from './ui/patch_list.js';
import { initSignalChain, startKnobDrag, onDragStart, onDragOver, onDragLeave, onDrop } from './ui/signal_chain.js';
import { initParamEditor, onParamSlider, onTapTempo } from './ui/param_editor.js';
import { initEffectBrowser, openBrowser, closeBrowser, pickEffect, setCat as setBrowserCat } from './ui/effect_browser.js';
import { sysexLog }                  from './ui/sysex_log.js';
import { notify }                    from './ui/notifications.js';

window.addEventListener('DOMContentLoaded', async () => {
  _loadStorage();
  await initMidi();
  _initGuardian();
  _initUI();
  _registerKeyboard();
  _bindStateToHeader();
  _bindGuardianEvents();
  _exposeUI();
  notify('G1on Editor carregado ✓', 'ok', 2000);
  console.info('[app] Boot concluído ✓');
});

function _loadStorage() {
  const patches = hasStoredData() ? loadPatchBank(100) : buildInitialPatchBank();
  state.loadPatchBank(patches);
  const lastIdx = getSetting('lastPatchIndex') || 0;
  state.selectPatch(Math.min(lastIdx, patches.length - 1));
}

function _initGuardian() {
  initDataGuardian({
    onSendDumpRequest: () => requestCurrentPatch(true), 
    config: {
      autoSaveDebounceMs:    3000,
      consistencyIntervalMs: 30000,
      syncCheckIntervalMs:   60000,
      backupOnEveryNSaves:   5,
      enabled:               true,
    },
  });
}

function _bindGuardianEvents() {
  document.addEventListener('guardian:sync-conflict', ({ detail }) => {
    _showSyncConflictDialog(detail.divergence, detail.localPatch, detail.devicePatch);
  });
}

function _showSyncConflictDialog(divergence, localPatch, devicePatch) {
  document.getElementById('syncConflictDialog')?.remove();
  const d = document.createElement('div');
  d.id    = 'syncConflictDialog';
  d.style.cssText = ['position:fixed;top:50%;left:50%;transform:translate(-50%,-50%)','background:#161920;border:1px solid #ff3d5a;border-radius:4px','padding:24px;z-index:500;width:440px;max-width:95vw',"font-family:'Share Tech Mono',monospace;box-shadow:0 20px 60px rgba(0,0,0,.85)",].join(';');
  d.innerHTML = `
    <div style="color:#ff3d5a;font-size:11px;letter-spacing:2px;margin-bottom:14px">⚠ CONFLITO — SLOT ${divergence.slot}</div>
    <div style="color:#7a8090;font-size:11px;margin-bottom:16px;line-height:1.9">O patch local e o da pedaleira estão diferentes.<br>Qual versão manter?</div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:18px">
      <div style="background:#111318;border:1px solid #2a2d36;padding:11px;border-radius:3px">
        <div style="color:#00e5ff;font-size:9px;letter-spacing:2px;margin-bottom:5px">LOCAL · EDITOR</div>
        <div style="color:#d0d4e0;font-size:14px;font-weight:bold">${localPatch.name}</div>
        <div style="color:#3e4255;font-size:9px;margin-top:5px">CS: ${divergence.localCS}</div>
      </div>
      <div style="background:#111318;border:1px solid #2a2d36;padding:11px;border-radius:3px">
        <div style="color:#ffcc00;font-size:9px;letter-spacing:2px;margin-bottom:5px">PEDALEIRA · DEVICE</div>
        <div style="color:#d0d4e0;font-size:14px;font-weight:bold">${devicePatch.name}</div>
        <div style="color:#3e4255;font-size:9px;margin-top:5px">CS: ${divergence.deviceCS}</div>
      </div>
    </div>
    <div style="display:flex;gap:8px">
      <button id="cfl-local"  style="flex:1;background:#00e5ff;color:#000;border:none;padding:9px;font-family:inherit;font-size:10px;font-weight:700;letter-spacing:1px;cursor:pointer;border-radius:3px">MANTER LOCAL</button>
      <button id="cfl-device" style="flex:1;background:#ffcc00;color:#000;border:none;padding:9px;font-family:inherit;font-size:10px;font-weight:700;letter-spacing:1px;cursor:pointer;border-radius:3px">USAR PEDALEIRA</button>
      <button id="cfl-ignore" style="flex:1;background:transparent;color:#7a8090;border:1px solid #2a2d36;padding:9px;font-family:inherit;font-size:10px;cursor:pointer;border-radius:3px">IGNORAR</button>
    </div>`;
  document.body.appendChild(d);

  d.querySelector('#cfl-local').onclick = () => { sendPatch(localPatch); savePatchToSlot(divergence.slot); notify('Local mantido', 'ok'); d.remove(); };
  d.querySelector('#cfl-device').onclick = () => { state.setPatch(divergence.slot, devicePatch); savePatch(devicePatch); notify('Pedaleira adotada localmente', 'ok'); d.remove(); };
  d.querySelector('#cfl-ignore').onclick = () => d.remove();
}

function _initUI() {
  initPatchList(); initSignalChain(); initParamEditor(); initEffectBrowser(); _updatePatchHeader();
}

function _bindStateToHeader() {
  state.addEventListener('state:patch-changed', ({ detail }) => { _updatePatchHeader(detail.patchIndex, detail.patch); });
  state.addEventListener('state:midi-status', ({ detail }) => {
    const dot  = document.getElementById('statusDot');
    const text = document.getElementById('statusText');
    if (dot)  dot.className   = 'status-dot' + (detail.connected ? ' connected' : '');
    if (text) text.textContent = detail.connected ? '● ' + detail.portName.substring(0, 18).toUpperCase() : 'DESCONECTADO';
  });
}

function _updatePatchHeader(idx, patch) {
  idx   = idx   ?? state.currentIndex;
  patch = patch ?? state.currentPatch;
  const badge = document.getElementById('slotBadge');
  const input = document.getElementById('patchNameInput');
  if (badge) badge.textContent = 'P' + String(idx).padStart(2, '0');
  if (input && document.activeElement !== input) input.value = patch?.name || '';
}

function _registerKeyboard() {
  document.addEventListener('keydown', e => {
    const ctrl    = e.metaKey || e.ctrlKey;
    const inInput = ['INPUT','TEXTAREA'].includes(document.activeElement?.tagName);

    if (e.key === 'Escape')        { closeBrowser(); return; }
    if (ctrl && e.key === 's')     { e.preventDefault(); _cmdSave(); return; }
    if (ctrl && e.key === 'Enter') { e.preventDefault(); _cmdSend(); return; }
    if (ctrl && e.key === 'z')     { e.preventDefault(); state.undo(); notify('Undo ✓','info',1200); return; }
    if (ctrl && e.key === 'b')     { e.preventDefault(); _cmdShowGuardianStatus(); return; }

    if (!inInput) {
      if (e.key === 'ArrowUp' && state.currentIndex > 0) {
        e.preventDefault(); state.selectPatch(state.currentIndex - 1); selectPatchOnDevice(state.currentIndex);
      }
      if (e.key === 'ArrowDown' && state.currentIndex < state.patches.length - 1) {
        e.preventDefault(); state.selectPatch(state.currentIndex + 1); selectPatchOnDevice(state.currentIndex);
      }
    }
  });
}

function _cmdSave() {
  const patch = state.currentPatch;
  const idx   = state.currentIndex;
  patch.dirty = false;
  
  savePatch({ ...patch, slot: idx });
  
  if (state.midi.connected) {
    sendPatch(patch);
    setTimeout(() => { savePatchToSlot(idx); }, 50); 
  }
  
  setSetting('lastPatchIndex', idx);
  notify(`P${String(idx).padStart(2,'0')} salvo ✓`, 'ok');
  state.dispatchEvent(new CustomEvent('state:patch-changed', { detail:{ patchIndex:idx, patch } }));
}

function _cmdSend() {
  sendPatch(state.currentPatch);
  notify('Patch enviado ▶', 'ok');
}
function _cmdReceive() {
  requestCurrentPatch();
  notify('Aguardando patch...', 'info');
}
function _cmdNewPatch() {
  const idx  = state.patches.length;
  state.patches.push({ slot:idx, name:`NOVO${String(idx).padStart(2,'0')}`, effects:[null,null,null,null,null], dirty:true });
  state.selectPatch(idx); notify('Novo patch criado', 'info');
}
function _cmdExport() {
  const json = exportBankJSON(state.patches);
  const blob = new Blob([json], { type:'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = `g1on_bank_${new Date().toISOString().slice(0,10)}.json`; a.click();
  URL.revokeObjectURL(url); notify('Banco exportado ✓', 'ok');
}
function _cmdImport() {
  const input  = document.createElement('input'); input.type   = 'file'; input.accept = '.json';
  input.onchange = async (e) => {
    const file = e.target.files[0]; if (!file) return;
    try {
      const patches = importBankJSON(await file.text());
      if (!patches) { notify('Arquivo inválido', 'err'); return; }
      savePatchBank(patches); state.loadPatchBank(patches);
      notify(`${patches.length} patches importados ✓`, 'ok');
    } catch (err) { notify('Erro: ' + err.message, 'err'); }
  };
  input.click();
}
function _cmdShowGuardianStatus() {
  const s = getGuardianStats();
  console.group('[DataGuardian] Status');
  console.log('Saves:', s.saveCount, '| Pendentes:', s.pendingSlots, '| Divergências:', s.divergenceCount);
  console.groupEnd();
  notify(`Guardian: ${s.saveCount} saves`, 'info', 5000);
}
function _cmdRestoreBackup() { const patches = restoreFromBackup(); if (patches) state.loadPatchBank(patches); }
function _cmdStorageStats() { const fs = getStorageStats(); notify(`LittleFS: ${fs.patchCount} patches · ${fs.totalKB} KB`, 'info', 4000); }

function _exposeUI() {
  window._ui = {
    connectMidi, disconnectMidi,
    selectPatch:     (i)  => { state.selectPatch(i); selectPatchOnDevice(i); },
    newPatch:        _cmdNewPatch,
    savePatch:       _cmdSave,
    sendPatch:       _cmdSend,
    receivePatch:    _cmdReceive,
    exportBank:      _cmdExport,
    importBank:      _cmdImport,
    patchNameChange: ()   => { const v = document.getElementById('patchNameInput')?.value; if (v) state.renamePatch(v); },
    selectSlot:    (i)       => state.selectSlot(i),
    toggleFx:      (i)       => state.toggleEffect(i),
    removeFx:      (i)       => state.removeEffect(i),
    openBrowser, startKnobDrag, onDragStart, onDragOver, onDragLeave, onDrop,
    onParamSlider, onTapTempo, pickEffect, setBrowserCat,
    toggleLog: () => sysexLog.toggle(),
    clearLog:  () => sysexLog.clear(),
    undo: () => { state.undo(); notify('Undo ✓','info',1200); },
    
    // Guardian / Interação
    guardianStatus:     _cmdShowGuardianStatus,
    restoreBackup:      _cmdRestoreBackup,
    storageStats:       _cmdStorageStats,
    listBackups:        () => console.table(listBackups()),
    listSessions:       () => console.table(listSessionSnapshots()),
    restoreSession:     (key) => { const p = restoreSessionSnapshot(key); if (p) state.loadPatchBank(p); },
    getDivergences:     () => getDivergences(),
    onPatchReceivedForSync,
    setInteracting:     (val) => state.setInteracting(val) // A Ponte salva-vidas pro Guardian!
  };
}