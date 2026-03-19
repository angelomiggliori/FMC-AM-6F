/**
 * main.js — G1on Editor
 * Entry point: wires up the UI to DeviceController
 */

import { DeviceController } from './store/device-controller.js';
import { getEffect, getEffectsByCategory } from './protocol/effects-catalog.js';

const ctrl = new DeviceController();

// ── DOM refs ─────────────────────────────────────────────────────────────
const btnConnect    = document.getElementById('btn-connect');
const btnReadAll    = document.getElementById('btn-read-all');
const btnBackup     = document.getElementById('btn-backup');
const btnRestore    = document.getElementById('btn-restore');
const fileRestore   = document.getElementById('file-restore');
const statusEl      = document.getElementById('status');
const deviceEl      = document.getElementById('device-info');
const progressBar   = document.getElementById('progress-bar');
const progressText  = document.getElementById('progress-text');
const patchList     = document.getElementById('patch-list');
const editorPanel   = document.getElementById('editor-panel');

// ── Controller Events ────────────────────────────────────────────────────

ctrl.addEventListener('connected', ({ detail: info }) => {
  setStatus(`Connected: ${info.name} (FW ${info.firmware})`, 'success');
  deviceEl.textContent = `${info.name} · FW ${info.firmware} · ${info.presets} presets · ${info.fxSlots} FX slots`;
  btnConnect.textContent = 'Disconnect';
  btnReadAll.disabled = false;
  btnBackup.disabled  = false;
  btnRestore.disabled = false;
});

ctrl.addEventListener('disconnected', () => {
  setStatus('Disconnected', 'warning');
  deviceEl.textContent = '—';
  btnConnect.textContent = 'Connect Pedal';
  btnReadAll.disabled = true;
  btnBackup.disabled  = true;
  btnRestore.disabled = true;
  patchList.innerHTML = '';
  editorPanel.innerHTML = '<p class="placeholder">Connect a device to start editing</p>';
});

ctrl.addEventListener('progress', ({ detail: { current, total } }) => {
  const pct = Math.round((current / total) * 100);
  progressBar.style.width  = `${pct}%`;
  progressText.textContent = `Reading patch ${current} / ${total}`;
});

ctrl.addEventListener('allpatchesread', ({ detail: patches }) => {
  progressText.textContent = `${patches.length} patches loaded`;
  renderPatchList(patches);
});

ctrl.addEventListener('patchwritten', ({ detail: { slot } }) => {
  setStatus(`Patch ${slot + 1} saved to pedal`, 'success');
});

// ── Button Handlers ──────────────────────────────────────────────────────

btnConnect.addEventListener('click', async () => {
  if (ctrl.device) {
    ctrl.disconnect();
    return;
  }
  setStatus('Connecting...', 'info');
  try {
    await ctrl.connect();
  } catch (err) {
    setStatus(err.message, 'error');
  }
});

btnReadAll.addEventListener('click', async () => {
  setStatus('Reading all patches...', 'info');
  btnReadAll.disabled = true;
  progressBar.style.width = '0%';
  try {
    await ctrl.readAllPatches();
    setStatus('All patches loaded', 'success');
  } catch (err) {
    setStatus(err.message, 'error');
  } finally {
    btnReadAll.disabled = false;
  }
});

btnBackup.addEventListener('click', () => {
  try {
    ctrl.downloadBackup();
    setStatus('Backup downloaded', 'success');
  } catch (err) {
    setStatus(err.message, 'error');
  }
});

btnRestore.addEventListener('click', () => fileRestore.click());

fileRestore.addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async ({ target: { result } }) => {
    try {
      const backup = DeviceController.parseBackupFile(result);
      const confirm = window.confirm(
        `Restore ${backup.patches.length} patches from backup?\n` +
        `Backup device: ${backup.device.name} (${backup.timestamp.slice(0, 10)})\n` +
        `This will overwrite patches on the pedal.`
      );
      if (!confirm) return;
      setStatus('Restoring backup...', 'info');
      await ctrl.restoreBackup(backup);
      setStatus('Backup restored successfully', 'success');
    } catch (err) {
      setStatus(err.message, 'error');
    }
  };
  reader.readAsText(file);
  fileRestore.value = '';
});

// ── Patch List Renderer ───────────────────────────────────────────────────

function renderPatchList(patches) {
  patchList.innerHTML = '';
  patches.forEach((patch, i) => {
    if (!patch) return;
    const item = document.createElement('div');
    item.className = 'patch-item';
    item.innerHTML = `
      <span class="patch-num">${String(i + 1).padStart(2, '0')}</span>
      <span class="patch-name">${escHtml(patch.name || 'Empty')}</span>
      <span class="patch-fx">${patch.effects.filter(f => f.enabled).length} FX</span>
    `;
    item.addEventListener('click', () => renderPatchEditor(i, patch));
    patchList.appendChild(item);
  });
}

// ── Patch Editor ──────────────────────────────────────────────────────────

function renderPatchEditor(slot, patch) {
  // Highlight selected
  document.querySelectorAll('.patch-item').forEach(el => el.classList.remove('selected'));
  document.querySelectorAll('.patch-item')[slot]?.classList.add('selected');

  editorPanel.innerHTML = `
    <div class="editor-header">
      <label>Patch name
        <input id="patch-name-input" type="text" maxlength="10" value="${escHtml(patch.name)}" />
      </label>
      <button id="btn-send-to-pedal">Send to Pedal</button>
      <button id="btn-select-on-pedal">Select on Pedal</button>
    </div>
    <div class="fx-chain" id="fx-chain"></div>
  `;

  const fxChain = document.getElementById('fx-chain');
  patch.effects.forEach((fx, idx) => {
    const info = getEffect(fx.fxId);
    fxChain.appendChild(renderFxSlot(idx, fx, info, patch));
  });

  document.getElementById('btn-send-to-pedal').addEventListener('click', async () => {
    const name    = document.getElementById('patch-name-input').value.slice(0, 10);
    const updated = { ...patch, name };
    try {
      await ctrl.writePatch(slot, updated);
    } catch (err) {
      setStatus(err.message, 'error');
    }
  });

  document.getElementById('btn-select-on-pedal').addEventListener('click', async () => {
    try {
      await ctrl.selectPreset(slot);
      setStatus(`Switched to patch ${slot + 1} on pedal`, 'info');
    } catch (err) {
      setStatus(err.message, 'error');
    }
  });
}

function renderFxSlot(idx, fx, info, patch) {
  const slot = document.createElement('div');
  slot.className = `fx-slot${fx.enabled ? ' enabled' : ' disabled'}`;
  slot.innerHTML = `
    <div class="fx-header">
      <label class="fx-toggle">
        <input type="checkbox" ${fx.enabled ? 'checked' : ''} data-slot="${idx}" />
        <span>${escHtml(info.name)}</span>
      </label>
      <span class="fx-category">${info.category ?? '—'}</span>
    </div>
    <div class="fx-params">
      ${info.params.map((pname, pi) => `
        <label>${escHtml(pname)}
          <input type="range" min="0" max="127" value="${fx.params[pi] ?? 0}"
            data-slot="${idx}" data-param="${pi}" />
          <span class="param-val">${fx.params[pi] ?? 0}</span>
        </label>
      `).join('')}
    </div>
  `;

  // Sync range value display
  slot.querySelectorAll('input[type=range]').forEach(input => {
    input.addEventListener('input', (e) => {
      e.target.nextElementSibling.textContent = e.target.value;
      patch.effects[idx].params[parseInt(e.target.dataset.param)] = parseInt(e.target.value);
    });
  });

  // Toggle enable/disable
  slot.querySelector('input[type=checkbox]').addEventListener('change', (e) => {
    patch.effects[idx].enabled = e.target.checked;
    slot.classList.toggle('enabled',  e.target.checked);
    slot.classList.toggle('disabled', !e.target.checked);
  });

  return slot;
}

// ── Utilities ─────────────────────────────────────────────────────────────

function setStatus(msg, type = 'info') {
  statusEl.textContent = msg;
  statusEl.className   = `status ${type}`;
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
