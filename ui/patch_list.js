/**
 * ui/patch_list.js
 * Renderiza e gerencia a sidebar esquerda com a lista de patches
 */

import { state }    from '../engine/state_manager.js';
import { notify }   from './notifications.js';

export function initPatchList() {
  // Escuta eventos de estado
  state.addEventListener('state:patch-bank-loaded', () => render());
  state.addEventListener('state:patch-changed',     () => render());

  // Busca em tempo real
  document.getElementById('patchSearch')
    ?.addEventListener('input', () => render());

  render();
}

/**
 * Re-renderiza a lista de patches.
 */
export function render() {
  const list  = document.getElementById('patchList');
  if (!list) return;

  const query   = (document.getElementById('patchSearch')?.value || '').toLowerCase();
  const patches = state.patches;
  const current = state.currentIndex;

  list.innerHTML = patches.map((p, i) => {
    // Filtro por busca
    if (query && !p.name.toLowerCase().includes(query) && !String(i).includes(query)) {
      return '';
    }

    const isActive  = i === current;
    const fxCount   = (p.effects || []).filter(Boolean).length;
    const dirtyMark = p.dirty ? '<span style="color:var(--accent2)">✦</span>' : '';

    return `
      <div class="patch-item ${isActive ? 'active' : ''}"
           onclick="window._ui.selectPatch(${i})"
           title="Slot ${i}: ${p.name}">
        <span class="patch-num">${String(i).padStart(2, '0')}</span>
        <span class="patch-name">${p.name} ${dirtyMark}</span>
        <span class="patch-fx-count">${fxCount}fx</span>
      </div>`;
  }).join('');

  // Scroll para o patch atual
  const activeEl = list.querySelector('.patch-item.active');
  activeEl?.scrollIntoView({ block: 'nearest' });
}
