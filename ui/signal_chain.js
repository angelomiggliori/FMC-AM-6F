/**
 * ui/signal_chain.js
 * Renderiza a cadeia de efeitos (rack central) e gerencia interações:
 */

import { state }         from '../engine/state_manager.js';
import { FX_CATALOG }    from '../data/effects_catalog.js';
import { sendParamChange } from '../midi/midi_manager.js';

let _dragFrom = null;

export function initSignalChain() {
  state.addEventListener('state:patch-changed',  () => render());
  state.addEventListener('state:fx-toggled',     () => render());
  state.addEventListener('state:fx-added',       () => render());
  state.addEventListener('state:fx-removed',     () => render());
  state.addEventListener('state:fx-reordered',   () => render());
  state.addEventListener('state:slot-selected',  () => render());
  state.addEventListener('state:param-changed',  (e) => _updateMiniKnob(e.detail));
  render();
}

function _catClass(cat) {
  const map = {
    Drive:'cat-drive', Amp:'cat-amp', Modulation:'cat-modulation', Delay:'cat-delay',
    Reverb:'cat-reverb', Dynamics:'cat-dynamics', 'Filter/Wah':'cat-filter',
    'Pitch/Synth':'cat-pitch', 'EQ/Utility':'cat-eq', Other:'cat-other',
  };
  return map[cat] || 'cat-other';
}

function _miniParamsHTML(fx, slotIdx) {
  const def    = FX_CATALOG[fx.name] || { params: [] };
  const params = def.params.slice(0, 4);

  return params.map((pName, pi) => {
    const val   = fx.params[pi] ?? 64;
    const angle = Math.round(val / 127 * 270);
    const rot   = angle - 135;
    return `
      <div class="fx-param-mini">
        <div class="mini-knob"
          style="--angle:${angle}deg;--rot:${rot}deg"
          id="knob-${slotIdx}-${pi}"
          onmousedown="window._ui.startKnobDrag(event,${slotIdx},${pi})"
          title="${pName}: ${val}"></div>
        <div class="fx-param-mini-name">${pName}</div>
        <div class="fx-param-mini-val" id="kval-${slotIdx}-${pi}">${val}</div>
      </div>`;
  }).join('');
}

export function render() {
  const chain   = document.getElementById('signalChain');
  if (!chain) return;

  const patch   = state.currentPatch;
  const selSlot = state.selectedSlot;
  const SLOTS   = 5;

  // Atualiza o info header com o DSP calculado
  const usedFx   = patch.effects.filter(Boolean).length;
  const dspTotal = state.currentDSP;
  const dspColor = dspTotal > 100 ? 'var(--red)' : 'var(--text3)';
  const infoEl   = document.getElementById('chainSlotInfo');
  if (infoEl) {
    infoEl.innerHTML = `${usedFx} / 5 SLOTS &nbsp;·&nbsp; <span style="color:${dspColor};font-weight:bold">DSP: ${dspTotal}%</span>`;
  }

  let html = `<div class="chain-input-label">▶ INPUT</div>`;

  for (let i = 0; i < SLOTS; i++) {
    const fx  = patch.effects[i];
    const sel = selSlot === i;

    if (fx) {
      const def     = FX_CATALOG[fx.name] || { params: [], category: 'Other', id: 0 };
      const cat     = def.category || 'Other';
      const cc      = _catClass(cat);
      const disabled = !fx.on ? 'disabled' : '';
      const tapMark  = def.tap ? `<span class="tap-mark" title="Tem Tap Tempo">TAP</span>` : '';

      html += `
      <div class="fx-slot ${sel ? 'selected' : ''} ${disabled}" id="slot-${i}"
        draggable="true"
        ondragstart="window._ui.onDragStart(event,${i})"
        ondragover="window._ui.onDragOver(event,${i})"
        ondragleave="window._ui.onDragLeave(event,${i})"
        ondrop="window._ui.onDrop(event,${i})">
        <div class="fx-slot-inner">
          <div class="fx-drag" title="Arrastar para reordenar">
            <svg width="10" height="18" viewBox="0 0 10 18">
              <circle cx="3" cy="3"  r="1.5" fill="currentColor"/>
              <circle cx="7" cy="3"  r="1.5" fill="currentColor"/>
              <circle cx="3" cy="9"  r="1.5" fill="currentColor"/>
              <circle cx="7" cy="9"  r="1.5" fill="currentColor"/>
              <circle cx="3" cy="15" r="1.5" fill="currentColor"/>
              <circle cx="7" cy="15" r="1.5" fill="currentColor"/>
            </svg>
          </div>
          <div class="fx-power" onclick="window._ui.toggleFx(${i})" title="${fx.on ? 'Desligar' : 'Ligar'}">
            <div class="power-led"></div>
          </div>
          <div class="fx-info" onclick="window._ui.selectSlot(${i})">
            <div class="fx-name-row"><span class="fx-name">${fx.name}</span><span class="fx-cat-badge ${cc}">${cat}</span>${tapMark}</div>
            <div class="fx-params-row">${_miniParamsHTML(fx, i)}</div>
          </div>
          <div class="fx-actions">
            <button class="fx-action-btn" onclick="window._ui.openBrowser(${i})" title="Trocar efeito">⇄</button>
            <button class="fx-action-btn del" onclick="window._ui.removeFx(${i})" title="Remover">✕</button>
          </div>
        </div>
      </div>`;
    } else {
      html += `
      <div class="fx-empty" onclick="window._ui.openBrowser(${i})">
        <span style="font-size:18px;opacity:.4">+</span> SLOT ${i + 1} — ADICIONAR EFEITO
      </div>`;
    }

    if (i < SLOTS - 1) {
      html += `<div class="chain-arrow"><svg width="16" height="14" viewBox="0 0 16 14"><path d="M8 0L16 7L8 14L6.6 12.5L12.2 8H0V6H12.2L6.6 1.5Z" fill="currentColor"/></svg></div>`;
    }
  }

  chain.innerHTML = html;
}

function _updateMiniKnob({ slotIndex, paramIndex, value }) {
  const knob = document.getElementById(`knob-${slotIndex}-${paramIndex}`);
  const val  = document.getElementById(`kval-${slotIndex}-${paramIndex}`);
  if (!knob && !val) return;
  const angle = Math.round(value / 127 * 270);
  const rot   = angle - 135;
  if (knob) { knob.style.setProperty('--angle', angle + 'deg'); knob.style.setProperty('--rot', rot + 'deg'); }
  if (val) val.textContent = value;
}

let _knobDrag = null;

export function startKnobDrag(e, slotIdx, paramIdx) {
  e.preventDefault();
  const patch = state.currentPatch;
  if (!patch.effects[slotIdx]) return;

  window._ui?.setInteracting(true); // Trava o auto-sync do Guardian

  _knobDrag = { slotIdx, paramIdx, startY: e.clientY, startVal: patch.effects[slotIdx].params[paramIdx] ?? 64 };
  if (state.selectedSlot !== slotIdx) state.selectSlot(slotIdx);

  window.addEventListener('mousemove', _onKnobMove);
  window.addEventListener('mouseup',   _onKnobUp);
}

function _onKnobMove(e) {
  if (!_knobDrag) return;
  const { slotIdx, paramIdx, startY, startVal } = _knobDrag;
  const delta  = Math.round((startY - e.clientY) * 0.8);
  const newVal = Math.min(127, Math.max(0, startVal + delta));
  state.setParam(slotIdx, paramIdx, newVal);
  sendParamChange(slotIdx, paramIdx + 1, newVal);
}

function _onKnobUp() {
  _knobDrag = null;
  window._ui?.setInteracting(false); // Libera o auto-sync do Guardian
  window.removeEventListener('mousemove', _onKnobMove);
  window.removeEventListener('mouseup',   _onKnobUp);
}

// ── Drag & Drop ───────────────────────────────────────────────────────────────

export function onDragStart(e, i) {
  _dragFrom = i;
  e.dataTransfer.effectAllowed = 'move';
  window._ui?.setInteracting(true);
  setTimeout(() => document.getElementById(`slot-${i}`)?.classList.add('dragging'), 0);
}

export function onDragOver(e, i) {
  if (_dragFrom === null || _dragFrom === i) return;
  e.preventDefault();
  document.getElementById(`slot-${i}`)?.classList.add('drag-over');
}

export function onDragLeave(e, i) {
  document.getElementById(`slot-${i}`)?.classList.remove('drag-over');
}

export function onDrop(e, i) {
  e.preventDefault();
  document.getElementById(`slot-${i}`)?.classList.remove('drag-over');
  window._ui?.setInteracting(false);
  
  if (_dragFrom === null || _dragFrom === i) { _dragFrom = null; return; }
  
  // Realiza a mudança de posição
  state.reorderEffects(_dragFrom, i);
  _dragFrom = null;

  // ENVIA O PATCH COMPLETO para a pedaleira refletir o drag&drop na hora
  if (window._ui && window._ui.sendPatch) {
    window._ui.sendPatch();
  }
}