/**
 * ui/param_editor.js
 * Painel direito de edição de parâmetros do efeito selecionado
 */

import { state }          from '../engine/state_manager.js';
import { FX_CATALOG }     from '../data/effects_catalog.js';
import { sendParamChange } from '../midi/midi_manager.js';
import { TapTempo }        from '../engine/tap_tempo.js';
import { getSetting }      from '../storage/settings_storage.js';

const tapEngine = new TapTempo();

export function initParamEditor() {
  state.addEventListener('state:slot-selected',  () => render());
  state.addEventListener('state:patch-changed',  () => render());
  state.addEventListener('state:param-changed',  (e) => _syncSlider(e.detail));
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

export function render() {
  const panel = document.getElementById('paramPanel');
  if (!panel) return;

  const slotIdx = state.selectedSlot;
  const patch   = state.currentPatch;

  if (slotIdx === null || !patch.effects[slotIdx]) {
    panel.innerHTML = `
      <div class="param-header">
        <div class="param-effect-name" style="color:var(--text3)">NENHUM EFEITO</div>
        <div class="param-effect-cat">SELECIONE UM SLOT</div>
      </div>
      <div class="param-empty">
        <svg width="44" height="44" viewBox="0 0 44 44" fill="none">
          <circle cx="22" cy="22" r="20" stroke="currentColor" stroke-width="1.5"/>
          <path d="M14 30L30 14M30 30L14 14" stroke="currentColor" stroke-width="1.5"/>
        </svg>
        Clique em um efeito<br>para editar parâmetros
      </div>`;
    return;
  }

  const fx  = patch.effects[slotIdx];
  const def = FX_CATALOG[fx.name] || { params: [], category: 'Other', id: 0 };
  const cat = def.category;
  const cc  = _catClass(cat);

  let paramsHTML = '';

  if (def.params.length === 0) {
    paramsHTML = `<div class="no-params">Sem parâmetros editáveis</div>`;
  } else {
    paramsHTML = def.params.map((pName, pi) => {
      const val   = fx.params[pi] ?? 64;
      const pct   = (val / 127 * 100).toFixed(1);
      const isTap = def.tapParamIdx === (pi + 1) && !!def.tap;

      return `
      <div class="param-row">
        <div class="param-label-row">
          <span class="param-label">${pName}</span>
          <span class="param-value-display" id="pval-${slotIdx}-${pi}">${val}</span>
        </div>
        <input
          type="range" class="param-slider"
          min="0" max="127" value="${val}"
          style="background:linear-gradient(90deg,var(--accent) 0%,var(--accent) ${pct}%,var(--border) ${pct}%)"
          oninput="window._ui.onParamSlider(${slotIdx},${pi},this)"
          onmousedown="window._ui.setInteracting(true)"
          onmouseup="window._ui.setInteracting(false)"
          ontouchstart="window._ui.setInteracting(true)"
          ontouchend="window._ui.setInteracting(false)"
          id="slider-${slotIdx}-${pi}">
        ${isTap ? `<button class="param-tap-btn" id="tapBtn-${slotIdx}-${pi}" onclick="window._ui.onTapTempo(${slotIdx},${pi})">♩ TAP TEMPO</button>` : ''}
      </div>`;
    }).join('');
  }

  panel.innerHTML = `
    <div class="param-header">
      <div class="param-effect-name">${fx.name}</div>
      <div class="param-effect-cat">
        <span class="fx-cat-badge ${cc}">${cat}</span>
        <span style="margin-left:8px;font-family:var(--mono);font-size:10px;color:var(--text3)">ID:${String(def.id).padStart(3,'0')} · SLOT ${slotIdx + 1}</span>
      </div>
    </div>
    <div class="param-list">${paramsHTML}</div>`;
}

export function onParamSlider(slotIdx, paramIdx, sliderEl) {
  const val = parseInt(sliderEl.value, 10);
  const pct = (val / 127 * 100).toFixed(1);

  sliderEl.style.background = `linear-gradient(90deg,var(--accent) 0%,var(--accent) ${pct}%,var(--border) ${pct}%)`;

  const disp = document.getElementById(`pval-${slotIdx}-${paramIdx}`);
  if (disp) disp.textContent = val;

  state.setParam(slotIdx, paramIdx, val);

  if (getSetting('realtimeSend')) {
    sendParamChange(slotIdx, paramIdx + 1, val);
  }
}

export function onTapTempo(slotIdx, paramIdx) {
  const bpm   = tapEngine.onTap();
  const midi  = tapEngine.toMidi();
  const btn   = document.getElementById(`tapBtn-${slotIdx}-${paramIdx}`);

  if (btn) {
    btn.textContent = `♩ ${bpm} BPM`;
    btn.classList.add('tapping');
    clearTimeout(btn._tapTimer);
    btn._tapTimer = setTimeout(() => {
      btn.textContent = '♩ TAP TEMPO';
      btn.classList.remove('tapping');
    }, 1500);
  }

  state.setParam(slotIdx, paramIdx, midi);
  if (getSetting('realtimeSend')) sendParamChange(slotIdx, paramIdx + 1, midi);

  const slider = document.getElementById(`slider-${slotIdx}-${paramIdx}`);
  if (slider) {
    slider.value = midi;
    onParamSlider(slotIdx, paramIdx, slider);
  }
}

function _syncSlider({ slotIndex, paramIndex, value }) {
  if (slotIndex !== state.selectedSlot) return;

  const slider = document.getElementById(`slider-${slotIndex}-${paramIndex}`);
  if (slider) {
    slider.value = value;
    const pct    = (value / 127 * 100).toFixed(1);
    slider.style.background = `linear-gradient(90deg,var(--accent) 0%,var(--accent) ${pct}%,var(--border) ${pct}%)`;
  }

  const disp = document.getElementById(`pval-${slotIndex}-${paramIndex}`);
  if (disp) disp.textContent = value;
}